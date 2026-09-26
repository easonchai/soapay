import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { motion } from "framer-motion";
import { Bloom, Collapse, CountUp, ErrorLine, NavyPanel, PageHead, Presence, Reveal, Stagger, StaggerItem, Toggle, toast } from "@soapay/ui";
import { smallTeamWarning } from "@soapay/sdk";
import type { PayRunState } from "../hooks/usePayRun.js";
import type { PayPathState, WalletState } from "../hooks/usePayPath.js";
import type { ImportResult, RosterState } from "../hooks/useRoster.js";
import { DEFAULT_CHUNK_USDC, TESTNET_CHUNK_USDC } from "../config.js";
import { exampleSalaries } from "../lib/testnet.js";
import { toInputUsdc, USDC_DECIMALS } from "../lib/amount.js";
import { csvTemplate } from "../lib/csv.js";
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
  /** The company-wide chunk size (Settings), as typed. Defaults to 500 USDC (5 on a testnet). */
  chunk?: string;
  /** Testnet: small example amounts (D-47). */
  testnet?: boolean;
  onOpenSettings?(): void;
  /** Test-USDC affordance (pages/Faucet.tsx, compact), last in the rail; nothing on mainnet. */
  faucet?: ReactNode;
};

const trimZeros = (s: string) => (s.includes(".") ? s.replace(/\.?0+$/, "") : s);

const COLS = "32px 1.5fr 1fr 70px 1.6fr";

/**
 * CK's Pay run screen over our roster: the rows are the enrolled (pinned) employees and their
 * salaries; "Resolve names" re-verifies every pin (usePayRun.verify); "Paste rows" imports
 * `name, amount[, label]` into the roster (useRoster.importCsv).
 */
export function PayRunPage({ run, roster, wallet, payPath, chainName, onReview, onOpenRecipients, chunk: chunkProp, testnet = false, onOpenSettings, faucet }: PayRunPageProps) {
  const chunk = chunkProp ?? (testnet ? TESTNET_CHUNK_USDC : DEFAULT_CHUNK_USDC);
  const [exA, exB] = exampleSalaries(testnet);
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

  // A short "Names resolved" beat on the primary button once verification finishes (900 ms).
  const [justResolved, setJustResolved] = useState(false);
  const wasVerifying = useRef(false);
  const resolvedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (wasVerifying.current && !verifying && checked) {
      setJustResolved(true);
      if (resolvedTimer.current) clearTimeout(resolvedTimer.current);
      resolvedTimer.current = setTimeout(() => setJustResolved(false), 900);
    }
    wasVerifying.current = verifying;
  }, [verifying, checked]);
  useEffect(
    () => () => {
      if (resolvedTimer.current) clearTimeout(resolvedTimer.current);
    },
    [],
  );

  const executing = run.stage === "executing";
  // ONE stepped primary action: Add recipients → Resolve names → (Names resolved) → Review N lines.
  // `key` drives the label morph and stays put while the progress counter ticks.
  const primary: { key: string; label: ReactNode; disabled: boolean; onClick?: () => void } = (() => {
    if (rows.length === 0) return { key: "add", label: "Add recipients", disabled: true };
    if (verifying) return { key: "resolving", label: run.progress ? `Resolving ${run.progress.done}/${run.progress.total}…` : "Resolving…", disabled: true };
    if (justResolved) {
      return {
        key: "resolved",
        disabled: true,
        label: (
          <>
            Names resolved
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true" style={{ marginLeft: 6, verticalAlign: -2 }}>
              <path d="M3 8.5l3 3 7-7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </>
        ),
      };
    }
    if (!checked) return { key: "resolve", label: "Resolve names", disabled: executing, onClick: () => void run.verify() };
    if (payable.length === 0) return { key: "nobody", label: "Nobody payable", disabled: true };
    if (denomError) return { key: "chunk", label: "Fix chunk size", disabled: true };
    return { key: "review", label: `Review ${plural(preview.lines, "line")}`, disabled: executing, onClick: review };
  })();

  const summary = (() => {
    if (rows.length === 0) return "Add recipients, or paste rows.";
    const parts = [`${plural(payable.length, "recipient")}${checked ? " payable" : ""}.`];
    if (changed.length) {
      parts.push(`${plural(changed.length, "record")} changed without World ID re-verification: confirm with the person, then re-approve.`);
    }
    const other = blocked.filter((r) => r.payability && !r.payability.payable && r.payability.reason === "error");
    if (other.length) parts.push(`${plural(other.length, "name")} failed to resolve; left out.`);
    return parts.join(" ");
  })();

  const templateHref = `data:text/csv;charset=utf-8,${encodeURIComponent(csvTemplate(testnet))}`;
  const openPaste = () => {
    setShowPaste(true);
    setTimeout(() => textRef.current?.focus(), 50);
  };

  return (
    <div className="stack-lg">
      <PageHead
        eyebrow={`Pay run · draft · ${plural(rows.filter((r) => r.employee.active).length, "recipient")}`}
        title="Pay run"
        line="Names re-checked against pinned records. Nothing sent until you sign."
        actions={
          <>
            <button onClick={onOpenRecipients}>Recipients</button>
            <button onClick={openPaste}>Paste rows</button>
          </>
        }
      />

      {wallet.wrongChain && <Notice tone="danger">Wallet on another chain. Payments target {chainName}; it will ask to switch.</Notice>}
      <ErrorLine error={err ?? run.error ?? roster.error} />

      <div className="grid-2">
        <div className="stack">
          <Collapse open={showPaste || rows.length === 0}>
            {rows.length === 0 && !showPaste ? (
              <div className="empty" style={{ marginBottom: 16 }}>
                <Bloom />
                <Reveal delay={0.4}>
                  <span className="eyebrow">Nothing to send yet</span>
                </Reveal>
                <Reveal delay={0.55}>
                  <h2>Add your team, pay in one run.</h2>
                </Reveal>
                <Reveal delay={0.7}>
                  <p className="ink2 pretty" style={{ maxWidth: 440 }}>
                    One line per person: name, salary in USDC. Pinned once, re-checked every run.
                  </p>
                </Reveal>
                <Reveal delay={0.85} className="actions" style={{ marginTop: 8 }}>
                  <button className="btn-primary" onClick={openPaste}>
                    Paste rows
                  </button>
                  <button onClick={onOpenRecipients}>Invite employee</button>
                </Reveal>
              </div>
            ) : (
              <div className="stack-sm" style={{ paddingBottom: 16 }}>
                <textarea
                  ref={textRef}
                  value={paste}
                  onChange={(e) => setPaste(e.target.value)}
                  placeholder={`alice.soapay.eth, ${exA}\nbram.soapay.eth, ${exB}, Bram (design)\n\nOne per line: name, amount, optional label.`}
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
                  Every payee is a pinned, verified ENS name; the amount becomes their salary. Meta-addresses and plain addresses are rejected.
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
                        <button className="btn-inline" disabled={roster.busy} onClick={() => void reapprove(e.id)} title="Confirm with the person first">
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
          </div>
        </div>

        <aside className="rail">
          <NavyPanel>
            <span className="label">Total · {plural(payable.length, "recipient")}</span>
            <span className="amount">
              <CountUp value={Number(preview.total) / 10 ** USDC_DECIMALS} format={(n) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} />
              <span className="unit">USDC</span>
            </span>
            <div className="rows rule">
              <div>
                <span className="k">Lines</span>
                <span>
                  <CountUp value={preview.lines} format={(n) => String(Math.round(n))} duration={0.35} />
                </span>
              </div>
              <div>
                <span className="k">Transactions</span>
                <span title="≤350 lines each">{preview.txCount}</span>
              </div>
              <div>
                <span className="k">Wallet after</span>
                <span>{balance === null ? "…" : `${usdc(balance - preview.total < 0n ? 0n : balance - preview.total)} USDC`}</span>
              </div>
            </div>
          </NavyPanel>

          <div className="panel compact">
            <div className="between">
              <span style={{ fontSize: 13, fontWeight: 500 }}>Denominated payouts</span>
              <Toggle on={denomOn} onChange={setDenomOn} label="Denominated payouts" />
            </div>
            {!denomOn ? (
              <span className="st-warn">Off for this run: each line is a whole salary, readable by coworkers.</span>
            ) : denomError ? (
              <span className="st-warn">{denomError}</span>
            ) : (
              <>
              <div className="line">
                <span>
                  <span className="num">{`${trimZeros(chunk)} USDC`}</span> chunks
                </span>
                {onOpenSettings && (
                  <>
                    <span aria-hidden="true">·</span>
                    <button className="btn-text" style={{ fontSize: 12, height: 20 }} onClick={onOpenSettings}>
                      Change
                    </button>
                  </>
                )}
              </div>
              <span className="hint">Remainder: one smaller final line, exact wage.</span>
              </>
            )}
          </div>

          <label className="field">
            <span>Run label (optional)</span>
            <input
              className="slim"
              value={run.label}
              maxLength={MAX_RUN_LABEL}
              placeholder="September payroll"
              aria-label="Run label"
              onChange={(e) => run.setLabel(e.target.value)}
            />
          </label>

          {!enough && <Notice tone="warn">Wallet USDC below the total. A Safe export pays from the Safe.</Notice>}
          {smallTeam && <Notice tone="warn">{smallTeam}</Notice>}

          <button
            className={`btn-primary btn-xl full${primary.disabled ? "" : " pulse"}`}
            data-testid="pay-primary"
            onClick={primary.onClick}
            disabled={primary.disabled}
            style={{ position: "relative", overflow: "hidden" }}
          >
            <Presence mode="wait" initial={false}>
              <motion.span key={primary.key} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.16 }}>
                {primary.label}
              </motion.span>
            </Presence>
          </button>
          <div className="status">
            <span>{rows.length === 0 ? "No recipients yet." : checked ? `${payable.length} payable · resolved` : `${plural(payable.length, "recipient")} · resolve to continue`}</span>
            {checked && !verifying && (
              <button className="btn-text" style={{ fontSize: 12 }} onClick={() => void run.verify()} disabled={executing}>
                Resolve again
              </button>
            )}
          </div>
          <p className="hint">Sending from {wallet.address ? short(wallet.address) : "your wallet"}.</p>
          {faucet}
        </aside>
      </div>
    </div>
  );
}
