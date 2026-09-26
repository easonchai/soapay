import { useState } from "react";
import { Copy, ErrorLine, Pill, toast } from "@soapay/ui";
import type { InvitesState } from "../hooks/useInvites.js";
import { Notice, usdc } from "../ui/kit.js";
import { QrCode } from "../ui/QrCode.js";

export type InvitesPanelProps = InvitesState & { parentName: string; defaultOrg?: string };

/** Invite an employee by label: sign, show the link + QR, list pending invites (docs/mvp-spec.md §7). */
export function InvitesPanel(p: InvitesPanelProps) {
  const [label, setLabel] = useState("");
  const [amount, setAmount] = useState("");
  const [org, setOrg] = useState(p.defaultOrg ?? "");

  return (
    <div className="panel panel-pad stack">
      <div className="between">
        <span style={{ fontWeight: 500 }}>Invite employee</span>
        <span className="hint">They pick keys; the name is reserved for them.</span>
      </div>
      {p.unavailable && <Notice tone="info">{p.unavailable}</Notice>}
      <form
        className="stack-sm"
        onSubmit={async (e) => {
          e.preventDefault();
          if (await p.create({ label, amount, org })) {
            setLabel("");
            setAmount("");
            toast.success("Invite link created", { description: "Send it only to that employee." });
          }
        }}
      >
        <label className="field">
          <span>Name</span>
          <div className="addon">
            <input placeholder="alice" value={label} onChange={(e) => setLabel(e.target.value.toLowerCase())} aria-label="Invite label" />
            <span className="suffix">.{p.parentName}</span>
          </div>
        </label>
        <label className="field">
          <span>Salary per run</span>
          <div className="addon">
            <input className="mono-in" placeholder="4200" value={amount} onChange={(e) => setAmount(e.target.value)} aria-label="Invite amount" />
            <span className="suffix">USDC</span>
          </div>
        </label>
        <label className="field">
          <span>Organisation (optional, shown to them)</span>
          <input placeholder="Meridian Labs" value={org} onChange={(e) => setOrg(e.target.value)} />
        </label>
        <button type="submit" className="btn-primary" disabled={p.busy || !!p.unavailable || !label || !amount}>
          {p.busy ? "Signing…" : "Sign and create link"}
        </button>
      </form>
      <ErrorLine error={p.error} />

      {p.created && (
        <div className="stack-sm" style={{ borderTop: "1px solid var(--hairline)", paddingTop: 12 }}>
          <div className="invite-card">
            <QrCode value={p.created.link} size={148} />
            <div className="stack-sm" style={{ flex: 1, minWidth: 160 }}>
              <span className="pretty">
                Link for <b>{p.created.label}.{p.parentName}</b>. It contains the invite code: share it only with them.
              </span>
              <span className="invite-link">{p.created.link}</span>
              <div className="actions">
                <Copy value={p.created.link} label="Copy link" />
                <button className="btn-text" onClick={p.dismissCreated}>
                  Done
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {p.rows.length > 0 && (
        <div className="table flat">
          <div className="thead" style={{ gridTemplateColumns: "1.3fr 0.8fr 1.3fr" }}>
            <span>Invited</span>
            <span className="r">Salary</span>
            <span className="r">Status</span>
          </div>
          {p.rows.map(({ invite: i, statusText, canReinvite }) => (
            <div key={i.id} className="tr auto" style={{ gridTemplateColumns: "1.3fr 0.8fr 1.3fr" }}>
              <span className="mono">
                {i.label}
                <span className="ink3">.{p.parentName}</span>
                <span className="hint" style={{ display: "block" }}>
                  expires {new Date(i.expiresAt * 1000).toLocaleDateString()}
                  {i.org ? ` · ${i.org}` : ""}
                </span>
              </span>
              <span className="r num">{usdc(i.amount)}</span>
              <span className="row-actions" style={{ alignItems: "center" }}>
                <Pill tone={i.state.kind === "expired" ? "warn" : i.state.kind === "claimed-unverified" ? "danger" : "muted"}>{statusText}</Pill>
                {canReinvite ? (
                  <button className="btn-inline" disabled={p.busy || !!p.unavailable} onClick={() => void p.reinvite(i.id)}>
                    Re-invite
                  </button>
                ) : (
                  <Copy value={i.link} label="Copy link" />
                )}
                <button className="btn-inline btn-text btn-danger" disabled={p.busy} onClick={() => confirm(`Remove the invite for ${i.label}?`) && void p.remove(i.id)}>
                  Remove
                </button>
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
