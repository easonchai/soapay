import { useState } from "react";
import type { InvitesState } from "../hooks/useInvites.js";
import { formatUsdc } from "../lib/amount.js";
import { Badge, Banner, Button, Card, Input } from "../ui/kit.js";
import { QrCode } from "../ui/QrCode.js";

export type InvitesPanelProps = InvitesState & { parentName: string };

/** Props-only: invite an employee by label, show the link + QR, list pending invites. */
export function InvitesPanel(p: InvitesPanelProps) {
  const [label, setLabel] = useState("");
  const [amount, setAmount] = useState("");
  const [org, setOrg] = useState("");
  const [copied, setCopied] = useState(false);

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };

  return (
    <Card title="Invite employee">
      {p.unavailable && <Banner tone="info">{p.unavailable}</Banner>}
      <form
        className="mt-2 flex flex-wrap items-center gap-2"
        onSubmit={async (e) => {
          e.preventDefault();
          if (await p.create({ label, amount, org })) {
            setLabel("");
            setAmount("");
          }
        }}
      >
        <span className="flex items-center gap-1">
          <Input placeholder="alice" value={label} onChange={(e) => setLabel(e.target.value.toLowerCase())} className="w-32" />
          <span className="text-sm text-slate-500">.{p.parentName}</span>
        </span>
        <Input placeholder="Amount (USDC)" value={amount} onChange={(e) => setAmount(e.target.value)} className="w-36" />
        <Input placeholder="Organisation (optional)" value={org} onChange={(e) => setOrg(e.target.value)} />
        <Button type="submit" disabled={p.busy || !!p.unavailable || !label || !amount}>
          {p.busy ? "Signing…" : "Sign and create link"}
        </Button>
      </form>

      {p.error && (
        <div className="mt-3">
          <Banner tone="error">{p.error}</Banner>
        </div>
      )}

      {p.created && (
        <div className="mt-3 flex flex-wrap items-start gap-4 rounded border border-slate-200 p-3">
          <QrCode value={p.created.link} />
          <div className="flex min-w-0 flex-1 flex-col gap-2 text-sm">
            <div>
              Send this link to the employee for <b>{p.created.label}.{p.parentName}</b>. It contains the invite code: share it only with them.
            </div>
            <code className="break-all rounded bg-slate-100 p-2 text-xs">{p.created.link}</code>
            <div className="flex gap-2">
              <Button onClick={() => void copy(p.created!.link)}>{copied ? "Copied" : "Copy link"}</Button>
              <Button variant="ghost" onClick={p.dismissCreated}>Done</Button>
            </div>
          </div>
        </div>
      )}

      {p.rows.length > 0 && (
        <table className="mt-3 w-full text-left text-sm">
          <thead className="text-slate-500">
            <tr>
              <th className="py-1">Name</th>
              <th>Amount</th>
              <th>Expires</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {p.rows.map(({ invite: i, statusText, canReinvite }) => (
              <tr key={i.id} className="border-t border-slate-100 align-top">
                <td className="py-2">
                  <div>{i.label}.{p.parentName}</div>
                  {i.org && <div className="text-xs text-slate-500">{i.org}</div>}
                </td>
                <td className="py-2">{formatUsdc(i.amount)}</td>
                <td className="py-2 text-xs">{new Date(i.expiresAt * 1000).toLocaleDateString()}</td>
                <td className="py-2">
                  <Badge tone={i.state.kind === "expired" ? "warn" : i.state.kind === "claimed-unverified" ? "error" : "info"}>{statusText}</Badge>
                </td>
                <td className="py-2">
                  <div className="flex flex-wrap justify-end gap-1">
                    {canReinvite ? (
                      <Button disabled={p.busy || !!p.unavailable} onClick={() => void p.reinvite(i.id)}>Re-invite</Button>
                    ) : (
                      <Button variant="ghost" onClick={() => void copy(i.link)}>Copy link</Button>
                    )}
                    <Button variant="ghost" disabled={p.busy} onClick={() => confirm(`Remove the invite for ${i.label}?`) && void p.remove(i.id)}>
                      Remove
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}
