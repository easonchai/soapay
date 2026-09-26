// Draft-time numbers for the Pay run screen (before anything is derived): how many lines and
// transactions a set of salaries becomes under a denomination. Uses the SDK's one
// implementation of the split rules (splitIntoDenominations); the real run is planned by
// planRun in run.ts, which derives fresh addresses.
import { MAX_LINES_PER_TX, splitIntoDenominations } from "@soapay/sdk";
import type { Denomination } from "./run.js";

export type DraftPreview = {
  total: bigint;
  lines: number;
  txCount: number;
  /** Lines per amount entry, same order as the input. */
  perAmount: number[];
  /** Human reason when the denomination can't be applied (e.g. chunk 0). */
  error: string | null;
};

export function draftPreview(amounts: readonly bigint[], denomination: Denomination | null, maxLinesPerTx = MAX_LINES_PER_TX): DraftPreview {
  const total = amounts.reduce((s, a) => s + a, 0n);
  let perAmount: number[] = amounts.map((a) => (a > 0n ? 1 : 0));
  let error: string | null = null;
  if (denomination) {
    try {
      // Carry mode rounds each line to whole chunks; the count is close enough for a draft.
      perAmount = amounts.map((a) => splitIntoDenominations(a, denomination.chunkSize).chunks.length);
    } catch (e) {
      error = e instanceof Error ? e.message.replace(/^denominations: /, "") : String(e);
    }
  }
  const lines = perAmount.reduce((s, n) => s + n, 0);
  return { total, lines, txCount: lines === 0 ? 0 : Math.ceil(lines / maxLinesPerTx), perAmount, error };
}
