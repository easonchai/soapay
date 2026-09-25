/**
 * THE ADAPTER SEAM for the exit SDK (docs/mvp-spec.md §9, `packages/sdk/src/exit.ts`).
 *
 * The app talks to an `ExitService` only. Two implementations:
 *   - `createSdkExitService` (below): wraps the SDK's `planExit` / `advanceExitLeg`.
 *   - `createMockExitService` (./mock.ts): a timer-driven fake for VITE_MOCK_API.
 */
import {
  advanceExitLeg,
  createSpendClient,
  derivePoolSecrets,
  getSpendChainConfig,
  pimlicoFeesPerGas,
  planExit,
  type ExitContext,
  type SpendClient,
} from "@soapay/sdk";
import { createPublicClient, http, type Address, type Chain, type Hex, type PublicClient, type Transport } from "viem";
import type { ExitConfig, ExitLeg, ExitSource } from "./types.js";

export type ExitKeys = {
  /** Resolves the stealth address's key on demand, so a mock never touches it. */
  stealthKey: () => Hex;
  /** Generation-0 spending key; pool secrets derive from it, so a lost device recovers from the seed. */
  spendingKey: Hex;
};

export type AdvanceOptions = { destination: Address; roundWithdrawals: boolean };

export type ExitService = {
  mock: boolean;
  ready: boolean;
  unavailableReason?: string;
  config: ExitConfig | null;
  /** How often useExit polls active legs. */
  pollMs: number;
  /** Random delay range between approval and the withdrawal (when the user keeps it on). */
  delayRangeMs: readonly [number, number];
  planExit(p: { sources: ExitSource[]; destination: Address; firstPoolIndex: number }): { legs: ExitLeg[]; warnings: string[] };
  /** One idempotent step of the leg's state machine. Safe to call again after a reload. */
  advance(leg: ExitLeg, keys: ExitKeys, opts: AdvanceOptions): Promise<ExitLeg>;
};

/** The §9 SDK surface this app uses; injectable for tests. */
export type ExitSdkModule = {
  planExit: typeof planExit;
  advanceExitLeg: typeof advanceExitLeg;
  derivePoolSecrets: typeof derivePoolSecrets;
};

const SDK: ExitSdkModule = { planExit, advanceExitLeg, derivePoolSecrets };
const HOUR = 3_600_000;

/**
 * The destination chain's bundler. A Pimlico-style URL keyed by chain id is re-pointed at the
 * destination (same API key); anything else falls back to Pimlico's public endpoint.
 */
export function destBundlerUrl(sourceUrl: string, source: number, dest: number): string {
  const re = new RegExp(`/${source}(/|$)`);
  if (re.test(sourceUrl)) return sourceUrl.replace(re, `/${dest}$1`);
  return `https://public.pimlico.io/v2/${dest}/rpc`;
}

export function createSdkExitService(p: {
  config: ExitConfig | null;
  bundlerUrl: string;
  rpcUrl: string;
  /** Destination-chain RPC (Ethereum Sepolia on testnet: the app's L1 RPC). Default: the chain's public RPC. */
  destRpcUrl?: string;
  fetch: typeof fetch;
  sdk?: ExitSdkModule;
}): ExitService {
  const sdk = p.sdk ?? SDK;
  const unavailableReason = !p.config
    ? "No exit route for this chain yet. The testnet route runs from Base Sepolia."
    : !p.bundlerUrl
      ? "Set a bundler URL in Settings to exit."
      : undefined;
  const ready = unavailableReason === undefined;

  // Spend clients are built once per service (per settings), one per chain of the route.
  let clients: Record<number, SpendClient> | null = null;
  const spendClients = (cfg: ExitConfig) => (clients ??= buildSpendClients(cfg, p));

  return {
    mock: false,
    ready,
    ...(unavailableReason ? { unavailableReason } : {}),
    config: p.config,
    pollMs: 15_000,
    delayRangeMs: [2 * HOUR, 24 * HOUR],
    planExit({ sources, destination, firstPoolIndex }) {
      if (!p.config) throw new Error(unavailableReason ?? "Exit unavailable");
      // Pool indexes must be unique per seed; the app hands them out (profile.nextExitPoolIndex).
      const plan = sdk.planExit({ sources, destination, config: p.config, firstPoolIndex });
      return { legs: plan.legs, warnings: plan.warnings };
    },
    async advance(leg, keys, opts) {
      if (!ready || !p.config) throw new Error(unavailableReason ?? "Exit unavailable");
      return sdk.advanceExitLeg(buildCtx(p.config, spendClients(p.config), p.fetch, leg, keys, opts), leg);
    },
  };
}

function buildSpendClients(cfg: ExitConfig, p: { bundlerUrl: string; rpcUrl: string; destRpcUrl?: string }): Record<number, SpendClient> {
  const make = (chainId: number, rpcUrl: string | undefined, bundlerUrl: string) => {
    const chain: Chain = getSpendChainConfig(chainId).chain;
    const publicClient = createPublicClient({ chain, transport: http(rpcUrl || undefined, { batch: false, retryCount: 2 }) }) as PublicClient<Transport, Chain>;
    return createSpendClient({
      chainId,
      publicClient,
      bundlerUrl,
      ...(bundlerUrl.includes("pimlico") ? { estimateFeesPerGas: pimlicoFeesPerGas } : {}),
    });
  };
  return {
    [cfg.source]: make(cfg.source, p.rpcUrl, p.bundlerUrl),
    [cfg.dest]: make(cfg.dest, p.destRpcUrl, destBundlerUrl(p.bundlerUrl, cfg.source, cfg.dest)),
  };
}

/** The SDK's real `advanceExitLeg` context for one leg. */
export function buildCtx(
  config: ExitConfig,
  spendClients: Record<number, SpendClient>,
  fetchFn: typeof fetch,
  _leg: ExitLeg,
  keys: ExitKeys,
  opts: AdvanceOptions,
): ExitContext {
  if (opts.destination.toLowerCase() !== _leg.destination.toLowerCase()) throw new Error("Exit destination mismatch");
  return {
    // The app holds approved legs for its own random delay (runner.ts: holdUntil), so the SDK's is off.
    // Round withdrawals: one whole-USDC withdrawal, change left in the pool; otherwise everything at once.
    config: { ...config, withdrawDelayMs: { min: 0, max: 0 }, ...(opts.roundWithdrawals ? {} : { withdrawUnit: 1n }) },
    spendClients,
    stealthKey: keys.stealthKey(),
    keys: { spendingKey: keys.spendingKey },
    fetch: fetchFn as unknown as NonNullable<ExitContext["fetch"]>,
    withdrawParts: 1,
    leaveChange: opts.roundWithdrawals,
  };
}
