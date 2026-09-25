import type { Hex } from 'viem';

export type BatchCall = { to: Hex; data: Hex };

/**
 * atomic     EIP-5792 wallet_sendCalls: [transfer, announce] x N in one atomic bundle. caller = employer.
 * permit     StealthDisperse.payWithPermit: one tx, EIP-2612 permit for the exact total. Plain EOAs.
 * sequential Fallback: announce first (harmless if unpaid), then transfer, one tx each.
 */
export type BatchMode = 'atomic' | 'permit' | 'sequential';
export type BatchProgress = { step: string; done: number; total: number };

/** Set when the run stopped before every row was confirmed. Rows may already be paid. */
export type BatchPartial = { announcedRows: number; paidRows: number; error: string; pendingId?: string | undefined };
export type BatchResult = { mode: BatchMode; txHashes: Hex[]; partial?: BatchPartial | undefined };

export interface BatchSender {
  detect(): Promise<BatchMode>;
  /** `mode` pins the path the UI displayed; omitted means detect again. Throws BatchPartialError on partial runs. */
  send(calls: BatchCall[], onProgress: (p: BatchProgress) => void, mode?: BatchMode): Promise<BatchResult>;
}
