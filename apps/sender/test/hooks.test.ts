import { describe, expect, it } from "vitest";
import { parseRoute, routeHref } from "../src/hooks/useRoute.js";
import { checkFunding } from "../src/hooks/usePayRun.js";
import type { RunPlan } from "../src/lib/run.js";

describe("hash routes", () => {
  it("round-trips every page", () => {
    for (const r of [{ page: "roster" }, { page: "pay" }, { page: "history" }, { page: "settings" }, { page: "run", id: "a/b c" }] as const) {
      expect(parseRoute(routeHref(r))).toEqual(r);
    }
  });
  it("falls back to the roster", () => {
    expect(parseRoute("")).toEqual({ page: "roster" });
    expect(parseRoute("#/nope")).toEqual({ page: "roster" });
    expect(parseRoute("#/runs")).toEqual({ page: "history" });
  });
});

describe("checkFunding", () => {
  const plan = { total: 10_000_000n, estimate: { totalGas: 100_000n } } as unknown as RunPlan;
  it("flags a short USDC balance and missing gas", () => {
    const f = checkFunding(plan, { usdcBalance: 9_000_000n, allowance: null, ethBalance: 1n, gasPrice: 10n });
    expect(f.feeWei).toBe(1_000_000n);
    expect(f.problems).toHaveLength(2);
  });
  it("is quiet when funded or unknown", () => {
    expect(checkFunding(plan, { usdcBalance: 10_000_000n, allowance: null, ethBalance: 10n ** 18n, gasPrice: 10n }).problems).toEqual([]);
    expect(checkFunding(plan, null)).toEqual({ problems: [], feeWei: null });
  });
});
