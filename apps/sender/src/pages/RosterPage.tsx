import { useState } from "react";
import type { ImportResult, RosterState } from "../hooks/useRoster.js";
import { formatUsdc, toInputUsdc } from "../lib/amount.js";
import { describeAttestation } from "../lib/attestation.js";
import { CSV_TEMPLATE } from "../lib/csv.js";
import { Badge, Banner, Button, Card, Input, short } from "../ui/kit.js";

export type RosterPageProps = RosterState;

/** Props-only: enroll, import, verify pins, re-approve changes. */
export function RosterPage(p: RosterPageProps) {
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const [label, setLabel] = useState("");
  const [imported, setImported] = useState<ImportResult | null>(null);
  const [editing, setEditing] = useState<{ id: string; value: string } | null>(null);

  const onFile = async (f: File | undefined) => {
    if (f) setImported(await p.importCsv(await f.text()));
  };
  const templateHref = `data:text/csv;charset=utf-8,${encodeURIComponent(CSV_TEMPLATE)}`;

  return (
    <div className="flex flex-col gap-4">
      <Card title="Add an employee">
        <form
          className="flex flex-wrap gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            if (await p.enroll({ ensName: name, amount, label })) {
              setName("");
              setAmount("");
              setLabel("");
            }
          }}
        >
          <Input placeholder="alice.soapay.eth" value={name} onChange={(e) => setName(e.target.value)} />
          <Input placeholder="Amount (USDC)" value={amount} onChange={(e) => setAmount(e.target.value)} className="w-36" />
          <Input placeholder="Label (optional)" value={label} onChange={(e) => setLabel(e.target.value)} />
          <Button type="submit" disabled={p.busy || !name || !amount}>Resolve and pin</Button>
        </form>
        <div className="mt-3 flex items-center gap-3 text-sm">
          <label className="cursor-pointer underline">
            Import CSV
            <input type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => void onFile(e.target.files?.[0])} />
          </label>
          <a className="text-slate-500 underline" href={templateHref} download="soapay-roster.csv">Template</a>
        </div>
        {imported && (
          <div className="mt-3">
            <Banner tone={imported.issues.length ? "warn" : "ok"}>
              Added {imported.added}.
              {imported.issues.map((i) => (
                <div key={`${i.line}-${i.message}`}>Line {i.line}: {i.message}</div>
              ))}
            </Banner>
          </div>
        )}
      </Card>

      {p.error && <Banner tone="error">{p.error}</Banner>}

      <Card
        title={`Roster (${p.rows.length})`}
        actions={
          <Button variant="ghost" onClick={() => void p.verifyAll()} disabled={p.busy || p.rows.length === 0}>
            {p.verifyProgress ? `Verifying ${p.verifyProgress.done}/${p.verifyProgress.total}…` : "Re-verify all"}
          </Button>
        }
      >
        {p.rows.length === 0 ? (
          <p className="text-sm text-slate-500">No employees yet.</p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="text-slate-500">
              <tr>
                <th className="py-1">Name</th>
                <th>Amount</th>
                <th>Pinned meta-address</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {p.rows.map(({ employee: e, payability }) => (
                <tr key={e.id} className="border-t border-slate-100 align-top">
                  <td className="py-2">
                    <div>{e.ensName}</div>
                    {e.label && <div className="text-xs text-slate-500">{e.label}</div>}
                  </td>
                  <td className="py-2">
                    {editing?.id === e.id ? (
                      <form
                        className="flex gap-1"
                        onSubmit={async (ev) => {
                          ev.preventDefault();
                          if (await p.setAmount(e.id, editing.value)) setEditing(null);
                        }}
                      >
                        <Input className="w-28" value={editing.value} onChange={(ev) => setEditing({ id: e.id, value: ev.target.value })} autoFocus />
                        <Button type="submit">Save</Button>
                      </form>
                    ) : (
                      <button className="hover:underline" onClick={() => setEditing({ id: e.id, value: toInputUsdc(e.amount) })}>
                        {formatUsdc(e.amount)}
                      </button>
                    )}
                    {e.carry !== 0n && <div className="text-xs text-slate-500">carry {formatUsdc(e.carry)}</div>}
                  </td>
                  <td className="py-2 font-mono text-xs">
                    {short(e.pin.metaAddressURI, 8)}
                    {e.pin.attested && (
                      <div className="mt-1">
                        <Badge tone="ok">Re-verified by World ID</Badge>
                      </div>
                    )}
                  </td>
                  <td className="py-2">
                    {payability.payable ? (
                      <Badge tone="ok">Verified</Badge>
                    ) : (
                      <Badge tone={payability.reason === "changed" || payability.reason === "error" ? "error" : "info"}>
                        {payability.message}
                      </Badge>
                    )}
                    {e.pendingChange && (
                      <div className="mt-1 text-xs">
                        <div>New: <span className="font-mono">{short(e.pendingChange.metaAddressURI, 8)}</span></div>
                        <div className="text-slate-500">{describeAttestation(e.pendingChange.attestation)}</div>
                      </div>
                    )}
                  </td>
                  <td className="py-2">
                    <div className="flex flex-wrap justify-end gap-1">
                      {e.pendingChange && (
                        <Button variant="danger" disabled={p.busy} onClick={() => void p.reapprove(e.id)}>Re-approve</Button>
                      )}
                      <Button variant="ghost" disabled={p.busy} onClick={() => void p.setActive(e.id, !e.active)}>
                        {e.active ? "Pause" : "Resume"}
                      </Button>
                      <Button variant="ghost" disabled={p.busy} onClick={() => confirm(`Remove ${e.ensName}?`) && void p.remove(e.id)}>
                        Remove
                      </Button>
                      {p.simulateRotation && (
                        <>
                          <Button variant="ghost" onClick={() => void p.simulateRotation!(e.ensName, true)}>Rotate (attested)</Button>
                          <Button variant="ghost" onClick={() => void p.simulateRotation!(e.ensName, false)}>Rotate (no proof)</Button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
