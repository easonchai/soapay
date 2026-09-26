import { describe, expect, it } from "vitest";
import type { Address, Hash } from "viem";
import { draftPreview } from "../src/lib/preview.js";
import type { RunRecord } from "../src/lib/run.js";
import { employeePaySummary, employeeWallets, historyCsv, walletSpendStatus } from "../src/lib/wallets.js";

const A = (n: number) => `0x${n.toString(16).padStart(40, "0")}` as Address;
const H = (n: number) => `0x${n.toString(16).padStart(64, "0")}` as Hash;
const TOKEN = A(0xabc);

function run(id: string, createdAt: number, path: RunRecord["path"], chunks: { status: "landed" | "failed" | "pending"; lines: [string, bigint, number][]; tx?: number }[]): RunRecord {
  return {
    id,
    createdAt,
    chainId: 84532,
    path,
    token: TOKEN,
    denomination: null,
    carryOut: {},
    carryCommitted: false,
    excluded: [],
    attempts: [
      {
        index: 0,
        startedAt: createdAt,
        chunks: chunks.map((c, i) => ({
          index: i,
          status: c.status,
          amount: c.lines.reduce((s, l) => s + l[1], 0n),
          ...(c.tx ? { txHash: H(c.tx) } : {}),
          lines: c.lines.map(([emp, amount, addr]) => ({ employeeId: emp, name: emp.toUpperCase(), amount, stealthAddress: A(addr) })),
        })),
      },
    ],
  };
}

const runs = [
  run("r1", 1_000, "batch", [{ status: "landed", tx: 1, lines: [["alice", 500n, 1], ["alice", 200n, 2], ["bob", 300n, 3]] }]),
  run("r2", 2_000, "disperse", [
    { status: "landed", tx: 2, lines: [["alice", 700n, 4]] },
    { status: "failed", lines: [["bob", 300n, 5]] },
  ]),
  run("r3", 3_000, "safe-export", [{ status: "pending", lines: [["alice", 700n, 6]] }]),
];

describe("employee wallets (CK's company view, derived from run records)", () => {
  it("lists landed wallets newest first, with the tx", () => {
    const w = employeeWallets(runs, "alice");
    expect(w.map((x) => x.stealthAddress)).toEqual([A(4), A(1), A(2)]);
    expect(w[0]).toMatchObject({ runId: "r2", amount: 700n, status: "landed", txHash: H(2) });
  });

  it("with all: includes failed and exported lines", () => {
    const bob = employeeWallets(runs, "bob", { all: true });
    expect(bob.map((x) => x.status)).toEqual(["failed", "landed"]);
    expect(employeeWallets(runs, "alice", { all: true })[0]).toMatchObject({ runId: "r3", status: "exported" });
  });

  it("summarises the last landed run", () => {
    expect(employeePaySummary(runs, "alice")).toEqual({ lastPaidAt: 2_000, lastRunAmount: 700n, runs: 2, wallets: 3 });
    expect(employeePaySummary(runs, "bob")).toEqual({ lastPaidAt: 1_000, lastRunAmount: 300n, runs: 1, wallets: 1 });
    expect(employeePaySummary(runs, "carol")).toEqual({ lastPaidAt: null, lastRunAmount: 0n, runs: 0, wallets: 0 });
  });

  it("spend status only for landed wallets", () => {
    const [latest] = employeeWallets(runs, "alice");
    expect(walletSpendStatus(latest!, 700n)).toBe("unspent");
    expect(walletSpendStatus(latest!, 100n)).toBe("partly spent");
    expect(walletSpendStatus(latest!, 0n)).toBe("withdrawn");
    expect(walletSpendStatus(latest!, undefined)).toBe("unknown");
    const exported = employeeWallets(runs, "alice", { all: true })[0]!;
    expect(walletSpendStatus(exported, 0n)).toBeNull();
  });

  it("exports every line as CSV", () => {
    const csv = historyCsv(runs, (v) => v.toString()).trim().split("\n");
    expect(csv[0]).toBe("run_id,date,path,employee,stealth_address,amount_usdc,status,tx_hash");
    expect(csv).toHaveLength(1 + 3 + 2 + 1);
    expect(csv).toContain(`r2,${new Date(2_000).toISOString()},disperse,BOB,${A(5)},300,failed,`);
    expect(csv.at(-1)).toContain(",exported,");
  });
});

describe("draftPreview", () => {
  const u = (n: number) => BigInt(n) * 1_000_000n;
  it("one line per salary without denominations", () => {
    expect(draftPreview([u(4200), u(3850)], null)).toMatchObject({ total: u(8050), lines: 2, txCount: 1, perAmount: [1, 1], error: null });
  });
  it("uses the SDK split rules (whole chunks + one remainder line)", () => {
    const p = draftPreview([u(4200), u(500), u(200)], { chunkSize: u(500), mode: "exact" });
    expect(p.perAmount).toEqual([9, 1, 1]);
    expect(p.lines).toBe(11);
  });
  it("counts transactions of at most 350 lines", () => {
    expect(draftPreview([u(351)], { chunkSize: u(1), mode: "exact" }).txCount).toBe(2);
  });
  it("reports a bad chunk instead of throwing", () => {
    expect(draftPreview([u(1)], { chunkSize: 0n, mode: "exact" }).error).toMatch(/chunk/);
  });
});
