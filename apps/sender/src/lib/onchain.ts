// "What coworkers see" (D-41) for one run: the lines exactly as the chain shows them (rebuilt from each
// landed transaction's receipt by the SDK's `payRunBatchFromReceipt`), next to the employer's own view
// (names). The employer is trusted, so names are shown here; the chain side never has them.
import type { PayRunBatch } from "@soapay/sdk";
import type { Address, Hash } from "viem";
import type { RunRecord } from "./run.js";

export type OnChainRow = {
  txHash: Hash;
  /** 1-based line number within its transaction. */
  line: number;
  stealthAddress: Address;
  /** From the transaction's Transfer logs; null if the chain shows no transfer to this address. */
  amount: bigint | null;
  /** Employer-only: the name the local run record has for this address, or null if it isn't in the record. */
  name: string | null;
};

/** Landed transactions of a run, across every attempt, oldest first. */
export function landedTxs(run: RunRecord): Hash[] {
  const out: Hash[] = [];
  for (const a of run.attempts) for (const c of a.chunks) if (c.status === "landed" && c.txHash && !out.includes(c.txHash)) out.push(c.txHash);
  return out;
}

/** Joins the chain's lines with the record's names. Pure. */
export function onChainRows(run: RunRecord, batches: readonly PayRunBatch[]): OnChainRow[] {
  const names = new Map<string, string>();
  for (const a of run.attempts) for (const c of a.chunks) for (const l of c.lines) names.set(l.stealthAddress.toLowerCase(), l.name);
  return batches.flatMap((b) =>
    b.lines.map((l) => ({
      txHash: b.txHash,
      line: l.index + 1,
      stealthAddress: l.stealthAddress,
      amount: l.amount,
      name: names.get(l.stealthAddress.toLowerCase()) ?? null,
    })),
  );
}

/**
 * Before anything lands: the planned lines of the latest attempt, sorted by address as the contract
 * requires. Labelled as a preview in the UI; nothing here is read from the chain.
 */
export function plannedRows(run: RunRecord): Omit<OnChainRow, "txHash" | "line">[] {
  const last = run.attempts[run.attempts.length - 1];
  if (!last) return [];
  return last.chunks
    .flatMap((c) => c.lines)
    .map((l) => ({ stealthAddress: l.stealthAddress, amount: l.amount, name: l.name }))
    .sort((a, b) => (BigInt(a.stealthAddress) < BigInt(b.stealthAddress) ? -1 : 1));
}
