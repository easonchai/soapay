// CK's company view (M1 companyStore): which stealth wallets each employee was paid into, and
// what their live balances say. Here it is DERIVED from our encrypted run records instead of a
// second plaintext localStorage store. The employer is trusted under the threat model, so this
// name → wallet → amount view is fine; a stored wallet is a record and never a payment target.
import type { Address, Hash } from "viem";
import { spendStatus, type SpendStatus } from "@soapay/sdk";
import { runReport, type RunRecord, type StepStatus } from "./run.js";

export type EmployeeWallet = {
  runId: string;
  sentAt: number;
  stealthAddress: Address;
  amount: bigint;
  /** Landed on chain, still pending/unknown, failed, or exported to a Safe (not trackable here). */
  status: StepStatus | "exported";
  txHash?: Hash;
};

/** Every line ever planned for `employeeId`, newest run first. Landed lines only unless `all`. */
export function employeeWallets(runs: readonly RunRecord[], employeeId: string, opts: { all?: boolean } = {}): EmployeeWallet[] {
  const out: EmployeeWallet[] = [];
  for (const run of runs) {
    const row = runReport(run).find((r) => r.employeeId === employeeId);
    if (!row) continue;
    for (const l of row.lines) {
      const status = run.path === "safe-export" ? "exported" : l.status;
      if (!opts.all && status !== "landed") continue;
      out.push({
        runId: run.id,
        sentAt: run.createdAt,
        stealthAddress: l.stealthAddress,
        amount: l.amount,
        status,
        ...(l.txHash ? { txHash: l.txHash } : {}),
      });
    }
  }
  return out.sort((a, b) => b.sentAt - a.sentAt);
}

export type EmployeePaySummary = { lastPaidAt: number | null; lastRunAmount: bigint; runs: number; wallets: number };

/** Last landed run's total for the employee, how many runs paid them and into how many wallets. */
export function employeePaySummary(runs: readonly RunRecord[], employeeId: string): EmployeePaySummary {
  const landed = employeeWallets(runs, employeeId);
  const lastRun = landed[0]?.runId;
  return {
    lastPaidAt: landed[0]?.sentAt ?? null,
    lastRunAmount: landed.filter((w) => w.runId === lastRun).reduce((s, w) => s + w.amount, 0n),
    runs: new Set(landed.map((w) => w.runId)).size,
    wallets: landed.length,
  };
}

const csvCell = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);

/**
 * CK's History "Export CSV": one row per line across every run and attempt (name → stealth
 * address → amount). Private to the employer; the file never leaves their machine.
 */
export function historyCsv(runs: readonly RunRecord[], formatAmount: (v: bigint) => string): string {
  const head = "run_id,date,path,employee,stealth_address,amount_usdc,status,tx_hash";
  const body: string[] = [];
  for (const run of [...runs].sort((a, b) => a.createdAt - b.createdAt)) {
    for (const r of runReport(run)) {
      for (const l of r.lines) {
        body.push(
          [
            run.id,
            new Date(run.createdAt).toISOString(),
            run.path,
            csvCell(r.name),
            l.stealthAddress,
            formatAmount(l.amount),
            run.path === "safe-export" ? "exported" : l.status,
            l.txHash ?? "",
          ].join(","),
        );
      }
    }
  }
  return `${head}\n${body.join("\n")}${body.length ? "\n" : ""}`;
}

/** Spend status of a landed wallet from its live balance (undefined/null = not read yet). */
export function walletSpendStatus(w: EmployeeWallet, liveBalance: bigint | null | undefined): SpendStatus | null {
  return w.status === "landed" ? spendStatus(w.amount, liveBalance) : null;
}
