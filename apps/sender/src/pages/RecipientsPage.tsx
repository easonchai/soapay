import { useState } from "react";
import { clickable, Copy, ErrorLine, Fade, FreshLegend, FreshMark, NavyPanel, Pill, Presence, Skeleton, Stagger, StaggerItem } from "@soapay/ui";
import { explorerAddress, explorerTx, fmtDate, type SpendStatus } from "@soapay/sdk";
import type { BalanceMap } from "../hooks/useWalletBalances.js";
import type { RosterState } from "../hooks/useRoster.js";
import { describeAttestation } from "../lib/attestation.js";
import { displayName, type Employee } from "../lib/roster.js";
import type { RunRecord } from "../lib/run.js";
import { employeePaySummary, employeeWallets, walletSpendStatus } from "../lib/wallets.js";
import { plural, short, usdc } from "../ui/kit.js";
import { AttestedBadge, RecordStatus } from "../ui/status.js";

export type RecipientsPageProps = {
  roster: RosterState;
  runs: readonly RunRecord[];
  chainId: number;
  /** Rendered in the left column (the Invite employee panel). */
  invitesPanel: React.ReactNode;
  openId: string | undefined;
  onOpen(id: string | undefined): void;
  /** Live balances of the open employee's paid wallets. */
  balances: BalanceMap;
  onRename(id: string, label: string): Promise<void>;
  onPay(): void;
};

const TONE: Record<SpendStatus, "ok" | "warn" | "muted"> = { unspent: "ok", "partly spent": "warn", withdrawn: "muted", unknown: "muted" };
const LIST = "32px 1.5fr 1fr 1fr 1.4fr";
const WALLETS = "110px 0.9fr 0.9fr 1.1fr 1.8fr 90px";

/** CK's Recipients over our pinned roster: list, enrollment, invites, and per-wallet live balances. */
export function RecipientsPage(p: RecipientsPageProps) {
  const { roster } = p;
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const [label, setLabel] = useState("");
  const employees = roster.rows.map((r) => r.employee);
  const open = p.openId ? employees.find((e) => e.id === p.openId) : undefined;
  const lastPaid = Math.max(0, ...employees.map((e) => employeePaySummary(p.runs, e.id).lastPaidAt ?? 0));

  return (
    <div className="split" style={{ display: "grid", gridTemplateColumns: "340px 1fr", gap: 32, alignItems: "start" }}>
      <div className="stack">
        <span className="eyebrow">
          Recipients · 1 group · {plural(employees.length, "name")}
        </span>
        <h1 style={{ marginBottom: 4 }}>Groups</h1>
        <div
          className="panel"
          style={{ padding: 16, cursor: "pointer", borderColor: open ? "var(--line)" : "var(--line-strong)" }}
          {...clickable(() => p.onOpen(undefined))}
        >
          <div className="between" style={{ alignItems: "baseline" }}>
            <span style={{ fontWeight: 500 }}>All recipients</span>
            <span className="mono ink2">{plural(employees.length, "name")}</span>
          </div>
          <div className="mono ink2" style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", marginTop: 6 }}>
            {employees
              .slice(0, 5)
              .map((e) => displayName(e).split(".")[0])
              .join(", ") || "Nobody yet"}
            {employees.length > 5 ? `, +${employees.length - 5}` : ""}
          </div>
          <div className="ink3" style={{ fontSize: 12, marginTop: 6 }}>
            {lastPaid ? `Last paid ${fmtDate(lastPaid)}` : ""}
          </div>
        </div>

        <form
          className="panel panel-pad stack-sm"
          onSubmit={async (e) => {
            e.preventDefault();
            if (await roster.enroll({ ensName: name, amount, label })) {
              setName("");
              setAmount("");
              setLabel("");
            }
          }}
        >
          <span style={{ fontWeight: 500 }}>Add by name</span>
          <input placeholder="alice.soapay.eth" value={name} onChange={(e) => setName(e.target.value)} aria-label="ENS name" />
          <div className="addon">
            <input className="mono-in" placeholder="Salary" value={amount} onChange={(e) => setAmount(e.target.value)} aria-label="Salary" />
            <span className="suffix">USDC</span>
          </div>
          <input placeholder="Label (optional)" value={label} onChange={(e) => setLabel(e.target.value)} aria-label="Label" />
          <button type="submit" className="btn-primary" disabled={roster.busy || !name || !amount}>
            {roster.busy ? "Resolving…" : "Resolve and pin"}
          </button>
          <span className="hint">Pinned once; changes need World ID re-verification or your re-approval.</span>
        </form>

        {p.invitesPanel}

        <NavyPanel className="stack-sm">
          <div style={{ fontWeight: 500 }}>Addresses live in History.</div>
          <p className="body" style={{ maxWidth: 240 }}>
            A recipient is a name. Fresh addresses every run; past ones kept for audit, never paid again.
          </p>
        </NavyPanel>
      </div>

      <Presence mode="wait" initial={false}>
        {!open ? (
          <Fade key="list" className="stack" x={-16}>
            <div className="between" style={{ alignItems: "flex-end", borderBottom: "1px solid var(--line)", paddingBottom: 16 }}>
              <div>
                <div style={{ fontSize: 20, fontWeight: 600, letterSpacing: "-0.02em" }}>All recipients</div>
                <div className="ink2" style={{ marginTop: 4 }}>
                  {plural(employees.length, "name")} · {plural(employees.filter((e) => e.active).length, "active", "active")}
                </div>
              </div>
              <div className="actions">
                <button onClick={() => void roster.verifyAll()} disabled={roster.busy || employees.length === 0}>
                  {roster.verifyProgress ? `Verifying ${roster.verifyProgress.done}/${roster.verifyProgress.total}…` : "Re-verify all"}
                </button>
                <button className="btn-primary" onClick={p.onPay} disabled={employees.length === 0}>
                  Start pay run
                </button>
              </div>
            </div>
            <ErrorLine error={roster.error} />
            {employees.length === 0 ? (
              <div className="panel" style={{ padding: "48px 24px" }}>
                <span className="eyebrow">Nobody yet</span>
                <h2 style={{ fontSize: 22, marginTop: 12, letterSpacing: "-0.02em" }}>Invite your team, or add by name.</h2>
                <p className="ink2 pretty" style={{ marginTop: 8 }}>
                  Names are resolved once and pinned.
                </p>
              </div>
            ) : (
              <div className="table">
                <div className="thead" style={{ gridTemplateColumns: LIST }}>
                  <span>#</span>
                  <span>Name</span>
                  <span>Salary</span>
                  <span>Last paid</span>
                  <span className="r">Record</span>
                </div>
                <Stagger>
                  {roster.rows.map(({ employee: e, payability }, i) => {
                    const s = employeePaySummary(p.runs, e.id);
                    return (
                      <StaggerItem key={e.id} index={i} className="tr click mono auto" style={{ gridTemplateColumns: LIST, display: "grid" }} onClick={() => p.onOpen(e.id)}>
                        <span className="idx">{i + 1}</span>
                        <span style={{ display: "flex", flexDirection: "column" }}>
                          <span>{displayName(e)}</span>
                          {e.label && <span className="ink3" style={{ fontSize: 11 }}>{e.ensName}</span>}
                        </span>
                        <span>{usdc(e.amount)} USDC</span>
                        <span className="ink2">{s.lastPaidAt ? fmtDate(s.lastPaidAt) : "never"}</span>
                        <span className="r" style={{ fontFamily: "var(--sans)", display: "flex", gap: 6, justifyContent: "flex-end", flexWrap: "wrap" }}>
                          <AttestedBadge e={e} />
                          {e.active && !e.pendingChange && (!payability || payability.payable || payability.reason === "unchecked") ? (
                            <span className="st-ok">Active</span>
                          ) : (
                            <RecordStatus e={e} payability={payability} />
                          )}
                        </span>
                      </StaggerItem>
                    );
                  })}
                </Stagger>
                <div className="foot">
                  <span>
                    &quot;Blocked&quot;: the record changed without a World ID proof from the person linked to the name. Confirm with the person on another channel, then re-approve.
                  </span>
                </div>
              </div>
            )}
          </Fade>
        ) : (
          <Fade key={open.id} className="stack" x={24} duration={0.22}>
            <EmployeeDetail {...p} e={open} />
          </Fade>
        )}
      </Presence>
    </div>
  );
}

function EmployeeDetail(p: RecipientsPageProps & { e: Employee }) {
  const { e, roster } = p;
  const [editing, setEditing] = useState(false);
  const [label, setLabel] = useState(e.label ?? "");
  const wallets = employeeWallets(p.runs, e.id, { all: true });
  const summary = employeePaySummary(p.runs, e.id);
  const pc = e.pendingChange;

  return (
    <>
      <div className="between" style={{ alignItems: "flex-end", borderBottom: "1px solid var(--line)", paddingBottom: 16 }}>
        <div>
          <a
            href="#/roster"
            className="ink2"
            style={{ fontSize: 12 }}
            onClick={(ev) => {
              ev.preventDefault();
              p.onOpen(undefined);
            }}
          >
            ← All recipients
          </a>
          {editing ? (
            <form
              className="actions"
              style={{ marginTop: 6 }}
              onSubmit={async (ev) => {
                ev.preventDefault();
                await p.onRename(e.id, label);
                setEditing(false);
              }}
            >
              <input value={label} onChange={(ev) => setLabel(ev.target.value)} placeholder="Display name" autoFocus />
              <button type="submit" className="btn-primary">
                Save
              </button>
              <button type="button" onClick={() => setEditing(false)}>
                Cancel
              </button>
            </form>
          ) : (
            <div style={{ fontSize: 20, fontWeight: 600, letterSpacing: "-0.02em", marginTop: 4 }}>
              {displayName(e)}
              <button className="btn-text btn-inline" onClick={() => setEditing(true)}>
                Rename
              </button>
            </div>
          )}
          <div className="ink2" style={{ marginTop: 4 }}>
            {usdc(e.amount)} USDC per run · {plural(summary.runs, "run")} paid · {plural(summary.wallets, "wallet")}
            {summary.lastPaidAt ? ` · last ${fmtDate(summary.lastPaidAt)}` : ""}
            {e.carry !== 0n ? ` · carry ${usdc(e.carry)}` : ""}
          </div>
        </div>
        <div className="actions">
          <button disabled={roster.busy} onClick={() => void roster.setActive(e.id, !e.active)}>
            {e.active ? "Pause" : "Resume"}
          </button>
          <button className="btn-danger" disabled={roster.busy} onClick={() => confirm(`Remove ${e.ensName} from the roster?`) && void roster.remove(e.id).then(() => p.onOpen(undefined))}>
            Remove
          </button>
          <button className="btn-primary" onClick={p.onPay} disabled={!e.active || !!pc}>
            Pay {displayName(e)}
          </button>
        </div>
      </div>
      <ErrorLine error={roster.error} />

      {pc && (
        <div className="notice notice-danger stack-sm" role="alert">
          <b>Blocked: record changed since pinned.</b>
          <span>
            {e.ensName} now points to <span className="mono">{short(pc.metaAddressURI, 10)}</span> (detected {fmtDate(pc.detectedAt)}).{" "}
            {describeAttestation(pc.attestation)}. Possible salary redirect: confirm with the person on another channel first.
          </span>
          <div className="actions">
            <button className="btn-primary" disabled={roster.busy} onClick={() => void roster.reapprove(e.id)}>
              Re-approve new record
            </button>
          </div>
        </div>
      )}

      <div className="panel" style={{ padding: "14px 20px" }}>
        <dl className="facts">
          <dt>Name</dt>
          <dd className="mono">{e.ensName}</dd>
          <dt>Pinned record</dt>
          <dd className="mono">
            {e.pin.metaAddressURI}
            <Copy value={e.pin.metaAddressURI} />
            <span className="note" style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 4 }}>
              Pinned {fmtDate(e.pin.pinnedAt)} <AttestedBadge e={e} />
            </span>
          </dd>
          <dt>Registrant</dt>
          <dd className="mono">{e.pin.registrant}</dd>
          {e.pinHistory.length > 1 && (
            <>
              <dt>History</dt>
              <dd>
                {e.pinHistory.map((h, i) => (
                  <span key={i} className="note">
                    {fmtDate(h.at)} · {h.reason} · <span className="mono">{short(h.metaAddressURI, 8)}</span>
                  </span>
                ))}
              </dd>
            </>
          )}
        </dl>
      </div>

      {roster.simulateRotation && (
        <div className="actions">
          <span className="hint">Dev mock:</span>
          <button className="btn-inline" onClick={() => void roster.simulateRotation!(e.ensName, true)}>
            Rotate keys (World ID attested)
          </button>
          <button className="btn-inline" onClick={() => void roster.simulateRotation!(e.ensName, false)}>
            Rotate keys (no proof)
          </button>
          <span className="hint">then Re-verify all.</span>
        </div>
      )}

      <div className="table">
        <div className="thead" style={{ gridTemplateColumns: WALLETS }}>
          <span>Date</span>
          <span className="r">Paid</span>
          <span className="r">Live balance</span>
          <span className="r" style={{ paddingRight: 20 }}>
            Status
          </span>
          <span>Fresh address</span>
          <span className="r">Tx</span>
        </div>
        {wallets.length === 0 && (
          <div className="tr" style={{ gridTemplateColumns: "1fr" }}>
            <span className="ink3">No payments yet.</span>
          </div>
        )}
        <Stagger>
          {wallets.map((w, i) => {
            const landed = w.status === "landed";
            const b = p.balances.get(w.stealthAddress.toLowerCase());
            const s = walletSpendStatus(w, b);
            const addrHref = explorerAddress(p.chainId, w.stealthAddress);
            const txHref = w.txHash ? explorerTx(p.chainId, w.txHash) : undefined;
            return (
              <StaggerItem key={`${w.runId}-${w.stealthAddress}-${i}`} index={i} className="tr" style={{ gridTemplateColumns: WALLETS, display: "grid" }}>
                <span className="ink2">{fmtDate(w.sentAt)}</span>
                <span className="r num">{usdc(w.amount)}</span>
                <span className="r num">{!landed ? <span className="ink3">—</span> : b === undefined ? <Skeleton width={52} /> : b === null ? "error" : usdc(b)}</span>
                <span className="r" style={{ paddingRight: 20 }}>
                  {landed && b === undefined ? (
                    <Skeleton width={64} />
                  ) : s ? (
                    s === "unspent" ? (
                      <span className="st-plain">unspent</span>
                    ) : s === "withdrawn" ? (
                      <span className="st-muted">withdrawn</span>
                    ) : (
                      <Pill tone={TONE[s]}>{s}</Pill>
                    )
                  ) : (
                    <Pill tone={w.status === "failed" ? "danger" : "muted"}>{w.status}</Pill>
                  )}
                </span>
                <span className="mono" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                  <FreshMark />
                  {addrHref ? (
                    <a href={addrHref} target="_blank" rel="noreferrer">
                      {short(w.stealthAddress)}
                    </a>
                  ) : (
                    short(w.stealthAddress)
                  )}
                  <Copy value={w.stealthAddress} />
                </span>
                <span className="r mono">
                  {w.txHash ? (
                    txHref ? (
                      <a href={txHref} target="_blank" rel="noreferrer">
                        {short(w.txHash, 3)}
                      </a>
                    ) : (
                      short(w.txHash, 3)
                    )
                  ) : (
                    <span className="ink3">—</span>
                  )}
                </span>
              </StaggerItem>
            );
          })}
        </Stagger>
        <div className="foot">
          <span>Balances read from chain. Stored addresses are records, never payment targets.</span>
          <FreshLegend />
        </div>
      </div>
    </>
  );
}
