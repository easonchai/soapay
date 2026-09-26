import { describe, expect, it } from "vitest";
import { compareAddresses, generateMnemonic, keysFromMnemonic, MAX_LINES_PER_TX } from "@soapay/sdk";
import {
  attemptFromPlan,
  MAX_RUN_LABEL,
  normalizeRunLabel,
  runTitle,
  canRetry,
  planRetry,
  planRun,
  remainingObligations,
  runReport,
  runStatus,
  type PlanRecipient,
  type RunRecord,
} from "../src/lib/run.js";

const metas = Array.from({ length: 3 }, () => keysFromMnemonic(generateMnemonic()).metaAddressURI);

function recipients(n: number, amount = (i: number) => BigInt(1000 + i) * 1_000_000n): PlanRecipient[] {
  return Array.from({ length: n }, (_, i) => ({
    employeeId: `e${i}`,
    name: `emp${i}.soapay.eth`,
    metaAddressURI: metas[i % metas.length]!,
    amount: amount(i),
  }));
}

function record(plan: ReturnType<typeof planRun>): RunRecord {
  return {
    id: "r1",
    createdAt: 0,
    chainId: 84532,
    path: "disperse",
    token: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    stealthDisperse: "0x000000000000000000000000000000000000dEaD",
    denomination: null,
    carryOut: {},
    carryCommitted: false,
    excluded: [],
    attempts: [attemptFromPlan(plan, 0, 0)],
  };
}

describe("run planning", () => {
  it("sorts globally and chunks ≤350 without grouping by employee", () => {
    // 40 employees × 20 denominated lines = 800 lines → 3 chunks.
    const plan = planRun(recipients(40, () => 20_000_000n), { chunkSize: 1_000_000n, mode: "exact" });
    expect(plan.lines).toHaveLength(800);
    expect(plan.chunks.map((c) => c.length)).toEqual([267, 267, 266]);
    expect(plan.chunks.every((c) => c.length <= MAX_LINES_PER_TX)).toBe(true);

    // Concatenated chunks are exactly the globally sorted run.
    const flat = plan.chunks.flat();
    for (let i = 1; i < flat.length; i++) expect(compareAddresses(flat[i - 1]!.stealthAddress, flat[i]!.stealthAddress)).toBe(-1);

    // No chunk is one employee's lines: employees are spread across chunks.
    const perChunk = plan.chunks.map((c) => new Set(c.map((l) => l.recipientId)));
    expect(perChunk.every((s) => s.size > 1)).toBe(true);
    const spread = [...plan.perEmployee.keys()].filter((id) => perChunk.filter((s) => s.has(id)).length > 1);
    expect(spread.length).toBeGreaterThan(20);

    // Fresh ephemeral key and stealth address per line.
    expect(new Set(plan.lines.map((l) => l.ephemeralPublicKey)).size).toBe(800);
    expect(new Set(plan.lines.map((l) => l.stealthAddress)).size).toBe(800);
    expect(plan.total).toBe(800_000_000n);
    expect(plan.estimate.txCount).toBe(3);
  });

  it("derives the same employee's meta-address to different addresses every run", () => {
    const a = planRun(recipients(1), null);
    const b = planRun(recipients(1), null);
    expect(a.lines[0]!.stealthAddress).not.toBe(b.lines[0]!.stealthAddress);
  });

  it("reports denomination stats and the small-team warning", () => {
    const plan = planRun(recipients(3, (i) => [2_500_000_000n, 3_000_000_000n, 2_750_000_000n][i]!), {
      chunkSize: 500_000_000n,
      mode: "exact",
    });
    expect(plan.denomStats).toMatchObject({ totalLines: 17, distinctAmounts: 2, distinctiveRemainderCount: 1 });
    expect(plan.smallTeam).toMatch(/Only 3 recipients/);
    expect(planRun(recipients(12), null).smallTeam).toBeNull();
  });

  it("carry mode rounds and records carry-out per employee", () => {
    const plan = planRun([{ ...recipients(1)[0]!, amount: 1_200_000_000n, carryIn: 0n }], { chunkSize: 500_000_000n, mode: "carry" });
    expect(plan.lines.every((l) => l.amount === 500_000_000n)).toBe(true);
    expect(plan.total).toBe(1_000_000_000n);
    expect(plan.carryOut.get("e0")).toBe(200_000_000n);
  });
});

describe("partial failure and retry", () => {
  it("retry re-derives only the unpaid lines with fresh addresses", () => {
    const plan = planRun(recipients(30, () => 12_000_000n), { chunkSize: 1_000_000n, mode: "exact" }); // 360 lines, 2 chunks
    expect(plan.chunks.map((c) => c.length)).toEqual([180, 180]);
    let run = record(plan);
    const a = run.attempts[0]!;
    run = {
      ...run,
      attempts: [
        {
          ...a,
          approve: { amount: plan.total, status: "landed" },
          chunks: [
            { ...a.chunks[0]!, status: "landed", txHash: "0x01" },
            { ...a.chunks[1]!, status: "failed", error: "Transaction reverted" },
          ],
        },
      ],
    };
    expect(runStatus(run)).toBe("partial");
    expect(canRetry(run)).toEqual({ ok: true });

    const owed = remainingObligations(run);
    expect(owed).toHaveLength(180);
    const pins = new Map(recipients(30).map((r) => [r.employeeId, r.metaAddressURI]));
    const retry = planRetry(owed, pins);

    const oldAddresses = new Set(run.attempts[0]!.chunks.flatMap((c) => c.lines.map((l) => l.stealthAddress)));
    expect(retry.lines).toHaveLength(180);
    expect(retry.lines.some((l) => oldAddresses.has(l.stealthAddress))).toBe(false);
    // Same amounts per employee as what was owed.
    const owedBy = new Map<string, bigint>();
    for (const o of owed) owedBy.set(o.employeeId, (owedBy.get(o.employeeId) ?? 0n) + o.amount);
    for (const [id, p] of retry.perEmployee) expect(p.amount).toBe(owedBy.get(id));
    const flat = retry.chunks.flat();
    for (let i = 1; i < flat.length; i++) expect(compareAddresses(flat[i - 1]!.stealthAddress, flat[i]!.stealthAddress)).toBe(-1);

    // Report: landed lines count as paid, the failed chunk as outstanding.
    const report = runReport(run);
    const paid = report.reduce((s, r) => s + r.paid, 0n);
    const outstanding = report.reduce((s, r) => s + r.outstanding, 0n);
    expect(paid + outstanding).toBe(plan.total);
    expect(paid).toBe(run.attempts[0]!.chunks[0]!.amount);
  });

  it("refuses to retry while a transaction's outcome is unknown", () => {
    const plan = planRun(recipients(3), null);
    const run = record(plan);
    const a = run.attempts[0]!;
    const unknown: RunRecord = { ...run, attempts: [{ ...a, chunks: [{ ...a.chunks[0]!, status: "unknown", txHash: "0xab" }] }] };
    expect(runStatus(unknown)).toBe("needs-check");
    expect(canRetry(unknown).ok).toBe(false);
  });

  it("refuses to retry a line whose employee isn't re-verified", () => {
    expect(() => planRetry([{ employeeId: "x", name: "x.eth", amount: 1n }], new Map())).toThrow(/not payable/);
  });

  it("records keep no ephemeral keys", () => {
    const run = record(planRun(recipients(2), null));
    const json = JSON.stringify(run, (_k, v) => (typeof v === "bigint" ? v.toString() : v));
    expect(json).not.toMatch(/ephemeral|keyX|viewTag/i);
  });
});

describe("run label", () => {
  it("is optional, trimmed and capped; the title falls back when unset", () => {
    expect(normalizeRunLabel(undefined)).toBeUndefined();
    expect(normalizeRunLabel("   ")).toBeUndefined();
    expect(normalizeRunLabel("  September   payroll ")).toBe("September payroll");
    expect(normalizeRunLabel("x".repeat(200))).toHaveLength(MAX_RUN_LABEL);
    expect(runTitle({ label: "Sep" }, "Batch · 1 Sep")).toBe("Sep");
    expect(runTitle({}, "Batch · 1 Sep")).toBe("Batch · 1 Sep");
  });
});
