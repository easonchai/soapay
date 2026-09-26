import { useState } from "react";
import { motion } from "framer-motion";
import { Collapse, CountUp, NavyPanel, PageHead, Pill, Stagger, StaggerItem } from "@soapay/ui";
import { explorerTx, fmtDate } from "@soapay/sdk";
import type { RunView } from "../hooks/useRunActions.js";
import { USDC_DECIMALS } from "../lib/amount.js";
import type { RunPath, RunStatus } from "../lib/run.js";
import { plural, short, usdc } from "../ui/kit.js";

export type HistoryPageProps = {
  runs: RunView[];
  /** Run to open (and flash) first, e.g. the one just sent. */
  openRunId?: string | undefined;
  onOpenRun(id: string): void;
  onStartRun(): void;
  onExportCsv(): void;
};

export const PATH_LABEL: Record<RunPath, string> = {
  batch: "Atomic batch (EIP-5792)",
  disperse: "StealthDisperse",
  "safe-export": "Safe export",
};

export const STATUS_TONE: Record<RunStatus, "ok" | "warn" | "danger" | "muted" | "accent"> = {
  complete: "ok",
  exported: "accent",
  "in-progress": "warn",
  "needs-check": "warn",
  partial: "warn",
  failed: "danger",
};

const COLS = "130px 1.4fr 90px 1fr 1fr 24px";

/** CK's History over our run records: stats, every run, expandable names → amounts. */
export function HistoryPage({ runs, openRunId, onOpenRun, onStartRun, onExportCsv }: HistoryPageProps) {
  const [open, setOpen] = useState<string | undefined>(openRunId ?? runs[0]?.run.id);
  const year = new Date().getFullYear();
  const paidThisYear = runs.filter((v) => new Date(v.run.createdAt).getFullYear() === year).reduce((s, v) => s + v.totals.paid, 0n);
  const funded = runs.reduce((s, v) => s + v.report.reduce((t, r) => t + r.lines.filter((l) => l.status === "landed").length, 0), 0);
  const first = runs.length ? runs[runs.length - 1]!.run.createdAt : undefined;

  if (runs.length === 0) {
    return (
      <div className="stack-lg">
        <PageHead eyebrow="History · no runs yet" title="Every run this wallet has signed" line="Your audit trail. Names, amounts and the fresh addresses each run created." />
        <div className="panel" style={{ padding: "48px 24px", maxWidth: 520 }}>
          <span className="eyebrow">Nothing sent yet</span>
          <h2 style={{ fontSize: 22, marginTop: 12, letterSpacing: "-0.02em" }}>Your first pay run will appear here.</h2>
          <p className="ink2 pretty" style={{ marginTop: 8 }}>
            Each run keeps who was paid, how much, and which fresh addresses were created, so you can audit it later.
          </p>
          <button className="btn-primary btn-lg" style={{ marginTop: 20 }} onClick={onStartRun}>
            Start a pay run
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="stack-lg">
      <PageHead
        eyebrow={`History · ${plural(runs.length, "run")}${first ? ` since ${fmtDate(first).slice(3)}` : ""}`}
        title="Every run this wallet has signed"
        line="Your audit trail. Names, amounts and the fresh addresses each run created. Encrypted in this browser."
        actions={<button onClick={onExportCsv}>Export CSV</button>}
      />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
        <NavyPanel className="stat" dots={false}>
          <span className="k">Paid in {year}</span>
          <span className="v">
            <CountUp value={Number(paidThisYear) / 10 ** USDC_DECIMALS} format={(n) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} duration={0.8} />{" "}
            <span className="unit">USDC</span>
          </span>
        </NavyPanel>
        <div className="stat">
          <span className="k">Fresh addresses funded</span>
          <span className="v">
            <CountUp value={funded} format={(n) => String(Math.round(n))} duration={0.8} />
          </span>
        </div>
        <div className="stat">
          <span className="k">Runs</span>
          <span className="v">
            <CountUp value={runs.length} format={(n) => String(Math.round(n))} duration={0.6} />
          </span>
        </div>
      </div>
      <div className="table">
        <div className="thead" style={{ gridTemplateColumns: COLS }}>
          <span>Date</span>
          <span>Run</span>
          <span className="r">Lines</span>
          <span className="r">Total</span>
          <span className="r">Transaction</span>
          <span />
        </div>
        <Stagger>
          {runs.map((v, idx) => {
            const { run } = v;
            const isOpen = open === run.id;
            const last = run.attempts[run.attempts.length - 1];
            const lines = last?.chunks.reduce((s, c) => s + c.lines.length, 0) ?? 0;
            const tx = last?.chunks.find((c) => c.txHash)?.txHash;
            const href = tx ? explorerTx(run.chainId, tx) : undefined;
            return (
              <StaggerItem key={run.id} index={idx}>
                <div
                  className={`tr tall click${run.id === openRunId ? " flash" : ""}`}
                  style={{ gridTemplateColumns: COLS }}
                  onClick={() => setOpen(isOpen ? undefined : run.id)}
                >
                  <span className="ink2">{fmtDate(run.createdAt)}</span>
                  <span style={{ fontWeight: 500, display: "flex", gap: 8, alignItems: "center" }}>
                    {PATH_LABEL[run.path]}
                    <Pill tone={STATUS_TONE[v.status]}>{v.executing ? "executing" : v.status}</Pill>
                  </span>
                  <span className="r mono">{lines}</span>
                  <span className="r num">
                    {usdc(v.totals.planned)} <span className="ink2">USDC</span>
                  </span>
                  <span className="r mono">
                    {tx ? (
                      href ? (
                        <a href={href} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
                          {short(tx, 4)} ↗
                        </a>
                      ) : (
                        short(tx, 4)
                      )
                    ) : (
                      <span className="ink3">none</span>
                    )}
                  </span>
                  <span style={{ display: "flex", justifyContent: "flex-end" }}>
                    <motion.span
                      animate={{ rotate: isOpen ? -135 : 45 }}
                      transition={{ duration: 0.2 }}
                      style={{ width: 7, height: 7, borderRight: "1.5px solid var(--ink2)", borderBottom: "1.5px solid var(--ink2)", display: "block" }}
                    />
                  </span>
                </div>
                <Collapse open={isOpen}>
                  <div className="sub">
                    <div className="thead" style={{ gridTemplateColumns: "1.4fr 1fr 1fr 1fr 70px" }}>
                      <span>Name</span>
                      <span className="r">Paid</span>
                      <span className="r">Outstanding</span>
                      <span className="r">Lines</span>
                      <span />
                    </div>
                    {v.report.map((r) => (
                      <div key={r.employeeId} className="tr mono" style={{ gridTemplateColumns: "1.4fr 1fr 1fr 1fr 70px" }}>
                        <span>{r.name}</span>
                        <span className="r num">{usdc(r.paid)}</span>
                        <span className={`r num ${r.outstanding ? "st-warn" : "ink3"}`}>{r.outstanding ? usdc(r.outstanding) : "—"}</span>
                        <span className="r ink2">{r.lines.length}</span>
                        <span />
                      </div>
                    ))}
                    <div className="between" style={{ paddingTop: 10, fontSize: 12 }}>
                      <span className="ink2">
                        {plural(last?.chunks.length ?? 0, "transaction")}
                        {run.attempts.length > 1 ? ` · ${run.attempts.length} attempts` : ""}. Created {fmtDate(run.createdAt)}.
                        {run.excluded.length ? ` Left out: ${run.excluded.map((x) => x.name).join(", ")}.` : ""}
                      </span>
                      <button className="btn-text" onClick={() => onOpenRun(run.id)}>
                        Open run details →
                      </button>
                    </div>
                  </div>
                </Collapse>
              </StaggerItem>
            );
          })}
        </Stagger>
      </div>
    </div>
  );
}
