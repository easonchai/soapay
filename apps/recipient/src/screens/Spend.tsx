import { useState, type FormEvent } from "react";
import { useLocation, useNavigate } from "react-router";
import { offersExit, type ExitPrefill } from "../features/exit/entry.js";
import { useExit } from "../hooks/useExit.js";
import { useSpendFlow } from "../hooks/useSpendFlow.js";
import { useWallet } from "../hooks/useWallet.js";
import { explorerTxUrl } from "../config.js";
import { useServices } from "../services/ServicesProvider.js";
import { Addr, Alert, Button, Card, CardHeader, Field, Input, PageHeader } from "../ui/kit.js";
import { formatUsdc } from "../ui/format.js";
import { ExitOffer } from "./ExitOffer.js";
import { GuardDecision, canSend } from "./GuardDecision.js";

export function Spend() {
  const flow = useSpendFlow();
  const wallet = useWallet();
  const svc = useServices();
  const exit = useExit();
  const navigate = useNavigate();
  const [to, setTo] = useState("");
  // The dashboard's per-row Send prefills that address's balance; the guard still picks the sources.
  const location = useLocation();
  const [amount, setAmount] = useState(() => (location.state as { amount?: string } | null)?.amount ?? "");
  const s = flow.state;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    void flow.prepare(to, amount);
  };

  return (
    <>
      <PageHeader
        eyebrow="Send"
        title="Send"
        description="Each source address sends in its own transaction, at random intervals, with gas paid in USDC. The guard keeps your addresses from being linked."
      />
      {!flow.ready && <Alert variant="warning">{flow.unavailableReason}</Alert>}

      {(s.step === "form" || s.step === "preparing") && (
        <Card className="space-y-4 p-4 sm:p-5">
          <form onSubmit={submit} className="space-y-4" noValidate>
            <Field label="To" hint="Any address. Sending to one you've labelled as yours or known to coworkers is flagged.">
              {({ id, describedBy }) => (
                <Input id={id} aria-describedby={describedBy} placeholder="0x…" className="font-mono" value={to} onChange={(e) => setTo(e.target.value)} />
              )}
            </Field>
            <Field label="Amount (USDC)" hint={`Available: ${formatUsdc(wallet.total)} USDC`}>
              {({ id, describedBy }) => (
                <Input id={id} aria-describedby={describedBy} inputMode="decimal" placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value)} />
              )}
            </Field>
            {s.step === "form" && s.error && <Alert variant="destructive">{s.error}</Alert>}
            <Button type="submit" className="w-full" loading={s.step === "preparing"} disabled={!flow.ready}>
              {s.step === "preparing" ? "Picking sources and quoting fees…" : "Review"}
            </Button>
          </form>
        </Card>
      )}

      {s.step === "review" && (
        <div className="space-y-4">
          <Card>
            <CardHeader title={`Send ${formatUsdc(s.draft.amount)} USDC`} description={<>to <Addr address={s.draft.to} chars={6} /></>} />
            <ul className="divide-y text-sm">
              {s.draft.allocation.parts.map((p) => (
                <li key={p.address} className="flex justify-between gap-2 px-4 py-2">
                  <Addr address={p.address} />
                  <span className="tabular-nums">
                    {formatUsdc(p.amount)} <span className="text-muted-foreground">+ ≤{formatUsdc(p.fee, { precise: true })} fee</span>
                  </span>
                </li>
              ))}
            </ul>
            <p className="border-t px-4 py-2 text-xs text-muted-foreground">
              {s.draft.allocation.parts.length} transaction{s.draft.allocation.parts.length === 1 ? "" : "s"}, total fees at most{" "}
              {formatUsdc(s.draft.allocation.fees, { precise: true })} USDC (unused fee is refunded).
            </p>
          </Card>
          {!s.draft.allocation.sufficient && (
            <Alert variant="destructive" title="Not enough after fees">
              The most these addresses can deliver is {formatUsdc(s.draft.allocation.maxReceivable)} USDC.
            </Alert>
          )}
          {offersExit(s.draft.plan) && (
            <ExitOffer
              disabledReason={exit.ready ? undefined : exit.unavailableReason}
              onExit={() => {
                const prefill: ExitPrefill = { destination: s.draft.to, sources: s.draft.allocation.parts.map((p) => p.address) };
                void navigate("/exit", { state: prefill });
              }}
            />
          )}
          {s.draft.plan && <GuardDecision plan={s.draft.plan} override={s.override} onOverride={flow.setOverride} />}
          {s.error && <Alert variant="destructive">{s.error}</Alert>}
          <div className="flex gap-2">
            <Button className="flex-1" onClick={() => void flow.send()} disabled={!canSend(s.draft.plan)}>
              Send
            </Button>
            <Button variant="ghost" onClick={flow.reset}>
              Back
            </Button>
          </div>
        </div>
      )}

      {s.step === "sending" && (
        <Alert variant="info" title="Sending…">
          {s.done} of {s.total} sent. Keep this tab open: sends are spaced out on purpose so they don't share a block.
        </Alert>
      )}

      {s.step === "result" && (
        <div className="space-y-4">
          {s.outcome.failure ? (
            <Alert variant="warning" title={`Partly sent: ${s.outcome.results.length} transaction${s.outcome.results.length === 1 ? "" : "s"} went through`}>
              <p>
                The send from <Addr address={s.outcome.failure.from} /> failed: {s.outcome.failure.message}
              </p>
              <p>Only the addresses that actually sent are linked. Rescan and send the rest again.</p>
            </Alert>
          ) : (
            <Alert variant="success" title="Sent">
              {s.outcome.results.length} transaction{s.outcome.results.length === 1 ? "" : "s"} confirmed.
            </Alert>
          )}
          <ul className="space-y-1 text-sm">
            {s.outcome.results.map((r) => {
              const url = r.txHash ? explorerTxUrl(svc.settings.chainId, r.txHash) : undefined;
              return (
                <li key={r.userOpHash}>
                  <Addr address={r.from} /> → {formatUsdc(r.amount)} USDC{" "}
                  {url && !svc.mock && (
                    <a className="underline" href={url} target="_blank" rel="noreferrer">
                      view
                    </a>
                  )}
                </li>
              );
            })}
          </ul>
          <Button variant="outline" onClick={flow.reset}>
            New send
          </Button>
        </div>
      )}
    </>
  );
}
