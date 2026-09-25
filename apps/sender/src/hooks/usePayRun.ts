// A new pay run: re-verify every pin → preview (derive, sort globally, chunk ≤350,
// funding and gas) → execute on the connected wallet's path, or export for a Safe.
// The plan (with its fresh stealth addresses) lives only in memory until executed;
// the persisted record keeps {employee, amount, stealth address} per line.
import { useCallback, useState } from "react";
import { useAccount } from "wagmi";
import { getAddress, isAddress, type Address } from "viem";
import { formatUsdc } from "../lib/amount.js";
import { payability, recordChanges, verifyRoster, displayName, type Employee, type Payability, type PinCheck } from "../lib/roster.js";
import { attemptFromPlan, planRun, type Denomination, type RunPlan, type RunRecord } from "../lib/run.js";
import { buildSafeExport, downloadJson, type SafeExportChunk } from "../lib/safeExport.js";
import type { Funding } from "../lib/wallet.js";
import type { Services } from "../lib/services.js";
import { usePayPath } from "./usePayPath.js";
import { useStore } from "./store.js";

export type VerifiedRow = { employee: Employee; check: PinCheck | undefined; payability: Payability };

/** Re-resolves `subset`, applies attested rotations / pending changes, persists, and returns the fresh rows. */
export async function reverifyEmployees(
  services: Services,
  all: readonly Employee[],
  subset: readonly Employee[],
  updateEmployees: (fn: (e: Employee[]) => Employee[]) => Promise<void>,
  onProgress?: (done: number, total: number) => void,
): Promise<VerifiedRow[]> {
  const checks = await verifyRoster(services.resolve, subset, onProgress ? { onProgress } : {});
  const updated = await recordChanges(subset, checks, services.lookupAttestation);
  const byId = new Map(updated.map((e) => [e.id, e]));
  await updateEmployees((list) => list.map((e) => byId.get(e.id) ?? e));
  return all.filter((e) => byId.has(e.id)).map((e) => {
    const fresh = byId.get(e.id)!;
    const check = checks.get(e.id);
    return { employee: fresh, check, payability: payability(fresh, check) };
  });
}

export type FundingCheck = {
  /** Human-readable problems that will make the run fail (empty = looks fundable). */
  problems: string[];
  /** Estimated network fee in wei at the current gas price, if known. */
  feeWei: bigint | null;
};

export function checkFunding(plan: RunPlan, funding: Funding | null): FundingCheck {
  const problems: string[] = [];
  if (!funding) return { problems, feeWei: null };
  if (funding.usdcBalance !== null && funding.usdcBalance < plan.total) {
    problems.push(`USDC balance ${formatUsdc(funding.usdcBalance)} is below the run total ${formatUsdc(plan.total)}`);
  }
  const feeWei = funding.gasPrice !== null ? plan.estimate.totalGas * funding.gasPrice : null;
  if (feeWei !== null && funding.ethBalance !== null && funding.ethBalance < feeWei) {
    problems.push("ETH balance may not cover gas for every transaction");
  }
  return { problems, feeWei };
}

export type PayRunStage = "idle" | "verifying" | "verified" | "planned" | "executing" | "done";

export type PayRunState = {
  stage: PayRunStage;
  rows: VerifiedRow[];
  progress: { done: number; total: number } | null;
  plan: RunPlan | null;
  funding: FundingCheck | null;
  error: string | null;
  /** Id of the record created by execute/exportSafe. */
  runId: string | null;
  safeChunks: SafeExportChunk[] | null;
  verify(): Promise<void>;
  preview(denomination: Denomination | null): void;
  execute(): Promise<void>;
  exportSafe(safeAddress: string): Promise<void>;
  downloadSafeChunk(index: number): void;
  reset(): void;
};

export function usePayRun(): PayRunState {
  const store = useStore();
  const { app, services, employees, updateEmployees, upsertRun, executeRun } = store;
  const { address } = useAccount();
  const payPath = usePayPath();
  const [stage, setStage] = useState<PayRunStage>("idle");
  const [rows, setRows] = useState<VerifiedRow[]>([]);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [plan, setPlan] = useState<RunPlan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const [safeChunks, setSafeChunks] = useState<SafeExportChunk[] | null>(null);

  const reset = useCallback(() => {
    setStage("idle");
    setRows([]);
    setPlan(null);
    setError(null);
    setRunId(null);
    setSafeChunks(null);
  }, []);

  const verify = useCallback(async () => {
    setError(null);
    setPlan(null);
    setStage("verifying");
    try {
      const active = employees.filter((e) => e.active);
      const fresh = await reverifyEmployees(services, employees, active, updateEmployees, (done, total) => setProgress({ done, total }));
      const paused = employees.filter((e) => !e.active).map((e) => ({ employee: e, check: undefined, payability: payability(e, undefined) }));
      setRows([...fresh, ...paused]);
      setStage("verified");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStage("idle");
    } finally {
      setProgress(null);
    }
  }, [employees, services, updateEmployees]);

  const preview = useCallback(
    (denomination: Denomination | null) => {
      setError(null);
      try {
        const payable = rows.filter((r) => r.payability.payable);
        const p = planRun(
          payable.map((r) => ({
            employeeId: r.employee.id,
            name: displayName(r.employee),
            // Always the PINNED meta-address, never the freshly resolved one.
            metaAddressURI: r.employee.pin.metaAddressURI,
            amount: r.employee.amount,
            ...(denomination?.mode === "carry" ? { carryIn: r.employee.carry } : {}),
          })),
          denomination,
        );
        setPlan(p);
        setStage("planned");
        payPath.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [rows, payPath],
  );

  const baseRecord = useCallback(
    (p: RunPlan, path: RunRecord["path"], extra: Partial<RunRecord>): RunRecord => {
      const now = Date.now();
      return {
        id: crypto.randomUUID(),
        createdAt: now,
        chainId: app.chainId,
        path,
        token: app.usdc,
        denomination: p.denomination,
        carryOut: Object.fromEntries(p.carryOut),
        carryCommitted: false,
        excluded: rows
          .filter((r) => !r.payability.payable)
          .map((r) => ({ employeeId: r.employee.id, name: displayName(r.employee), reason: r.payability.payable ? "" : r.payability.message })),
        attempts: [attemptFromPlan(p, 0, now)],
        ...extra,
      };
    },
    [app, rows],
  );

  const execute = useCallback(async () => {
    if (!plan) return;
    setError(null);
    const kind = payPath.probe?.path.kind;
    if (!address) return setError("Connect a wallet first");
    if (kind !== "batch" && kind !== "disperse") {
      return setError(payPath.probe?.path.reason ?? "No payment path for this wallet");
    }
    const run = baseRecord(plan, kind, {
      payer: address,
      ...(kind === "disperse" && app.stealthDisperse ? { stealthDisperse: app.stealthDisperse } : {}),
    });
    setRunId(run.id);
    setStage("executing");
    try {
      await executeRun(run, 0, plan, address);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setPlan(null); // stealth addresses are single-use; never re-send this plan
    setStage("done");
    payPath.refresh();
  }, [address, app.stealthDisperse, baseRecord, executeRun, payPath, plan]);

  const exportSafe = useCallback(
    async (safeAddress: string) => {
      if (!plan) return;
      setError(null);
      if (!isAddress(safeAddress)) return setError("Enter the Safe's address");
      const safe: Address = getAddress(safeAddress);
      const run = baseRecord(plan, "safe-export", { safeAddress: safe, payer: safe });
      const chunks = buildSafeExport(plan, {
        token: app.usdc,
        chainId: app.chainId,
        safeAddress: safe,
        createdAt: run.createdAt,
        runLabel: new Date(run.createdAt).toISOString().slice(0, 10),
      });
      await upsertRun(run);
      setRunId(run.id);
      setSafeChunks(chunks);
      setPlan(null);
      setStage("done");
    },
    [app, baseRecord, plan, upsertRun],
  );

  const downloadSafeChunk = useCallback(
    (index: number) => {
      const c = safeChunks?.[index];
      if (c) downloadJson(c.fileName, c.builder);
    },
    [safeChunks],
  );

  return {
    stage,
    rows,
    progress,
    plan,
    funding: plan ? checkFunding(plan, payPath.funding) : null,
    error,
    runId,
    safeChunks,
    verify,
    preview,
    execute,
    exportSafe,
    downloadSafeChunk,
    reset,
  };
}
