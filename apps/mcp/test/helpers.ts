import { vi } from "vitest";
import { getAddress, type Address, type Hash, type Hex } from "viem";
import { privateKeyToAddress } from "viem/accounts";
import {
  CHAINS,
  buildMetadata77,
  derivePayRun,
  keysFromMnemonic,
  type AnnouncementRecord,
  type SwapQuote,
} from "@soapay/sdk";
import { loadConfig } from "../src/config.js";
import type { Api, Chain, Ctx, FaucetResult } from "../src/context.js";
import { Caps, PlanStore } from "../src/guardrails.js";
import type { Logger } from "../src/log.js";
import { memoryStateStore } from "../src/state.js";

export const AGENT_MNEMONIC = "test test test test test test test test test test test junk";
export const PAYER_KEY = `0x${"42".repeat(32)}` as Hex;
export const PAYER = privateKeyToAddress(PAYER_KEY);
export const USDC = CHAINS[84532].usdc;
export const DISPERSE = getAddress("0x6B7a1cC570Af2DDd427DA694351438F0FE8039CA");
export const EMPLOYER = getAddress("0x7757A7C9f4eD02a02353A7929cfb399e9286f52c");
export const NOW = 1_800_000_000;

export const agentKeys = keysFromMnemonic(AGENT_MNEMONIC);
export const alice = keysFromMnemonic("abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about");
export const bob = keysFromMnemonic("zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo wrong");

export const u = (n: number) => BigInt(Math.round(n * 1e6));

/** Announcements paying the agent: one StealthDisperse line per amount (as a real pay run would). */
export function paymentsToAgent(amounts: number[], opts: { payer?: Address; txHash?: Hex } = {}): AnnouncementRecord[] {
  const lines = derivePayRun({ recipients: amounts.map((a, i) => ({ id: String(i), metaAddressURI: agentKeys.metaAddressURI, amount: u(a) })) });
  return lines.map((l, i) => ({
    blockNumber: 100n + BigInt(i),
    txHash: opts.txHash ?? (`0x${(i + 1).toString(16).padStart(64, "0")}` as Hex),
    logIndex: i,
    stealthAddress: l.stealthAddress,
    caller: DISPERSE,
    ephemeralPubKey: l.ephemeralPublicKey,
    metadata: buildMetadata77({ viewTag: l.viewTag, token: USDC, amount: l.amount, payer: opts.payer ?? EMPLOYER }),
  }));
}

export type FakeChain = Chain & { [K in keyof Omit<Chain, "usdc">]: ReturnType<typeof vi.fn> } & { balances: Map<string, bigint> };

export function makeCtx(opts: { env?: Record<string, string>; keys?: boolean; payer?: boolean; names?: Record<string, string>; announcements?: AnnouncementRecord[] } = {}) {
  const { config } = loadConfig({ STATE_DIR: "/nonexistent", MAX_PER_CALL_USDC: "10", MAX_PER_DAY_USDC: "15", ...opts.env });
  const state = memoryStateStore();
  const logs: { level: string; msg: string; fields?: Record<string, unknown> }[] = [];
  const log: Logger = {
    info: (msg, fields) => void logs.push({ level: "info", msg, ...(fields ? { fields } : {}) }),
    warn: (msg, fields) => void logs.push({ level: "warn", msg, ...(fields ? { fields } : {}) }),
    error: (msg, fields) => void logs.push({ level: "error", msg, ...(fields ? { fields } : {}) }),
  };
  const names: Record<string, string> = opts.names ?? { "alice.soapay.eth": alice.metaAddressURI, "bob.soapay.eth": bob.metaAddressURI };
  const balances = new Map<string, bigint>();
  for (const a of opts.announcements ?? []) {
    const amt = BigInt(`0x${a.metadata.slice(2 + 50, 2 + 114)}`);
    balances.set(a.stealthAddress.toLowerCase(), amt);
  }
  let allowance = 0n;
  let n = 0;
  const hash = () => `0x${(++n).toString(16).padStart(64, "a")}` as Hash;
  const chain = {
    usdc: USDC,
    balances,
    usdcBalance: vi.fn(async (_a: Address) => u(100)),
    ethBalance: vi.fn(async (_a: Address) => 10n ** 17n),
    allowance: vi.fn(async () => allowance),
    gasPrice: vi.fn(async () => 1_000_000n),
    registryNonce: vi.fn(async () => 0n),
    resolveName: vi.fn(async (name: string) => {
      const meta = names[name];
      if (!meta) {
        const { NameNotFound } = await import("@soapay/sdk");
        throw new NameNotFound(name, 'no "stealth" text record');
      }
      return { metaAddressURI: meta, registrant: getAddress("0x3333333333333333333333333333333333333333") };
    }),
    sendTransaction: vi.fn(async (call: { to: Address; data: Hex }) => {
      if (call.data.startsWith("0x095ea7b3")) allowance = BigInt(`0x${call.data.slice(-64)}`); // approve(spender, amount)
      return hash();
    }),
    waitForReceipt: vi.fn(async () => "success" as const),
    verifyBalances: vi.fn(async (matches: { announcement: AnnouncementRecord }[], tokens: Address[]) =>
      matches.flatMap((m) => tokens.map((t) => ({ stealthAddress: m.announcement.stealthAddress, token: t, balance: balances.get(m.announcement.stealthAddress.toLowerCase()) ?? 0n }))),
    ),
    quoteSpend: vi.fn(async (stealthKey: Hex) => {
      const from = privateKeyToAddress(stealthKey);
      const balance = balances.get(from.toLowerCase()) ?? 0n;
      const fee = u(0.05);
      return { fee, balance, maxSendable: balance > fee ? balance - fee : 0n };
    }),
    spendMany: vi.fn(async (spends: { stealthKey: Hex; to: Address; amount: bigint | "max" }[]) =>
      spends.map((s) => ({ from: privateKeyToAddress(s.stealthKey), userOpHash: hash(), txHash: hash(), delegated: true, amount: s.amount as bigint, feeEstimate: u(0.05) })),
    ),
    execute: vi.fn(async (p: { stealthKey: Hex }) => ({ from: privateKeyToAddress(p.stealthKey), userOpHash: hash(), txHash: hash(), delegated: true, feeEstimate: u(0.05) })),
    quoteSwap: vi.fn(
      async (p: { stealthAddress: Address; tokenOut: Address; amountIn: bigint; slippageBps: number }): Promise<SwapQuote> => ({
        source: "trading-api",
        chainId: 84532,
        stealthAddress: p.stealthAddress,
        tokenIn: USDC,
        tokenOut: p.tokenOut,
        amountIn: p.amountIn,
        amountOut: 1000n,
        minOut: 995n,
        slippageBps: p.slippageBps,
        route: "USDC -> WETH",
        router: "0x8702463e73f74d0b6765aBceb314Ef07aCb92650",
        deadline: 0n,
        calls: [{ to: USDC, data: "0x" }],
      }),
    ),
  } as unknown as FakeChain;

  const registry = new Map<string, { label: string; name: string; registrant: Address; metaAddress: string; txHash: Hex | null }>();
  const api = {
    register: vi.fn(async (_b: unknown) => ({ txHash: hash(), status: "success" })),
    claimName: vi.fn(async (b: { label: string; registrant: Address; metaAddress: string }) => {
      const rec = { label: b.label, name: `${b.label}.soapay.eth`, registrant: b.registrant, metaAddress: b.metaAddress, txHash: hash() };
      registry.set(b.label, rec);
      return rec;
    }),
    getName: vi.fn(async (label: string) => registry.get(label) ?? null),
    announcements: vi.fn(async () => opts.announcements ?? []),
    faucet: vi.fn(async (address: Address): Promise<FaucetResult> => ({
      status: "sent" as const,
      address,
      usdc: { amount: "1000000000000", txHash: hash() },
      eth: null,
    })),
  } satisfies Record<keyof Api, unknown>;

  let now = NOW;
  const ctx: Ctx = {
    config,
    log,
    state,
    caps: new Caps(config, state),
    plans: new PlanStore(config.planTtlSeconds),
    chain,
    api: api as unknown as Api,
    keys: opts.keys === false ? undefined : agentKeys,
    payer: opts.payer === false ? undefined : PAYER,
    now: () => now,
    sleep: async () => {},
    spendDelayMs: 0,
  };
  return { ctx, chain, api, state, logs, registry, advance: (s: number) => void (now += s), setAllowance: (a: bigint) => void (allowance = a) };
}
