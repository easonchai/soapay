/**
 * Exit types, mirrored from docs/mvp-spec.md §9 (SDK `packages/sdk/src/exit.ts`). The SDK is being
 * built in parallel; once it exports these, re-export them from `./sdk.ts` and delete the copies here.
 */
import type { Address, Hash } from "viem";

export type ExitLegStatus =
  | "planned"
  | "burning"
  | "awaiting-mint"
  | "minted"
  | "depositing"
  | "pending-asp"
  | "approved"
  | "declined"
  | "withdrawing"
  | "done"
  | "refunded"
  | "failed";

/** One per stealth address, never combined (§9). */
export type ExitLeg = {
  id: string;
  stealthAddress: Address;
  amount: bigint;
  status: ExitLegStatus;
  txs: { burn?: Hash; mint?: Hash; deposit?: Hash; withdraw?: Hash; refund?: Hash };
  poolIndex: number;
  error?: string;
  updatedAt: number;
};

export type ExitConfig = {
  source: number;
  dest: number;
  cctp: {
    tokenMessenger: Address;
    messageTransmitter: Address;
    sourceDomain: number;
    destDomain: number;
    sourceUsdc: Address;
    destUsdc: Address;
    irisUrl: string;
  };
  pool: { entrypoint: Address; pool: Address; asset: Address; minDeposit: bigint; vettingFeeBps: bigint };
  aspApiUrl: string;
  relayerUrl: string;
  forwarding: true;
};

export type ExitSource = { stealthAddress: Address; amount: bigint };

export const TERMINAL: readonly ExitLegStatus[] = ["done", "refunded", "failed"];
export const isTerminal = (s: ExitLegStatus) => TERMINAL.includes(s);

// ---- Stored form (inside the encrypted vault; bigints as decimal strings) ----

export type StoredExitLeg = Omit<ExitLeg, "amount"> & { amount: string };

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

export const storeLeg = (l: ExitLeg): StoredExitLeg => ({ ...l, amount: l.amount.toString() });
export const loadLeg = (l: StoredExitLeg): ExitLeg => ({ ...l, amount: BigInt(l.amount) });

/** Whether `next` differs from `prev` enough to persist (status, txs or error). */
export function legChanged(prev: ExitLeg, next: ExitLeg): boolean {
  return (
    prev.status !== next.status ||
    prev.error !== next.error ||
    JSON.stringify(prev.txs) !== JSON.stringify(next.txs) ||
    prev.amount !== next.amount
  );
}
