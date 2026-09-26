// One recorded run: status, names → amounts report, and the follow-up actions.
// Retry re-verifies the unpaid employees and RE-DERIVES fresh stealth addresses for
// their lines (planRetry); stored addresses are records, never payment inputs.
import { useCallback, useMemo, useState } from "react";
import { useAccount, useConfig } from "wagmi";
import { confirmNotSent as markNotSent, recheckRun } from "../lib/execute.js";
import {
  attemptFromPlan,
  canRetry,
  planRetry,
  remainingObligations,
  runReport,
  runStatus,
  runTotals,
  type ReportRow,
  type RetryBlock,
  type RunRecord,
  type RunStatus,
} from "../lib/run.js";
import { wagmiRecheckDeps } from "../lib/wallet.js";
import { demoRecheckDeps } from "../lib/demoChain.js";
import { reverifyEmployees } from "./usePayRun.js";
import { useStore } from "./store.js";
import { usePayPath } from "./usePayPath.js";

export type RunView = {
  run: RunRecord;
  status: RunStatus;
  report: ReportRow[];
  totals: { planned: bigint; paid: bigint; outstanding: bigint };
  retry: RetryBlock;
  executing: boolean;
};

export function runView(run: RunRecord, executing: boolean): RunView {
  return { run, status: runStatus(run), report: runReport(run), totals: runTotals(run), retry: canRetry(run), executing };
}

/** Every run, newest first, with derived status and totals. */
export function useHistory(): RunView[] {
  const { runs, executing } = useStore();
  return useMemo(() => [...runs].sort((a, b) => b.createdAt - a.createdAt).map((r) => runView(r, executing.has(r.id))), [runs, executing]);
}

export type RunActions = {
  view: RunView | null;
  busy: boolean;
  error: string | null;
  recheck(): Promise<void>;
  confirmNotSent(chunkIndex: number): Promise<void>;
  retry(): Promise<void>;
};

export function useRunActions(runId: string | null): RunActions {
  const { runs, executing, employees, services, updateEmployees, upsertRun, executeRun, app } = useStore();
  const config = useConfig();
  const { address } = useAccount();
  const payPath = usePayPath();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = runs.find((r) => r.id === runId) ?? null;

  const guard = useCallback(async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, []);

  const recheck = useCallback(
    () =>
      guard(async () => {
        if (!run) return;
        await upsertRun(await recheckRun(run, app.demo ? demoRecheckDeps() : wagmiRecheckDeps(config, run.chainId)));
      }),
    [app.demo, config, guard, run, upsertRun],
  );

  const confirmNotSent = useCallback(
    (chunkIndex: number) =>
      guard(async () => {
        if (run) await upsertRun(markNotSent(run, chunkIndex));
      }),
    [guard, run, upsertRun],
  );

  const retry = useCallback(
    () =>
      guard(async () => {
        if (!run) return;
        const block = canRetry(run);
        if (!block.ok) throw new Error(block.reason);
        if (run.chainId !== app.chainId) throw new Error("This run was made on another chain. Switch chains in Settings to retry it.");
        if (!address) throw new Error("Connect a wallet first");
        if (run.payer && run.payer.toLowerCase() !== address.toLowerCase()) {
          throw new Error(`Connect the wallet that started this run (${run.payer})`);
        }
        const obligations = remainingObligations(run);
        const ids = new Set(obligations.map((o) => o.employeeId));
        const subset = employees.filter((e) => ids.has(e.id));
        const rows = await reverifyEmployees(services, employees, subset, updateEmployees);
        const blocked = rows.filter((r) => !r.payability.payable);
        const missing = obligations.filter((o) => !subset.some((e) => e.id === o.employeeId));
        if (blocked.length || missing.length) {
          const names = [...blocked.map((r) => r.employee.ensName), ...missing.map((o) => o.name)];
          throw new Error(`Not payable right now: ${names.join(", ")}. Resolve them on the Roster first.`);
        }
        const pinned = new Map(rows.map((r) => [r.employee.id, r.employee.pin.metaAddressURI]));
        const plan = planRetry(obligations, pinned);
        const attempt = attemptFromPlan(plan, run.attempts.length, Date.now());
        // Retry on the path this wallet takes NOW, not the one saved with the run: a run saved as an
        // EIP-5792 batch before StealthDisperse became the EOA path would rebuild the same batch
        // (MetaMask: "Batch size cannot exceed 10").
        const kind = payPath.probe?.path.kind;
        const path = kind === "batch" || kind === "disperse" ? kind : run.path;
        const { stealthDisperse: _old, ...rest } = run;
        const base: RunRecord = {
          ...rest,
          path,
          ...(path === "disperse" && (app.stealthDisperse ?? run.stealthDisperse)
            ? { stealthDisperse: (app.stealthDisperse ?? run.stealthDisperse)! }
            : {}),
        };
        const next: RunRecord = { ...base, attempts: [...run.attempts, attempt] };
        await executeRun(next, attempt.index, plan, address);
      }),
    [address, app.chainId, app.stealthDisperse, employees, executeRun, guard, payPath.probe, run, services, updateEmployees],
  );

  return {
    view: run ? runView(run, executing.has(run.id)) : null,
    busy,
    error,
    recheck,
    confirmNotSent,
    retry,
  };
}
