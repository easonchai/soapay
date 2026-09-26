/**
 * Denominated payouts (PRD "Amount privacy"). Each salary is split into fixed-size
 * chunks, each paid to its own stealth address, so a batch reads as many identical
 * transfers. Pure functions over bigint base units.
 */
import { MAX_LINE_AMOUNT, MAX_LINES_PER_TX } from "./constants.js";

/**
 * - `exact` (default): whole chunks plus one remainder chunk. Pays the exact wage;
 *   the remainder line is the only distinctive amount and is flagged.
 * - `carry`: rounds the wage plus `carryIn` to the nearest whole number of chunks
 *   and returns `carryOut` (positive: still owed; negative: overpaid) for the next run.
 *   Every line is identical, but each run pays up to half a chunk more or less than the
 *   wage actually due for that period. Many jurisdictions require wages to be paid in
 *   full and on time, and payslips and tax withholding are per period, so carry mode
 *   must be approved by the employer's payroll/legal team and the carry balance tracked
 *   and settled (e.g. on termination). Not the default for that reason (CLAUDE.md open issue).
 */
export type DenominationPolicy = { mode: "exact" } | { mode: "carry"; carryIn: bigint };

export type DenominationSplit = {
  /** Line amounts, whole chunks first; they sum to `paid`. */
  chunks: bigint[];
  paid: bigint;
  /** Exact mode: the odd chunk (0n if none). Carry mode: always 0n. */
  remainder: bigint;
  /** True when a line differs from the chunk size and so stands out in the batch. */
  hasDistinctiveRemainder: boolean;
  /** Carry mode: amount to carry into the next run. Exact mode: always 0n. */
  carryOut: bigint;
};

/** Sanity cap on lines per recipient; a larger split is almost certainly a unit mistake. */
export const MAX_CHUNKS_PER_RECIPIENT = 10_000;

function checkCount(count: bigint): void {
  if (count > BigInt(MAX_CHUNKS_PER_RECIPIENT)) {
    throw new Error(`denominations: ${count} chunks exceeds ${MAX_CHUNKS_PER_RECIPIENT}; chunk size too small?`);
  }
}

function checkChunk(chunkSize: bigint): void {
  if (chunkSize <= 0n) throw new Error("denominations: chunk size must be positive");
  if (chunkSize > MAX_LINE_AMOUNT) throw new Error("denominations: chunk size exceeds the uint80 line cap");
}

export function splitIntoDenominations(
  amount: bigint,
  chunkSize: bigint,
  policy: DenominationPolicy = { mode: "exact" },
): DenominationSplit {
  checkChunk(chunkSize);
  if (amount < 0n) throw new Error("denominations: amount must be non-negative");

  if (policy.mode === "exact") {
    const whole = amount / chunkSize;
    const remainder = amount % chunkSize;
    checkCount(whole + (remainder > 0n ? 1n : 0n));
    const chunks = Array.from({ length: Number(whole) }, () => chunkSize);
    if (remainder > 0n) chunks.push(remainder);
    return { chunks, paid: amount, remainder, hasDistinctiveRemainder: remainder > 0n, carryOut: 0n };
  }

  const due = amount + policy.carryIn;
  // Round half up to the nearest whole chunk; never pay a negative count.
  const count = due <= 0n ? 0n : (2n * due + chunkSize) / (2n * chunkSize);
  const paid = count * chunkSize;
  const chunks = Array.from({ length: Number(count) }, () => chunkSize);
  return { chunks, paid, remainder: 0n, hasDistinctiveRemainder: false, carryOut: due - paid };
}

export type RunPolicy = { mode: "exact" } | { mode: "carry" };

export type DenominatedRecipient = { amount: bigint; carryIn?: bigint };

export type DenominatedRunStats = {
  totalLines: number;
  totalPaid: bigint;
  /** Number of distinct line amounts in the batch (1 is ideal). */
  distinctAmounts: number;
  /** Lines whose amount differs from the chunk size. */
  distinctiveRemainderCount: number;
  /** Line amounts that occur exactly once in the batch: these single out a recipient. */
  uniqueAmountCount: number;
  fitsInOneTx: boolean;
  txCount: number;
};

export type DenominatedRun<R extends DenominatedRecipient> = {
  /** Per-recipient split, same order as the input. */
  recipients: (R & { amounts: bigint[]; paid: bigint; carryOut: bigint })[];
  /**
   * One entry per chunk, ready for payrun's `derivePayRun` (a fresh stealth address per
   * chunk). The recipient's `amount` is replaced by the chunk amount; `carryIn` is dropped.
   * Order is irrelevant: the pay run sorts all lines globally by stealth address.
   */
  lines: (Omit<R, "amount" | "carryIn"> & { amount: bigint })[];
  stats: DenominatedRunStats;
};

export function planDenominatedRun<R extends DenominatedRecipient>(
  recipients: readonly R[],
  chunkSize: bigint,
  policy: RunPolicy = { mode: "exact" },
  maxLinesPerTx: number = MAX_LINES_PER_TX,
): DenominatedRun<R> {
  checkChunk(chunkSize);
  const out: DenominatedRun<R>["recipients"] = [];
  const lines: DenominatedRun<R>["lines"] = [];
  const counts = new Map<bigint, number>();
  let totalPaid = 0n;
  let distinctiveRemainderCount = 0;

  for (const r of recipients) {
    const split = splitIntoDenominations(
      r.amount,
      chunkSize,
      policy.mode === "exact" ? { mode: "exact" } : { mode: "carry", carryIn: r.carryIn ?? 0n },
    );
    out.push({ ...r, amounts: split.chunks, paid: split.paid, carryOut: split.carryOut });
    const { amount: _a, carryIn: _c, ...rest } = r;
    for (const amount of split.chunks) {
      lines.push({ ...rest, amount } as DenominatedRun<R>["lines"][number]);
      counts.set(amount, (counts.get(amount) ?? 0) + 1);
      if (amount !== chunkSize) distinctiveRemainderCount++;
    }
    totalPaid += split.paid;
  }

  const totalLines = lines.length;
  return {
    recipients: out,
    lines,
    stats: {
      totalLines,
      totalPaid,
      distinctAmounts: counts.size,
      distinctiveRemainderCount,
      uniqueAmountCount: [...counts.values()].filter((n) => n === 1).length,
      fitsInOneTx: totalLines <= maxLinesPerTx,
      txCount: Math.ceil(totalLines / maxLinesPerTx),
    },
  };
}

export const SMALL_TEAM_THRESHOLD = 10;

/** Below ~10 recipients, amounts or chunk counts alone can identify people (CLAUDE.md open issue). */
export function smallTeamWarning(recipientCount: number): string | null {
  if (recipientCount >= SMALL_TEAM_THRESHOLD) return null;
  return (
    `Only ${recipientCount} recipient${recipientCount === 1 ? "" : "s"} in this run. ` +
    `With fewer than ${SMALL_TEAM_THRESHOLD}, coworkers can often tell lines apart by amount or by elimination, ` +
    "even with denominated payouts."
  );
}

export type ChunkSuggestion = { chunkSize: bigint; totalLines: number; distinctAmounts: number };

/**
 * Heuristic: tries 1/2/5 x 10^k chunk sizes (in base units) plus the gcd of the
 * amounts, keeps those whose exact-mode line count fits `maxLines`, and picks the one
 * with the fewest distinct line amounts, then the fewest lines. Returns null when no
 * candidate fits (or there are no positive amounts).
 */
export function suggestChunkSize(amounts: readonly bigint[], maxLines: number = MAX_LINES_PER_TX): ChunkSuggestion | null {
  const positive = amounts.filter((a) => a > 0n);
  if (positive.length === 0) return null;
  const max = positive.reduce((a, b) => (a > b ? a : b));

  const candidates = new Set<bigint>();
  for (let p = 1n; p <= max; p *= 10n) for (const m of [1n, 2n, 5n]) if (m * p <= max) candidates.add(m * p);
  candidates.add(positive.reduce(gcd));

  let best: ChunkSuggestion | null = null;
  for (const c of candidates) {
    if (c > MAX_LINE_AMOUNT) continue;
    let totalLines = 0;
    const distinct = new Set<bigint>();
    for (const a of positive) {
      totalLines += Number(a / c) + (a % c > 0n ? 1 : 0);
      if (a >= c) distinct.add(c);
      if (a % c > 0n) distinct.add(a % c);
    }
    if (totalLines > maxLines) continue;
    const s = { chunkSize: c, totalLines, distinctAmounts: distinct.size };
    if (
      !best ||
      s.distinctAmounts < best.distinctAmounts ||
      (s.distinctAmounts === best.distinctAmounts && s.totalLines < best.totalLines)
    ) {
      best = s;
    }
  }
  return best;
}

function gcd(a: bigint, b: bigint): bigint {
  while (b !== 0n) [a, b] = [b, a % b];
  return a;
}
