import { ErrorLine, FreshMark, NavyPanel, PageHead, Pill } from "@soapay/ui";
import { fmtDate } from "@soapay/sdk";
import type { RunActions } from "../hooks/useRunActions.js";
import type { RunOnChain } from "../hooks/useRunOnChain.js";
import { CoworkerViewPanel } from "./CoworkerViewPanel.js";
import type { StepStatus } from "../lib/run.js";
import { runTitle } from "../lib/run.js";
import { Notice, short, usdc } from "../ui/kit.js";
import { PATH_LABEL, STATUS_TONE } from "./HistoryPage.js";

export type RunDetailPageProps = RunActions & {
  txUrl(hash: string): string;
  onBack(): void;
  /** "What coworkers see" (D-41); omitted for Safe exports, which this app never sends. */
  onChain?: RunOnChain;
};

const STEP_TONE: Record<StepStatus | "skipped", "ok" | "warn" | "danger" | "muted"> = {
  landed: "ok",
  skipped: "muted",
  pending: "muted",
  signing: "warn",
  confirming: "warn",
  unknown: "warn",
  failed: "danger",
};

/** One run: steps of the latest attempt, names → amounts, and recheck / retry actions. */
export function RunDetailPage(p: RunDetailPageProps) {
  if (!p.view) {
    return (
      <div className="stack-lg">
        <PageHead eyebrow="History" title="Run not found" />
        <button onClick={p.onBack}>Back to history</button>
      </div>
    );
  }
  const { run, status, report, totals, retry, executing } = p.view;
  const last = run.attempts[run.attempts.length - 1]!;
  const TX = (hash: string | undefined) =>
    hash ? (
      <a href={p.txUrl(hash)} target="_blank" rel="noreferrer">
        {short(hash, 4)} ↗
      </a>
    ) : (
      <span className="ink3">—</span>
    );

  return (
    <div className="stack-lg">
      <PageHead
        eyebrow={
          <a
            href="#/history"
            onClick={(e) => {
              e.preventDefault();
              p.onBack();
            }}
          >
            ← History
          </a>
        }
        title={runTitle(run, `${PATH_LABEL[run.path]} · ${fmtDate(run.createdAt)}`)}
        line={executing ? "Paying… confirm each step in your wallet." : `Created ${new Date(run.createdAt).toLocaleString()}.`}
        actions={
          <>
            <Pill tone={STATUS_TONE[status]}>{executing ? "executing" : status}</Pill>
            {status === "needs-check" && (
              <button disabled={p.busy} onClick={() => void p.recheck()}>
                Recheck
              </button>
            )}
            {run.path !== "safe-export" && (
              <button className="btn-primary" disabled={p.busy || executing || !retry.ok} title={retry.ok ? "" : retry.reason} onClick={() => void p.retry()}>
                Retry unpaid lines
              </button>
            )}
          </>
        }
      />
      <ErrorLine error={p.error} />
      {!retry.ok && status !== "complete" && run.path !== "safe-export" && <span className="hint">{retry.reason}</span>}
      {run.excluded.length > 0 && (
        <Notice tone="warn">Left out: {run.excluded.map((x) => `${x.name} (${x.reason})`).join("; ")}</Notice>
      )}

      <div className="split" style={{ display: "grid", gridTemplateColumns: "320px 1fr", gap: 32, alignItems: "start" }}>
        <NavyPanel dots={false}>
          <div className="rows">
            <div>
              <span className="k">Planned</span>
              <span>{usdc(totals.planned)} USDC</span>
            </div>
            <div>
              <span className="k">Paid</span>
              <span>{usdc(totals.paid)} USDC</span>
            </div>
            <div>
              <span className="k">Outstanding</span>
              <span>{usdc(totals.outstanding)} USDC</span>
            </div>
            <div>
              <span className="k">Attempts</span>
              <span>{run.attempts.length}</span>
            </div>
            {run.safeAddress && (
              <div>
                <span className="k">Safe</span>
                <span>{short(run.safeAddress)}</span>
              </div>
            )}
            {run.payer && !run.safeAddress && (
              <div>
                <span className="k">From</span>
                <span>{short(run.payer)}</span>
              </div>
            )}
          </div>
        </NavyPanel>

        <div className="stack-sm" style={{ gap: 12 }}>
          <span style={{ fontWeight: 500 }}>Latest attempt ({last.index + 1})</span>
          <div className="table">
            <div className="thead" style={{ gridTemplateColumns: "1.4fr 90px 1fr 1fr 1fr" }}>
              <span>Step</span>
              <span className="r">Lines</span>
              <span className="r">Amount</span>
              <span className="r">Status</span>
              <span className="r">Tx</span>
            </div>
            {last.approve && (
              <div className="tr" style={{ gridTemplateColumns: "1.4fr 90px 1fr 1fr 1fr" }}>
                <span>Approve exact total</span>
                <span className="r ink3">—</span>
                <span className="r num">{usdc(last.approve.amount)}</span>
                <span className="r">
                  <Pill tone={STEP_TONE[last.approve.status]}>{last.approve.status}</Pill>
                </span>
                <span className="r mono">{TX(last.approve.txHash)}</span>
              </div>
            )}
            {last.chunks.map((c) => (
              <div key={c.index} className="tr auto" style={{ gridTemplateColumns: "1.4fr 90px 1fr 1fr 1fr" }}>
                <span>
                  Transaction {c.index + 1}
                  {c.error && <span className="hint" style={{ display: "block" }}>{c.error.split("\n")[0]}</span>}
                </span>
                <span className="r mono">{c.lines.length}</span>
                <span className="r num">{usdc(c.amount)}</span>
                <span className="r" style={{ display: "flex", justifyContent: "flex-end", gap: 4, alignItems: "center" }}>
                  <Pill tone={STEP_TONE[c.status]}>{c.status}</Pill>
                  {c.status === "unknown" && !c.txHash && !c.callsId && (
                    <button className="btn-inline" onClick={() => void p.confirmNotSent(c.index)}>
                      I checked: never sent
                    </button>
                  )}
                </span>
                <span className="r mono">{TX(c.txHash)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="stack-sm" style={{ gap: 12 }}>
        <div className="between" style={{ alignItems: "baseline" }}>
          <span style={{ fontWeight: 500 }}>Names → amounts</span>
          <span className="ink2">Private to you; addresses are records, never payment targets.</span>
        </div>
        <div className="table">
          <div className="thead" style={{ gridTemplateColumns: "1.2fr 0.8fr 0.8fr 2.4fr" }}>
            <span>Employee</span>
            <span className="r">Paid</span>
            <span className="r">Outstanding</span>
            <span>Fresh addresses</span>
          </div>
          {report.map((r) => (
            <div key={r.employeeId} className="tr auto" style={{ gridTemplateColumns: "1.2fr 0.8fr 0.8fr 2.4fr", alignItems: "start" }}>
              <span>{r.name}</span>
              <span className="r num">{usdc(r.paid)}</span>
              <span className={`r num ${r.outstanding ? "st-warn" : "ink3"}`}>{r.outstanding ? usdc(r.outstanding) : "—"}</span>
              <span className="mono" style={{ display: "flex", flexDirection: "column", gap: 2, paddingLeft: 16 }}>
                {r.lines.map((l, i) => (
                  <span key={`${l.stealthAddress}-${i}`} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                    <FreshMark />
                    {short(l.stealthAddress)} · {usdc(l.amount)}
                    <span className={l.status === "landed" ? "st-ok" : l.status === "failed" ? "st-warn" : "ink3"} style={{ fontFamily: "var(--sans)" }}>
                      {run.path === "safe-export" ? "exported" : l.status}
                    </span>
                  </span>
                ))}
              </span>
            </div>
          ))}
        </div>
      </div>

      {p.onChain && run.path !== "safe-export" && <CoworkerViewPanel onChain={p.onChain} txUrl={p.txUrl} />}
    </div>
  );
}
