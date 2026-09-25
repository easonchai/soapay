import { describe, expect, it } from "vitest";
import {
  planDenominatedRun,
  smallTeamWarning,
  splitIntoDenominations,
  suggestChunkSize,
} from "../src/denominations.js";

const U = 1_000_000n; // 1 USDC in base units
const CHUNK = 500n * U;

// Deterministic PRNG so property loops are reproducible.
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s;
  };
}

const sum = (xs: readonly bigint[]) => xs.reduce((a, b) => a + b, 0n);

describe("splitIntoDenominations", () => {
  it("exact mode (default) pays whole chunks plus a flagged remainder", () => {
    const s = splitIntoDenominations(4_321n * U, CHUNK);
    expect(s.chunks).toEqual([...Array(8).fill(CHUNK), 321n * U]);
    expect(s.paid).toBe(4_321n * U);
    expect(s.remainder).toBe(321n * U);
    expect(s.hasDistinctiveRemainder).toBe(true);
    expect(s.carryOut).toBe(0n);
  });

  it("exact mode with no remainder has no distinctive line", () => {
    const s = splitIntoDenominations(1_500n * U, CHUNK, { mode: "exact" });
    expect(s.chunks).toEqual([CHUNK, CHUNK, CHUNK]);
    expect(s.hasDistinctiveRemainder).toBe(false);
  });

  it("handles amounts below one chunk and zero", () => {
    expect(splitIntoDenominations(10n, CHUNK).chunks).toEqual([10n]);
    expect(splitIntoDenominations(0n, CHUNK).chunks).toEqual([]);
  });

  it("carry mode rounds to the nearest chunk and returns the difference", () => {
    const down = splitIntoDenominations(4_200n * U, CHUNK, { mode: "carry", carryIn: 0n });
    expect(down.chunks).toEqual(Array(8).fill(CHUNK));
    expect(down.carryOut).toBe(200n * U);
    const up = splitIntoDenominations(4_300n * U, CHUNK, { mode: "carry", carryIn: 0n });
    expect(up.chunks.length).toBe(9);
    expect(up.carryOut).toBe(-200n * U);
    const next = splitIntoDenominations(4_300n * U, CHUNK, { mode: "carry", carryIn: up.carryOut });
    expect(next.paid).toBe(4_000n * U);
    expect(next.carryOut).toBe(100n * U);
    expect(down.hasDistinctiveRemainder || up.hasDistinctiveRemainder).toBe(false);
  });

  it("rejects bad inputs", () => {
    expect(() => splitIntoDenominations(1n, 0n)).toThrow();
    expect(() => splitIntoDenominations(-1n, CHUNK)).toThrow();
    expect(() => splitIntoDenominations(1n, 1n << 80n)).toThrow(/uint80/);
    expect(() => splitIntoDenominations(10n ** 12n, 1n)).toThrow(/chunk size too small/);
  });

  it("property: exact mode chunks always sum to the amount", () => {
    const r = rng(1);
    for (let i = 0; i < 2_000; i++) {
      const amount = BigInt(r()) * BigInt(r() % 1000);
      const chunk = amount / BigInt((r() % 500) + 1) + BigInt((r() % 1000) + 1);
      const s = splitIntoDenominations(amount, chunk);
      expect(sum(s.chunks)).toBe(amount);
      expect(s.chunks.every((c) => c > 0n && c <= chunk)).toBe(true);
      expect(s.chunks.filter((c) => c !== chunk).length).toBeLessThanOrEqual(1);
    }
  });

  it("property: carry mode conserves value across runs and bounds the carry", () => {
    const r = rng(2);
    for (let trial = 0; trial < 200; trial++) {
      const chunk = BigInt((r() % 10_000) + 1);
      let carry = 0n;
      let owed = 0n;
      let paid = 0n;
      for (let run = 0; run < 24; run++) {
        const wage = BigInt(r() % 1_000_000);
        const s = splitIntoDenominations(wage, chunk, { mode: "carry", carryIn: carry });
        owed += wage;
        paid += sum(s.chunks);
        carry = s.carryOut;
        expect(s.chunks.every((c) => c === chunk)).toBe(true);
        expect(2n * (carry < 0n ? -carry : carry)).toBeLessThanOrEqual(chunk);
      }
      expect(paid + carry).toBe(owed);
    }
  });
});

describe("planDenominatedRun", () => {
  const recipients = [
    { metaAddressURI: "st:eth:0xaa", amount: 3_000n * U },
    { metaAddressURI: "st:eth:0xbb", amount: 4_250n * U },
    { metaAddressURI: "st:eth:0xcc", amount: 2_250n * U },
  ];

  it("returns per-recipient chunks, flat lines for derivePayRun and stats", () => {
    const run = planDenominatedRun(recipients, CHUNK);
    expect(run.recipients.map((r) => r.amounts.length)).toEqual([6, 9, 5]);
    expect(run.lines).toHaveLength(20);
    expect(run.lines[0]).toEqual({ metaAddressURI: "st:eth:0xaa", amount: CHUNK });
    expect(sum(run.lines.map((l) => l.amount))).toBe(9_500n * U);
    expect(run.stats).toEqual({
      totalLines: 20,
      totalPaid: 9_500n * U,
      distinctAmounts: 2,
      distinctiveRemainderCount: 2,
      uniqueAmountCount: 0, // both remainders are 250, so neither is unique
      fitsInOneTx: true,
      txCount: 1,
    });
  });

  it("carry mode uses each recipient's carryIn and has no distinctive lines", () => {
    const run = planDenominatedRun(
      recipients.map((r, i) => ({ ...r, carryIn: i === 0 ? 100n * U : 0n })),
      CHUNK,
      { mode: "carry" },
    );
    expect(run.stats.distinctAmounts).toBe(1);
    expect(run.stats.distinctiveRemainderCount).toBe(0);
    expect(run.recipients[0]?.carryOut).toBe(100n * U);
    expect(run.lines.every((l) => !("carryIn" in l))).toBe(true);
  });

  it("reports the tx count against the 350-line cap", () => {
    const many = Array.from({ length: 80 }, (_, i) => ({ id: i, amount: 5_000n * U }));
    const run = planDenominatedRun(many, CHUNK);
    expect(run.stats.totalLines).toBe(800);
    expect(run.stats.fitsInOneTx).toBe(false);
    expect(run.stats.txCount).toBe(3);
  });
});

describe("smallTeamWarning", () => {
  it("warns below 10 recipients only", () => {
    expect(smallTeamWarning(3)).toMatch(/3 recipients/);
    expect(smallTeamWarning(9)).not.toBeNull();
    expect(smallTeamWarning(10)).toBeNull();
  });
});

describe("suggestChunkSize", () => {
  it("prefers a size with no remainders when it fits the line budget", () => {
    const s = suggestChunkSize([3_000n * U, 4_500n * U, 2_000n * U]);
    expect(s).not.toBeNull();
    expect(s!.distinctAmounts).toBe(1);
    expect(s!.totalLines).toBeLessThanOrEqual(350);
    expect(s!.chunkSize).toBe(500n * U);
  });

  it("respects the max-lines budget", () => {
    const amounts = Array.from({ length: 20 }, (_, i) => BigInt(1_000 + i * 37) * U);
    const s = suggestChunkSize(amounts, 60)!;
    expect(s.totalLines).toBeLessThanOrEqual(60);
    const run = planDenominatedRun(amounts.map((amount) => ({ amount })), s.chunkSize);
    expect(run.stats.totalLines).toBe(s.totalLines);
    expect(run.stats.distinctAmounts).toBe(s.distinctAmounts);
  });

  it("returns null when nothing fits or there are no amounts", () => {
    expect(suggestChunkSize([])).toBeNull();
    expect(suggestChunkSize([10n, 10n], 1)).toBeNull();
  });
});
