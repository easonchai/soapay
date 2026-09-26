/**
 * Everything a tool touches, injected so the tools can be tested with fakes. The pure SDK
 * logic (derivation, scanning, the guard, encoding) runs for real in tests; only chain, API,
 * bundler and Uniswap I/O goes through `Chain` / `Api`.
 */
import type { Address, Hash, Hex } from "viem";
import type {
  AnnouncementRecord,
  BalanceRow,
  ExecuteParams,
  ExecuteResult,
  ResolvedStealthMeta,
  ScanMatch,
  SoapayKeys,
  SpendParams,
  SpendResult,
  SwapQuote,
  SwapQuoteParams,
} from "@soapay/sdk";
import type { AgentMetadata } from "@soapay/sdk/ensv2";
import type { McpConfig } from "./config.js";
import type { Caps, PlanStore } from "./guardrails.js";
import type { Logger } from "./log.js";
import type { StateStore } from "./state.js";

export type Call = { to: Address; data: Hex };

export interface Chain {
  usdc: Address;
  usdcBalance(owner: Address): Promise<bigint>;
  ethBalance(owner: Address): Promise<bigint>;
  allowance(owner: Address, spender: Address): Promise<bigint>;
  gasPrice(): Promise<bigint>;
  registryNonce(registrant: Address): Promise<bigint>;
  resolveName(name: string): Promise<ResolvedStealthMeta>;
  /** Payer EOA: sign + broadcast. */
  sendTransaction(call: Call): Promise<Hash>;
  waitForReceipt(hash: Hash): Promise<"success" | "reverted">;
  verifyBalances(matches: readonly Pick<ScanMatch, "announcement">[], tokens: readonly Address[]): Promise<BalanceRow[]>;
  /** Bundler + paymaster: quote "send max" from one stealth address. */
  quoteSpend(stealthKey: Hex, to: Address): Promise<{ fee: bigint; balance: bigint; maxSendable: bigint }>;
  spendMany(spends: readonly SpendParams[]): Promise<SpendResult[]>;
  execute(params: ExecuteParams): Promise<ExecuteResult>;
  quoteSwap(params: Omit<SwapQuoteParams, "chainId" | "publicClient" | "apiUrl">): Promise<SwapQuote>;
}

export type NameRecord = { label: string; name: string; registrant: Address; metaAddress: string; txHash: Hex | null };

export interface Api {
  register(body: { registrant: Address; metaAddress: string; signature: Hex }): Promise<{ txHash: Hex; status: string; idempotent?: boolean }>;
  claimName(body: {
    label: string;
    registrant: Address;
    metaAddress: string;
    deadline: string;
    signature: Hex;
    agent?: AgentMetadata;
  }): Promise<NameRecord>;
  /** null when free. */
  getName(label: string): Promise<NameRecord | null>;
  announcements(): Promise<AnnouncementRecord[]>;
  /** POST /faucet: the Base Sepolia welcome drop (once per address, D-52). */
  faucet(address: Address): Promise<FaucetResult>;
}

export type FaucetResult =
  | { status: "sent"; address: Address; usdc: { amount: string; txHash: Hash }; eth: { amount: string; txHash: Hash } | null }
  | { status: "already_claimed"; address: Address };

export class ApiError extends Error {
  override name = "ApiError";
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export type Ctx = {
  config: McpConfig;
  log: Logger;
  state: StateStore;
  caps: Caps;
  plans: PlanStore;
  chain: Chain;
  api: Api;
  /** The agent as recipient (AGENT_MNEMONIC). Undefined when not configured. */
  keys: SoapayKeys | undefined;
  /** The agent as payer (AGENT_PAYER_PRIVATE_KEY's address). */
  payer: Address | undefined;
  /** Unix seconds. */
  now(): number;
  /** Pause between spend userOps (ms), so sends don't share a block or a rhythm. */
  spendDelayMs?: number;
  sleep?(ms: number): Promise<void>;
};
