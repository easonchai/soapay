/**
 * THE ADAPTER SEAM for the exit SDK (docs/mvp-spec.md §9, `packages/sdk/src/exit.ts`).
 *
 * The app talks to an `ExitService` only. Two implementations:
 *   - `createSdkExitService` (below): wraps the SDK's `planExit` / `advanceExitLeg` / `derivePoolSecrets`.
 *   - `createMockExitService` (./mock.ts): a timer-driven fake for VITE_MOCK_API.
 *
 * The SDK is being built in parallel. Until it exports `advanceExitLeg`, the real service reports
 * `ready: false`. It picks the functions up from `@soapay/sdk` automatically when they appear
 * (`sdkExit()`); to switch to a static import once the SDK lands:
 *   1. replace `sdkExit()` with `import { planExit, advanceExitLeg, derivePoolSecrets } from "@soapay/sdk"`;
 *   2. re-export the SDK's `ExitLeg` / `ExitConfig` from ./types.ts and delete the local copies;
 *   3. align `buildCtx` with the SDK's real `advanceExitLeg` context (spend clients per chain).
 */
import * as SDK from "@soapay/sdk";
import type { Address, Hex } from "viem";
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

/** The §9 SDK surface this app needs. */
export type ExitSdkModule = {
  planExit(p: { sources: ExitSource[]; destination: Address; config: ExitConfig }): { legs: ExitLeg[]; fees: unknown; warnings: string[] };
  advanceExitLeg(ctx: Record<string, unknown>, leg: ExitLeg): Promise<ExitLeg>;
  derivePoolSecrets(keys: { spendingKey: Hex }, poolIndex: number): { nullifier: bigint; secret: bigint };
};

/** The SDK's exit functions, or null while `packages/sdk/src/exit.ts` hasn't landed. */
export function sdkExit(mod: unknown = SDK): ExitSdkModule | null {
  const m = mod as Partial<ExitSdkModule>;
  return typeof m.advanceExitLeg === "function" && typeof m.planExit === "function" && typeof m.derivePoolSecrets === "function"
    ? (m as ExitSdkModule)
    : null;
}

const HOUR = 3_600_000;

export function createSdkExitService(p: {
  config: ExitConfig | null;
  bundlerUrl: string;
  rpcUrl: string;
  fetch: typeof fetch;
  sdk?: ExitSdkModule | null;
}): ExitService {
  const sdk = p.sdk === undefined ? sdkExit() : p.sdk;
  const unavailableReason = !p.config
    ? "No exit route for this chain yet. The testnet route runs from Base Sepolia."
    : !sdk
      ? "The exit SDK hasn't landed in this build yet. Run with VITE_MOCK_API=1 to try the flow."
      : !p.bundlerUrl
        ? "Set a bundler URL in Settings to exit."
        : undefined;
  const ready = unavailableReason === undefined;

  return {
    mock: false,
    ready,
    ...(unavailableReason ? { unavailableReason } : {}),
    config: p.config,
    pollMs: 15_000,
    delayRangeMs: [2 * HOUR, 24 * HOUR],
    planExit({ sources, destination, firstPoolIndex }) {
      if (!sdk || !p.config) throw new Error(unavailableReason ?? "Exit unavailable");
      const plan = sdk.planExit({ sources, destination, config: p.config });
      // Pool indexes must be unique per seed; the app hands them out (profile.nextExitPoolIndex).
      return { legs: plan.legs.map((l, i) => ({ ...l, poolIndex: firstPoolIndex + i })), warnings: plan.warnings };
    },
    async advance(leg, keys, opts) {
      if (!sdk || !p.config) throw new Error(unavailableReason ?? "Exit unavailable");
      return sdk.advanceExitLeg(buildCtx(sdk, p, leg, keys, opts), leg);
    },
  };
}

function buildCtx(
  sdk: ExitSdkModule,
  p: { config: ExitConfig | null; bundlerUrl: string; rpcUrl: string; fetch: typeof fetch },
  leg: ExitLeg,
  keys: ExitKeys,
  opts: AdvanceOptions,
): Record<string, unknown> {
  // TODO(sdk): align with the SDK's context type (spend clients per chain) when exit.ts lands.
  return {
    config: p.config,
    bundlerUrl: p.bundlerUrl,
    rpcUrl: p.rpcUrl,
    fetch: p.fetch,
    stealthKey: keys.stealthKey(),
    poolSecrets: sdk.derivePoolSecrets({ spendingKey: keys.spendingKey }, leg.poolIndex),
    destination: opts.destination,
    roundWithdrawals: opts.roundWithdrawals,
  };
}
