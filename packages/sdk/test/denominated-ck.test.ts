// CK's `expandDenominated` cases (M1), run against the one SDK implementation
// (`splitIntoDenominations` / `planDenominatedRun`, exact mode) to show the rules are the same.
import { describe, expect, it } from "vitest";
import { MAX_LINES_PER_TX, planDenominatedRun, splitIntoDenominations } from "../src/index.js";

const u = (n: number) => BigInt(Math.round(n * 1e6));

describe("denominated payouts: CK's M1 cases on the SDK implementation", () => {
  it("splits into equal chunks plus one smaller remainder line", () => {
    const s = splitIntoDenominations(u(4200), u(500));
    expect(s.chunks).toEqual([...Array(8).fill(u(500)), u(200)]);
    expect(s.remainder).toBe(u(200));
    expect(s.hasDistinctiveRemainder).toBe(true);
  });

  it("an exact multiple has no remainder line", () => {
    const s = splitIntoDenominations(u(1000), u(500));
    expect(s.chunks).toEqual([u(500), u(500)]);
    expect(s.hasDistinctiveRemainder).toBe(false);
  });

  it("an amount below the chunk is a single line", () => {
    const s = splitIntoDenominations(u(200), u(500));
    expect(s.chunks).toEqual([u(200)]);
    expect(s.hasDistinctiveRemainder).toBe(true);
  });

  it("rejects a non-positive chunk", () => {
    expect(() => splitIntoDenominations(u(1), 0n)).toThrow(/chunk/i);
  });

  it("keeps each recipient's total across its lines", () => {
    const run = planDenominatedRun(
      [
        { id: "a", amount: u(1200) },
        { id: "b", amount: u(500) },
      ],
      u(500),
      { mode: "exact" },
    );
    expect(run.lines).toHaveLength(4); // 500, 500, 200 + 500
    expect(run.lines.filter((l) => l.id === "a").reduce((t, l) => t + l.amount, 0n)).toBe(u(1200));
  });

  it("uses the 350-line per-tx cap", () => {
    expect(MAX_LINES_PER_TX).toBe(350);
  });
});
