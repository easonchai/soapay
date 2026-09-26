/**
 * Exit types: the SDK's (docs/mvp-spec.md §9, `packages/sdk/src/exit.ts`), re-exported. An `ExitLeg`
 * is plain JSON (amounts as decimal strings), so the vault stores it as is.
 */
import type { Address } from "viem";
import type { ExitConfig, ExitLeg, ExitStatus } from "@soapay/sdk";

export type { ExitConfig, ExitLeg };
export type ExitLegStatus = ExitStatus;

export type ExitSource = { stealthAddress: Address; amount: bigint };

export const TERMINAL: readonly ExitLegStatus[] = ["done", "refunded", "failed"];
export const isTerminal = (s: ExitLegStatus) => TERMINAL.includes(s);

// ---- Stored form (inside the encrypted vault): the SDK leg is already JSON-safe ----

export type StoredExitLeg = ExitLeg;

export type ExitPrivacy = {
  /** Wait a random delay after approval before withdrawing (default on). */
  randomDelay: boolean;
  /** Withdraw a round amount and leave the change in the pool (default on). */
  roundWithdrawals: boolean;
};

export type ExitRecord = {
  id: string;
  createdAt: number;
  sourceChainId: number;
  destChainId: number;
  destination: Address;
  privacy: ExitPrivacy;
  legs: StoredExitLeg[];
  /** Per leg id: don't withdraw before this time (the random delay). */
  holdUntil: Record<string, number>;
};

export const storeLeg = (l: ExitLeg): StoredExitLeg => l;
export const loadLeg = (l: StoredExitLeg): ExitLeg => l;

/**
 * Whether `next` differs from `prev` at all. The SDK records progress beyond status and txs (the
 * in-flight userOp nonce, the attested CCTP message, the deposit label, withdrawals), and every one
 * of those must reach the vault for a reload to resume without double-sending.
 */
export function legChanged(prev: ExitLeg, next: ExitLeg): boolean {
  return prev !== next && JSON.stringify(prev) !== JSON.stringify(next);
}
