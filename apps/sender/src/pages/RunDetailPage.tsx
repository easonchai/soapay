import type { RunActions, RunView } from "../hooks/useRunActions.js";
import type { StepStatus } from "../lib/run.js";
import { formatUsdc } from "../lib/amount.js";
import { Badge, Banner, Button, Card, short } from "../ui/kit.js";

export type RunDetailPageProps = RunActions & { txUrl(hash: string): string; onBack(): void };

const STEP_TONE: Record<StepStatus | "skipped", "ok" | "warn" | "error" | "info"> = {
  landed: "ok",
  skipped: "info",
  pending: "info",
  signing: "warn",
  confirming: "warn",
  unknown: "warn",
  failed: "error",
};

export function statusTone(s: RunView["status"]): "ok" | "warn" | "error" | "info" {
  return s === "complete" ? "ok" : s === "failed" ? "error" : s === "exported" ? "info" : "warn";
}

/** Props-only: one run's steps, names → amounts, and recheck/retry actions. */
export function RunDetailPage(p: RunDetailPageProps) {
  if (!p.view) {
    return (
      <Card title="Run not found">
        <Button variant="ghost" onClick={p.onBack}>Back to history</Button>
      </Card>
    );
  }
  const { run, status, report, totals, retry, executing } = p.view;
  const last = run.attempts[run.attempts.length - 1]!;
  return (
    <div className="flex flex-col gap-4">
      {p.error && <Banner tone="error">{p.error}</Banner>}
      <Card
        title={
          <>
            Run {new Date(run.createdAt).toLocaleString()} <Badge tone={statusTone(status)}>{status}</Badge>
          </>
        }
        actions={
          <>
            <Button variant="ghost" onClick={p.onBack}>Back</Button>
            {status === "needs-check" && (
              <Button variant="ghost" disabled={p.busy} onClick={() => void p.recheck()}>Recheck</Button>
            )}
            {run.path !== "safe-export" && (
              <Button disabled={p.busy || executing || !retry.ok} title={retry.ok ? "" : retry.reason} onClick={() => void p.retry()}>
                Retry unpaid lines
              </Button>
            )}
          </>
        }
      >
        <div className="text-sm">
          Path: {run.path} · planned {formatUsdc(totals.planned)} · paid {formatUsdc(totals.paid)} · outstanding {formatUsdc(totals.outstanding)}
          {run.attempts.length > 1 && ` · ${run.attempts.length} attempts`}
        </div>
        {!retry.ok && status !== "complete" && run.path !== "safe-export" && <div className="mt-1 text-xs text-slate-500">{retry.reason}</div>}
        {run.excluded.length > 0 && (
          <div className="mt-2">
            <Banner tone="warn">
              Left out: {run.excluded.map((x) => `${x.name} (${x.reason})`).join("; ")}
            </Banner>
          </div>
        )}
      </Card>

      <Card title={`Latest attempt (${last.index + 1})`}>
        <ul className="flex flex-col gap-1 text-sm">
          {last.approve && (
            <li>
              Approve exact total {formatUsdc(last.approve.amount)} <Badge tone={STEP_TONE[last.approve.status]}>{last.approve.status}</Badge>
              {last.approve.txHash && (
                <a className="ml-2 underline" href={p.txUrl(last.approve.txHash)} target="_blank" rel="noreferrer">tx</a>
              )}
              {last.approve.error && <span className="ml-2 text-slate-500">{last.approve.error}</span>}
            </li>
          )}
          {last.chunks.map((c) => (
            <li key={c.index}>
              Tx {c.index + 1}: {c.lines.length} lines, {formatUsdc(c.amount)} <Badge tone={STEP_TONE[c.status]}>{c.status}</Badge>
              {c.txHash && (
                <a className="ml-2 underline" href={p.txUrl(c.txHash)} target="_blank" rel="noreferrer">tx</a>
              )}
              {c.error && <span className="ml-2 text-slate-500">{c.error}</span>}
              {c.status === "unknown" && !c.txHash && !c.callsId && (
                <Button variant="ghost" className="ml-2" onClick={() => void p.confirmNotSent(c.index)}>I checked: never sent</Button>
              )}
            </li>
          ))}
        </ul>
      </Card>

      <Card title="Names → amounts (private to you)">
        <table className="w-full text-left text-sm">
          <thead className="text-slate-500">
            <tr>
              <th className="py-1">Employee</th>
              <th>Paid</th>
              <th>Outstanding</th>
              <th>Stealth addresses</th>
            </tr>
          </thead>
          <tbody>
            {report.map((r) => (
              <tr key={r.employeeId} className="border-t border-slate-100 align-top">
                <td className="py-1">{r.name}</td>
                <td>{formatUsdc(r.paid)}</td>
                <td>{r.outstanding ? formatUsdc(r.outstanding) : "—"}</td>
                <td className="font-mono text-xs">
                  {r.lines.map((l, i) => (
                    <div key={`${l.stealthAddress}-${i}`}>
                      {short(l.stealthAddress)} {formatUsdc(l.amount)} <Badge tone={STEP_TONE[l.status]}>{l.status}</Badge>
                    </div>
                  ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
