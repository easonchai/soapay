import { useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Collapse, CountUp, Dots, ErrorLine, NavyPanel, PageHead, Presence, Stagger, StaggerItem, Toggle, toast } from "@soapay/ui";
import { smallTeamWarning } from "@soapay/sdk";
import type { PayRunState } from "../hooks/usePayRun.js";
import type { PayPathState, WalletState } from "../hooks/usePayPath.js";
import type { ImportResult, RosterState } from "../hooks/useRoster.js";
import { DEFAULT_CHUNK_USDC } from "../config.js";
import { toInputUsdc, USDC_DECIMALS } from "../lib/amount.js";
import { CSV_TEMPLATE } from "../lib/csv.js";
import { draftPreview } from "../lib/preview.js";
import { displayName } from "../lib/roster.js";
import { companyDenomination, MAX_RUN_LABEL, type Denomination } from "../lib/run.js";
import { Notice, plural, short, usdc } from "../ui/kit.js";
import { AttestedBadge, RecordStatus } from "../ui/status.js";

export type PayRunPageProps = {
  run: PayRunState;
  roster: RosterState;
  wallet: WalletState;
  payPath: PayPathState;
  chainName: string;
  /** Build the plan (fresh addresses) and open Review. */
  onReview(denomination: Denomination | null): void;
  onOpenRecipients(): void;
  /** The company-wide chunk size (Settings), as typed. Defaults to 500 USDC. */
  chunk?: string;
  onOpenSettings?(): void;
};

const trimZeros = (s: string) => (s.includes(".") ? s.replace(/\.?0+$/, "") : s);

const COLS = "32px 1.5fr 1fr 70px 1.6fr";

/**
 * CK's Pay run screen over our roster: the rows are the enrolled (pinned) employees and their
 * salaries; "Resolve names" re-verifies every pin (usePayRun.verify); "Paste rows" imports
 * `name, amount[, label]` into the roster (useRoster.importCsv).
 */
export function PayRunPage({ run, roster, wallet, payPath, chainName, onReview, onOpenRecipients, chunk = DEFAULT_CHUNK_USDC, onOpenSettings }: PayRunPageProps) {
  // Per run and ON by default (D-31); turning it off is never remembered for the next run.
  const [denomOn, setDenomOn] = useState(true);
  const [showPaste, setShowPaste] = useState(false);
  const [paste, setPaste] = useState("");
  const [imported, setImported] = useState<ImportResult | null>(null);
  const [editing, setEditing] = useState<{ id: string; value: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);

  // Before verification the table shows the roster; after it, the verified rows (fresh pins).
  const verified = new Map(run.rows.map((r) => [r.employee.id, r]));
  // Employee data always from the roster (latest salary and pin); the gate from this run's verification.
  const rows = roster.rows.map((r) => ({ employee: r.employee, payability: verified.get(r.employee.id)?.payability }));
  const verifying = run.stage === "verifying";
  const checked = run.stage !== "idle" && run.stage !== "verifying" && run.rows.length > 0;
  const payable = checked ? rows.filter((r) => r.payability?.payable) : rows.filter((r) => r.employee.active);
  const blocked = checked ? rows.filter((r) => r.payability && !r.payability.payable && r.employee.active) : [];
  const changed = rows.filter((r) => r.employee.pendingChange || (r.payability && !r.payability.payable && r.payability.reason === "changed"));

  let denomination: Denomination | null = null;
  let denomError: string | null = null;
  try {
    denomination = companyDenomination(denomOn, chunk);
  } catch (e) {
    denomError = (e as Error).message;
  }
  const preview = useMemo(
    () => draftPreview(payable.map((r) => r.employee.amount), denomination),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [payable.map((r) => `${r.employee.id}:${r.employee.amount}`).join(","), denomination?.chunkSize, denomination?.mode],
  );
  const linesFor = new Map(payable.map((r, i) => [r.employee.id, preview.perAmount[i] ?? 1]));
  const balance = payPath.funding?.usdcBalance ?? null;
  const enough = balance === null || balance >= preview.total;
  const smallTeam = payable.length > 0 ? smallTeamWarning(payable.length) : null;

  async function importPaste() {
    setErr(null);
    const res = await roster.importCsv(paste);
    setImported(res);
    if (res.added) {
      toast.success(`${plural(res.added, "name")} added and pinned`, { description: "Resolve names before you review." });
      setPaste("");
      if (!res.issues.length) setShowPaste(false);
    }
  }

  async function reapprove(id: string) {
    await roster.reapprove(id);
    // The run's rows compared against the old pin: re-verify.
    if (run.stage !== "idle") await run.verify();
  }

  function review() {
    setErr(null);
    if (denomError) return setErr(denomError);
    onReview(denomination);
  }

  let reviewLabel = "Review";
  if (rows.length === 0) reviewLabel = "Review — add recipients first";
  else if (!checked) reviewLabel = "Review — resolve names first";
  else if (payable.length === 0) reviewLabel = "Review — nobody is payable";
  else if (denomError) reviewLabel = "Review — fix the chunk size in Settings";
  const canReview = checked && payable.length > 0 && !denomError && !verifying;

  const summary = (() => {
    if (rows.length === 0) return "Add people on Recipients, or paste rows.";
    const parts = [`${plural(payable.length, "recipient")}${checked ? " payable" : ""}.`];
    if (changed.length) {
      parts.push(`${plural(changed.length, "record")} changed without a World ID re-verification: blocked until you re-approve (confirm with the person first).`);
    }
    const other = blocked.filter((r) => r.payability && !r.payability.payable && r.payability.reason === "error");
    if (other.length) parts.push(`${plural(other.length, "name")} failed to resolve and will be left out.`);
    if (!checked && !verifying) parts.push("Press Resolve to re-check every name against its pinned record.");
    return parts.join(" ");
  })();

  const templateHref = `data:text/csv;charset=utf-8,${encodeURIComponent(CSV_TEMPLATE)}`;
  const openPaste = () => {
    setShowPaste(true);
    setTimeout(() => textRef.current?.focus(), 50);
  };

  return (
    <div className="stack-lg">
      <PageHead
        eyebrow={`Pay run · draft · ${plural(rows.filter((r) => r.employee.active).length, "recipient")}`}
        title="Pay run"
        line="Every name is re-checked against the record you pinned. Nothing is sent until you sign."
        actions={
          <>
            <button onClick={onOpenRecipients}>Recipients</button>
            <button onClick={openPaste}>Paste rows</button>
          </>
        }
      />

      {wallet.wrongChain && <Notice tone="danger">Your wallet is on another chain. Every payment targets {chainName}; your wallet will ask to switch.</Notice>}
      <ErrorLine error={err ?? run.error ?? roster.error} />

      <div className="grid-2">
        <div className="stack">
          <Collapse open={showPaste || rows.length === 0}>
            {rows.length === 0 && !showPaste ? (
              <div className="empty" style={{ marginBottom: 16 }}>
                <Dots mode="diamond" />
                <span className="eyebrow">Nothing to send yet</span>
                <h2>Add your team, then pay them in one run.</h2>
                <p className="ink2 pretty" style={{ maxWidth: 440 }}>
                  One person per line: their Soapay or ENS name, a comma, and the salary in USDC. Each name is resolved once and its
                  record pinned; every run re-checks it.
                </p>
                <div className="actions" style={{ marginTop: 8 }}>
                  <button className="btn-primary" onClick={openPaste}>
                    Paste rows
                  </button>
                  <button onClick={onOpenRecipients}>Invite employee</button>
                </div>
              </div>
            ) : (
              <div className="stack-sm" style={{ paddingBottom: 16 }}>
                <textarea
                  ref={textRef}
                  value={paste}
                  onChange={(e) => setPaste(e.target.value)}
                  placeholder={"alice.soapay.eth, 4200\nbram.soapay.eth, 3850, Bram (design)\n\nOne person per line: name, amount in USDC, optional label."}
                  aria-label="Recipients and amounts"
                  style={{ minHeight: 96 }}
                />
                <div className="actions">
                  <button className="btn-primary" onClick={() => void importPaste()} disabled={roster.busy || !paste.trim()}>
                    {roster.busy ? "Resolving…" : "Resolve and add"}
                  </button>
                  <label className="btn" style={{ cursor: "pointer" }}>
                    Import CSV
                    <input
                      type="file"
                      accept=".csv,text/csv"
                      hidden
                      onChange={async (e) => {
                        const f = e.target.files?.[0];
                        if (f) setImported(await roster.importCsv(await f.text()));
                      }}
                    />
                  </label>
                  <a className="btn-text" href={templateHref} download="soapay-roster.csv">
                    Template
                  </a>
                  {rows.length > 0 && (
                    <button className="btn-text" onClick={() => setShowPaste(false)}>
                      Close
                    </button>
                  )}
                </div>
                {/* Roster only (owner decision 2026-09-26): this box bulk-imports `name, salary` into the pinned
                    roster; raw st:eth meta-addresses and plain addresses are rejected (lib/csv.ts payeeRejection). */}
                <span className="hint">
                  Every payee is a pinned, verified ENS name. Pasted names join the roster and the amount becomes their salary for every run;
                  meta-addresses and plain addresses are rejected.
                </span>
              </div>
            )}
          </Collapse>
          {imported && (imported.added > 0 || imported.issues.length > 0) && (
            <Notice tone={imported.issues.length ? "warn" : "ok"}>
              Added {imported.added}.
              {imported.issues.map((i) => (
                <div key={`${i.line}-${i.message}`}>
                  Line {i.line}: {i.message}
                </div>
              ))}
            </Notice>
          )}

          <div className="table">
            <div className="thead" style={{ gridTemplateColumns: COLS }}>
              <span>#</span>
              <span>Name</span>
              <span className="r">Amount</span>
              <span className="r">Token</span>
              <span className="r">Resolution</span>
            </div>
            <Stagger keyed={rows.length}>
              {rows.map((r, i) => {
                const e = r.employee;
                const isChanged = !!e.pendingChange || (r.payability && !r.payability.payable && r.payability.reason === "changed");
                return (
                  <StaggerItem key={e.id} index={i} className="tr hover auto" style={{ gridTemplateColumns: COLS, display: "grid", opacity: e.active ? 1 : 0.55 }}>
                    <span className="idx">{i + 1}</span>
                    <span className="mono" style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                      <span>{displayName(e)}</span>
                      {e.label && <span className="ink3" style={{ fontSize: 11 }}>{e.ensName}</span>}
                    </span>
                    <span className="r num">
                      {editing?.id === e.id ? (
                        <form
                          className="actions"
                          style={{ justifyContent: "flex-end" }}
                          onSubmit={async (ev) => {
                            ev.preventDefault();
                            if (await roster.setAmount(e.id, editing.value)) {
                              setEditing(null);
                              // The verified rows carry the old salary: verify again so Review plans the new one.
                              if (checked) await run.verify();
                            }
                          }}
                        >
                          <input className="mono-in" style={{ width: 96, height: 28 }} value={editing.value} onChange={(ev) => setEditing({ id: e.id, value: ev.target.value })} autoFocus />
                        </form>
                      ) : (
                        <button className="btn-text" title="Edit salary" onClick={() => setEditing({ id: e.id, value: toInputUsdc(e.amount) })}>
                          {usdc(e.amount)}
                        </button>
                      )}
                    </span>
                    <span className="r ink2">USDC</span>
                    <span style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                      <AttestedBadge e={e} />
                      <RecordStatus e={e} payability={r.payability} pending={verifying && e.active} lines={linesFor.get(e.id)} />
                      {isChanged && (
                        <button className="btn-inline" disabled={roster.busy} onClick={() => void reapprove(e.id)} title="Only after confirming the new record with the person">
                          Re-approve
                        </button>
                      )}
                    </span>
                  </StaggerItem>
                );
              })}
            </Stagger>
            <div className="tr empty-row" style={{ gridTemplateColumns: "32px 1fr" }}>
              <span className="idx">{rows.length + 1}</span>
              <button className="btn-text" style={{ justifyContent: "flex-start", paddingLeft: 0, color: "var(--ink-disabled)" }} onClick={openPaste}>
                Paste more rows…
              </button>
            </div>
          </div>
          <div className="between">
            <span className="ink2 pretty">{summary}</span>
            <button className="btn" onClick={() => void run.verify()} disabled={verifying || rows.length === 0 || run.stage === "executing"}>
              {run.progress ? `Resolving ${run.progress.done}/${run.progress.total}…` : checked ? "Resolve again" : "Resolve names"}
            </button>
          </div>
        </div>

        <div className="stack">
          <label className="field">
            <span>Run label (optional)</span>
            <input
              value={run.label}
              maxLength={MAX_RUN_LABEL}
              placeholder="September payroll"
              aria-label="Run label"
              onChange={(e) => run.setLabel(e.target.value)}
            />
          </label>
          <div className="panel panel-pad stack">
            <div className="between">
              <span style={{ fontWeight: 500 }}>Denominated payouts</span>
              <Toggle on={denomOn} onChange={setDenomOn} label="Denominated payouts" />
            </div>
            <p className="ink2 pretty">Splits every salary into the same company-wide chunk, so amounts on chain don&apos;t identify people. Costs more gas.</p>
            {!denomOn && (
              <span className="st-warn">Off for this run: each line is someone&apos;s whole salary, which coworkers can read on chain.</span>
            )}
            <div style={{ borderTop: "1px solid var(--hairline)", paddingTop: 12, display: "flex", flexDirection: "column", gap: 6 }}>
              <div className="between num" style={{ fontSize: 12 }}>
                <span style={{ fontFamily: "var(--sans)" }} className="ink2">
                  Chunk size (company-wide)
                </span>
                <span>
                  {denomOn && !denomError ? `${trimZeros(chunk)} USDC` : "—"}
                  {onOpenSettings && (
                    <button className="btn-text" style={{ marginLeft: 6, fontSize: 12 }} onClick={onOpenSettings}>
                      Change
                    </button>
                  )}
                </span>
              </div>
              <div className="between num" style={{ fontSize: 12 }}>
                <span style={{ fontFamily: "var(--sans)" }} className="ink2">
                  Remainder
                </span>
                <span style={{ fontFamily: "var(--sans)" }}>{denomOn ? "one smaller final line, exact wage" : "—"}</span>
              </div>
              <div className="between num" style={{ fontSize: 12 }}>
                <span style={{ fontFamily: "var(--sans)" }} className="ink2">
                  Recipients
                </span>
                <span>{payable.length}</span>
              </div>
              <div className="between num" style={{ fontSize: 12 }}>
                <span style={{ fontFamily: "var(--sans)" }} className="ink2">
                  Becomes lines
                </span>
                <span>
                  <CountUp value={preview.lines} format={(n) => String(Math.round(n))} duration={0.35} />
                </span>
              </div>
              <div className="between num" style={{ fontSize: 12 }}>
                <span style={{ fontFamily: "var(--sans)" }} className="ink2">
                  Transactions (≤350 lines each)
                </span>
                <span>{preview.txCount}</span>
              </div>
            </div>
            {denomError && <span className="st-warn">{denomError}</span>}
          </div>

          <NavyPanel>
            <span className="label">Total · {plural(payable.length, "recipient")}</span>
            <span className="amount">
              <CountUp value={Number(preview.total) / 10 ** USDC_DECIMALS} format={(n) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} />
              <span className="unit">USDC</span>
            </span>
            <div className="rows rule">
              <div>
                <span className="k">Wallet balance after</span>
                <span>{balance === null ? "…" : `${usdc(balance - preview.total < 0n ? 0n : balance - preview.total)} USDC`}</span>
              </div>
            </div>
          </NavyPanel>
          {!enough && <Notice tone="warn">Wallet USDC is below the total. A Safe export pays from the Safe instead.</Notice>}
          {smallTeam && <Notice tone="warn">{smallTeam}</Notice>}

          <button className="btn-primary btn-lg" onClick={review} disabled={!canReview} style={{ position: "relative", overflow: "hidden" }}>
            <Presence mode="wait" initial={false}>
              <motion.span key={reviewLabel} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.16 }}>
                {reviewLabel}
              </motion.span>
            </Presence>
          </button>
          <p className="hint">Every Resolve reads the chain; a changed record is paid only with a World ID re-verification or your re-approval. Sending from {wallet.address ? short(wallet.address) : "your wallet"}.</p>
        </div>
      </div>
    </div>
  );
}
