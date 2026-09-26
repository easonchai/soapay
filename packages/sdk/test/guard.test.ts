import { describe, expect, it } from "vitest";
import { getAddress, type Address } from "viem";
import {
  ClusterGraph,
  DEFAULT_GUARD_POLICY,
  applySpend,
  balanceView,
  planSpend,
  suggestSources,
} from "../src/guard.js";

const a = (n: number): Address => getAddress(`0x${n.toString(16).padStart(40, "0")}`);
const S1 = a(0x51);
const S2 = a(0x52);
const S3 = a(0x53);
const S4 = a(0x54);
const MAIN = a(0xa1);
const COWORKER = a(0xa2);
const EXCHANGE = a(0xa3);
const OTHER = a(0xa4);
const FRESH1 = a(0xf1);
const FRESH2 = a(0xf2);

function graph() {
  const g = new ClusterGraph();
  for (const s of [S1, S2, S3, S4]) g.addStealth(s);
  g.setLabel(MAIN, "main-wallet").setLabel(COWORKER, "coworker-known").setLabel(EXCHANGE, "exchange");
  g.setLabel(OTHER, "other");
  return g;
}

describe("ClusterGraph", () => {
  it("starts every stealth address in its own cluster", () => {
    const g = graph();
    const ids = [S1, S2, S3, S4].map((s) => g.clusterOf(s));
    expect(new Set(ids).size).toBe(4);
    expect(g.cluster(S1)).toMatchObject({ stealth: [S1], destinations: [], labels: [], identified: false });
  });

  it("treats main-wallet and coworker-known (and exchange) as identifiable by default", () => {
    expect(DEFAULT_GUARD_POLICY.identifiableLabels).toEqual(
      expect.arrayContaining(["main-wallet", "coworker-known"]),
    );
  });

  it("normalises address case", () => {
    const g = graph();
    expect(g.clusterOf(S1.toLowerCase() as Address)).toBe(S1);
  });
});

describe("planSpend", () => {
  it("allows one address to a fresh destination", () => {
    const p = planSpend(graph(), { from: [S1], to: FRESH1 });
    expect(p).toMatchObject({ decision: "allow", wouldMerge: false, identifiable: false, warnings: [] });
  });

  it("warns when several addresses are spent in one operation", () => {
    const p = planSpend(graph(), { from: [S1, S2], to: FRESH1 });
    expect(p.decision).toBe("warn");
    expect(p.wouldMerge).toBe(true);
    expect(p.mergedClusterIds.sort()).toEqual([S1, S2].sort());
    expect(p.warnings.map((w) => w.code)).toContain("merge-clusters");
  });

  it("does not warn again for addresses already in one cluster", () => {
    const g = graph();
    applySpend(g, planSpend(g, { from: [S1, S2], to: FRESH1 }));
    const p = planSpend(g, { from: [S1, S2], to: FRESH2 });
    expect(p.decision).toBe("allow");
    expect(p.wouldMerge).toBe(false);
  });

  it("warns when two clusters send to the same fresh destination", () => {
    const g = graph();
    applySpend(g, planSpend(g, { from: [S1], to: FRESH1 }));
    const p = planSpend(g, { from: [S2], to: FRESH1 });
    expect(p.decision).toBe("warn");
    expect(p.wouldMerge).toBe(true);
    expect(p.warnings.map((w) => w.code)).toEqual(["reuse-destination"]);
    applySpend(g, p);
    expect(g.clusterOf(S1)).toBe(g.clusterOf(S2));
    expect(g.cluster(S1).destinations).toEqual([FRESH1]);
  });

  it.each(["main-wallet", "coworker-known", "exchange"] as const)("blocks sending to a %s address", (label) => {
    const to = { "main-wallet": MAIN, "coworker-known": COWORKER, exchange: EXCHANGE }[label];
    const p = planSpend(graph(), { from: [S1], to });
    expect(p.decision).toBe("block");
    expect(p.identifiable).toBe(true);
    expect(p.warnings.map((w) => w.code)).toContain("identifiable-destination");
  });

  it("treats 'other' as not identifiable by default, and the policy is configurable", () => {
    expect(planSpend(graph(), { from: [S1], to: OTHER }).decision).toBe("allow");
    const strict = new ClusterGraph({ identifiableLabels: ["main-wallet", "coworker-known", "exchange", "other"] });
    strict.addStealth(S1).setLabel(OTHER, "other");
    expect(planSpend(strict, { from: [S1], to: OTHER }).decision).toBe("block");
    const lax = new ClusterGraph({ identifiableLabels: ["main-wallet"] });
    lax.addStealth(S1).setLabel(COWORKER, "coworker-known");
    expect(planSpend(lax, { from: [S1], to: COWORKER }).decision).toBe("allow");
  });

  it("override turns a block into a warning and applySpend refuses blocked plans", () => {
    const g = graph();
    const blocked = planSpend(g, { from: [S1], to: MAIN });
    expect(() => applySpend(g, blocked)).toThrow(/blocked/);
    const p = planSpend(g, { from: [S1], to: MAIN, override: true });
    expect(p.decision).toBe("warn");
    expect(p.warnings.map((w) => w.code)).toEqual(["identifiable-destination", "override-used"]);
    applySpend(g, p);
    expect(g.cluster(S1).identified).toBe(true);
    expect(g.cluster(S1).labels).toEqual(["main-wallet"]);
  });

  it("identifiability is transitive through shared destinations", () => {
    const g = graph();
    // S1 pays FRESH1, then S1 is (by override) linked to the main wallet.
    applySpend(g, planSpend(g, { from: [S1], to: FRESH1 }));
    applySpend(g, planSpend(g, { from: [S1], to: MAIN, override: true }));
    // FRESH1 now sits in a cluster that touched MAIN, so S2 → FRESH1 is blocked.
    const p = planSpend(g, { from: [S2], to: FRESH1 });
    expect(p.identifiable).toBe(true);
    expect(p.decision).toBe("block");
    // And via a second hop: S3 paid FRESH2 earlier, S2 → FRESH2 merges S2 with S3 only.
    applySpend(g, planSpend(g, { from: [S3], to: FRESH2 }));
    expect(planSpend(g, { from: [S2], to: FRESH2 }).decision).toBe("warn");
    // Once S3's cluster reaches FRESH1 by override, FRESH2 is identifiable too.
    applySpend(g, planSpend(g, { from: [S3], to: FRESH1, override: true }));
    expect(planSpend(g, { from: [S4], to: FRESH2 }).decision).toBe("block");
  });

  it("does not block a cluster already linked to the destination", () => {
    const g = graph();
    applySpend(g, planSpend(g, { from: [S1], to: MAIN, override: true }));
    const p = planSpend(g, { from: [S1], to: MAIN });
    expect(p.identifiable).toBe(true);
    expect(p.decision).toBe("allow");
    expect(p.warnings.map((w) => w.code)).toEqual(["already-linked"]);
  });

  it("warns that consolidating denominated chunks of one pay run leaks the salary", () => {
    const g = new ClusterGraph();
    g.addStealth(S1, { runId: "2026-09", amount: 500n }).addStealth(S2, { runId: "2026-09", amount: 500n });
    g.addStealth(S3, { runId: "2026-08", amount: 500n });
    const same = planSpend(g, { from: [S1, S2], to: FRESH1 });
    expect(same.warnings.map((w) => w.code)).toEqual(["merge-clusters", "amount-leak"]);
    const different = planSpend(g, { from: [S1, S3], to: FRESH1 });
    expect(different.warnings.map((w) => w.code)).toEqual(["merge-clusters"]);
    // Also when the link happens through a reused destination.
    applySpend(g, planSpend(g, { from: [S1], to: FRESH2 }));
    expect(planSpend(g, { from: [S2], to: FRESH2 }).warnings.map((w) => w.code)).toContain("amount-leak");
  });

  it("treats unknown source addresses as fresh singletons and rejects bad input", () => {
    const g = new ClusterGraph();
    expect(planSpend(g, { from: [S1], to: FRESH1 }).decision).toBe("allow");
    expect(planSpend(g, { from: [S1, S2], to: FRESH1 }).wouldMerge).toBe(true);
    expect(() => planSpend(g, { from: [], to: FRESH1 })).toThrow();
    expect(() => planSpend(g, { from: [S1], to: S1 })).toThrow();
    expect(() => planSpend(g, { from: ["0x12" as Address], to: FRESH1 })).toThrow(/invalid/);
  });
});

describe("serialization", () => {
  it("round-trips through toJSON/fromJSON", () => {
    const g = new ClusterGraph({ identifiableLabels: ["main-wallet", "coworker-known"] });
    g.addStealth(S1, { runId: "r1", amount: 123n }).addStealth(S2).addStealth(S3).setLabel(MAIN, "main-wallet");
    applySpend(g, planSpend(g, { from: [S1, S2], to: FRESH1 }));
    applySpend(g, planSpend(g, { from: [S3], to: MAIN, override: true }));

    const json = JSON.stringify(g.toJSON());
    const back = ClusterGraph.fromJSON(json);
    expect(back.toJSON()).toEqual(g.toJSON());
    expect(back.policy).toEqual(g.policy);
    expect(back.clusterOf(S1)).toBe(back.clusterOf(FRESH1));
    expect(back.cluster(S3).identified).toBe(true);
    expect(back.runIdOf(S1)).toBe("r1");
    expect(planSpend(back, { from: [S4], to: MAIN })).toEqual(planSpend(g, { from: [S4], to: MAIN }));
  });

  it("rejects unknown versions", () => {
    expect(() => ClusterGraph.fromJSON({ ...new ClusterGraph().toJSON(), version: 2 } as never)).toThrow(/version/);
  });
});

describe("balanceView and suggestSources", () => {
  function funded() {
    const g = graph();
    applySpend(g, planSpend(g, { from: [S1, S2], to: FRESH1 })); // S1+S2 one cluster
    const balances = new Map<Address, bigint>([
      [S1, 300n],
      [S2, 400n],
      [S3, 1_000n],
      [S4, 250n],
    ]);
    return { g, balances };
  }

  it("groups balances by cluster, largest first", () => {
    const { g, balances } = funded();
    const view = balanceView(g, balances);
    expect(view.total).toBe(1_950n);
    expect(view.clusters.map((c) => c.total)).toEqual([1_000n, 700n, 250n]);
    expect(view.clusters[1]?.addresses.map((x) => x.address)).toEqual([S2, S1]);
  });

  it("accepts a plain record and places unknown addresses in their own cluster", () => {
    const view = balanceView(new ClusterGraph(), { [S1]: 5n, [S2]: 7n });
    expect(view.clusters).toHaveLength(2);
  });

  it("prefers a single covering address (smallest that fits)", () => {
    const { g, balances } = funded();
    expect(suggestSources(g, balances, 200n)).toMatchObject({ from: [S4], merges: 0, sufficient: true });
    expect(suggestSources(g, balances, 900n)).toMatchObject({ from: [S3], merges: 0 });
  });

  it("uses addresses already in one cluster before merging clusters", () => {
    const g = graph();
    applySpend(g, planSpend(g, { from: [S1, S2], to: FRESH1 }));
    const balances = { [S1]: 300n, [S2]: 400n, [S3]: 350n, [S4]: 350n };
    const s = suggestSources(g, balances, 650n);
    expect(s.merges).toBe(0);
    expect(new Set(s.from)).toEqual(new Set([S1, S2]));
  });

  it("merges the fewest clusters when it must, and reports shortfalls", () => {
    const { g, balances } = funded();
    const s = suggestSources(g, balances, 1_500n);
    expect(s.merges).toBe(1);
    expect(s.sufficient).toBe(true);
    expect(s.total).toBeGreaterThanOrEqual(1_500n);
    expect(planSpend(g, { from: s.from, to: FRESH2 }).wouldMerge).toBe(true);
    const short = suggestSources(g, balances, 10_000n);
    expect(short).toMatchObject({ sufficient: false, merges: 2, total: 1_950n });
  });
});
