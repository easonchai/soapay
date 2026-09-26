// Demo mode's stand-in for the chain: an in-memory USDC/ETH ledger for the demo wallet (kept in
// sessionStorage so hash navigation and reloads keep it; a closed tab resets it), plus the ExecDeps /
// RecheckDeps / probe / funding shapes the real hooks expect, fabricated without any wagmi action.
//
// SAFETY: this module imports nothing from "wagmi", "wagmi/actions" or "@wagmi/core", so a demo run
// cannot reach a wallet or an RPC. Landed lines are read back from the run records themselves
// (useWalletBalances / useRunOnChain), so the ledger holds only the payer's balances.
import { keccak256, stringToHex, type Address, type Hash } from "viem";
import { classifyAccountCode, selectPayPath, type PayRunCall } from "@soapay/sdk";
import type { AppConfig } from "../config.js";
import type { ExecDeps, RecheckDeps } from "./execute.js";
import type { ChunkRecord } from "./run.js";
import type { AccountProbe, Funding } from "./wallet.js";

export const DEMO_LEDGER_KEY = "soapay:demo:ledger";
/** Starting balances: 25,000 USDC and 0.05 ETH. */
export const DEMO_START_USDC = 25_000_000_000n;
export const DEMO_START_ETH = 50_000_000_000_000_000n;
/** One faucet press. */
export const DEMO_FAUCET_USDC = 10_000_000_000n;
export const DEMO_GAS_PRICE = 1_000_000_000n;
const MAX_UINT256 = (1n << 256n) - 1n;

export type DemoLedgerState = { usdc: bigint; eth: bigint; txCount: number; salt: string };

type Stored = { usdc: string; eth: string; txCount: number; salt: string };

function sessionStore(): Storage | null {
  try {
    return typeof sessionStorage === "undefined" ? null : sessionStorage;
  } catch {
    return null;
  }
}

function fresh(): DemoLedgerState {
  return { usdc: DEMO_START_USDC, eth: DEMO_START_ETH, txCount: 0, salt: Math.random().toString(36).slice(2) };
}

function load(): DemoLedgerState {
  const raw = sessionStore()?.getItem(DEMO_LEDGER_KEY);
  if (!raw) return fresh();
  try {
    const s = JSON.parse(raw) as Stored;
    return { usdc: BigInt(s.usdc), eth: BigInt(s.eth), txCount: s.txCount, salt: s.salt };
  } catch {
    return fresh();
  }
}

export type DemoLedger = {
  get(): DemoLedgerState;
  subscribe(fn: () => void): () => void;
  faucet(amount?: bigint): void;
  debit(amount: bigint): void;
  /** Deterministic fake transaction hash; each call is a new one. */
  nextTxHash(): Hash;
  /** Back to the starting balances (tests, "Exit demo"). */
  reset(): void;
};

export function createDemoLedger(): DemoLedger {
  let state = load();
  const subs = new Set<() => void>();
  const commit = (next: DemoLedgerState) => {
    state = next;
    const s: Stored = { usdc: next.usdc.toString(), eth: next.eth.toString(), txCount: next.txCount, salt: next.salt };
    sessionStore()?.setItem(DEMO_LEDGER_KEY, JSON.stringify(s));
    for (const fn of subs) fn();
  };
  return {
    get: () => state,
    subscribe(fn) {
      subs.add(fn);
      return () => void subs.delete(fn);
    },
    faucet: (amount = DEMO_FAUCET_USDC) => commit({ ...state, usdc: state.usdc + amount }),
    debit: (amount) => commit({ ...state, usdc: state.usdc >= amount ? state.usdc - amount : 0n }),
    nextTxHash() {
      const n = state.txCount + 1;
      commit({ ...state, txCount: n });
      return keccak256(stringToHex(`soapay-demo:${state.salt}:${n}`));
    },
    reset: () => commit(fresh()),
  };
}

/** The one ledger of this tab. */
export const demoLedger: DemoLedger = createDemoLedger();

/** How long a fake wallet prompt / confirmation takes. Tests set it to 0. */
let latencyMs = 1_500;
export function setDemoLatencyMs(ms: number): void {
  latencyMs = ms;
}
const wait = () => new Promise<void>((r) => setTimeout(r, latencyMs));

/** What probeAccount would return for a plain account with StealthDisperse deployed. Built with the real pure selectors. */
export function demoProbe(app: Pick<AppConfig, "chainId" | "stealthDisperse">): AccountProbe {
  const kind = classifyAccountCode(undefined, false);
  return {
    kind,
    capabilities: null,
    disperseDeployed: true,
    path: selectPayPath({ chainId: app.chainId, capabilities: undefined, accountKind: kind, stealthDisperse: app.stealthDisperse, disperseDeployed: true }),
  };
}

export function demoFunding(state: DemoLedgerState = demoLedger.get()): Funding {
  return { usdcBalance: state.usdc, allowance: MAX_UINT256, ethBalance: state.eth, gasPrice: DEMO_GAS_PRICE };
}

/**
 * ExecDeps for one attempt: every call "lands" after the demo latency. A call to the token is the
 * approval; every other call is the next pay chunk, whose amount is debited when its receipt lands.
 */
export function demoExecDeps(opts: { usdc: Address; chunks: readonly ChunkRecord[]; ledger?: DemoLedger }): ExecDeps {
  const ledger = opts.ledger ?? demoLedger;
  const chunkByHash = new Map<string, ChunkRecord>();
  const chunkByBatch = new Map<string, ChunkRecord>();
  let nextChunk = 0;
  const isApprove = (call: PayRunCall) => call.to.toLowerCase() === opts.usdc.toLowerCase();
  const settle = (c: ChunkRecord | undefined) => {
    if (c) ledger.debit(c.amount);
  };
  return {
    async sendTransaction(call) {
      await wait();
      const hash = ledger.nextTxHash();
      if (!isApprove(call)) chunkByHash.set(hash, opts.chunks[nextChunk++]!);
      return hash;
    },
    async waitForReceipt(hash) {
      await wait();
      settle(chunkByHash.get(hash));
      return "success";
    },
    async sendCalls() {
      await wait();
      const id = `demo-batch-${ledger.get().txCount + 1}`;
      chunkByBatch.set(id, opts.chunks[nextChunk++]!);
      return id;
    },
    async waitForCalls(id) {
      await wait();
      settle(chunkByBatch.get(id));
      return { status: "success", txHash: ledger.nextTxHash() };
    },
    readAllowance: async () => MAX_UINT256,
    sleep: async () => undefined,
  };
}

/** Every fake transaction is confirmed. */
export function demoRecheckDeps(): RecheckDeps {
  return {
    getReceipt: async () => "success",
    getCallsStatus: async () => ({ status: "success" }),
  };
}
