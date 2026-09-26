import { useState, type FormEvent } from "react";
import { useLocation, useNavigate } from "react-router";
import { offersExit, type ExitPrefill } from "../features/exit/entry.js";
import { useExit } from "../hooks/useExit.js";
import type { QueueWindow } from "@soapay/sdk";
import { useQueue } from "../hooks/useQueue.js";
import { useSpendFlow } from "../hooks/useSpendFlow.js";
import { useWallet } from "../hooks/useWallet.js";
import { explorerTxUrl } from "../config.js";
import { useServices } from "../services/ServicesProvider.js";
import { Addr, Alert, Button, Card, CardHeader, Field, Input, PageHeader } from "../ui/kit.js";
import { formatUsdc, windowTime } from "../ui/format.js";
import { ExitOffer } from "./ExitOffer.js";
import { GaslessProofPanel } from "./GaslessProof.js";
import { GuardDecision, canSend } from "./GuardDecision.js";

const hours = (w: QueueWindow) => `${Math.round(w.minMs / 3_600_000)}–${Math.round(w.maxMs / 3_600_000)} h`;

/**
 * The timing queue (D-28) inside the current card: what's waiting, when each window opens, and the
 * "send now" override. `groupId` narrows it to one Send.
 */
export function QueueList({ groupId }: { groupId?: string }) {
  const q = useQueue();
  const items = q.pending.filter((i) => i.kind === "spend" && (!groupId || i.groupId === groupId));
  const failed = q.recent.filter((i) => i.kind === "spend" && i.status === "failed" && (!groupId || i.groupId === groupId));
  const sent = groupId ? q.recent.filter((i) => i.groupId === groupId && i.status === "sent") : [];
  if (items.length === 0 && failed.length === 0 && sent.length === 0) return null;
  const groups = [...new Set(items.filter((i) => i.status === "queued").map((i) => i.groupId))];
  const next = items.find((i) => i.status === "queued");
  return (
    <div className="space-y-2 border-t px-4 py-3 text-sm" data-testid="spend-queue">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-medium">
          Queued · {items.length} {items.length === 1 ? "transfer" : "transfers"}
          {next ? <span className="font-normal text-muted-foreground"> · next window {windowTime(next.opensAt)}</span> : null}
        </span>
        {groups.length > 0 && (
          <Button size="sm" variant="outline" loading={q.sending} onClick={() => void Promise.all(groups.map((g) => q.sendNow(g)))}>
            Send now
          </Button>
        )}
      </div>
      <ul className="divide-y">
        {items.map((i) => (
          <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
            <span>
              <Addr address={i.from} /> → <Addr address={i.to} /> · <span className="tabular-nums">{formatUsdc(BigInt(i.amount))} USDC</span>
            </span>
            <span className="flex items-center gap-2 text-xs text-muted-foreground">
              {i.status === "released" ? "sending…" : windowTime(i.opensAt)}
              {i.status === "queued" && (
                <Button size="sm" variant="ghost" onClick={() => void q.cancel(i.id)}>
                  Cancel
                </Button>
              )}
            </span>
          </li>
        ))}
        {failed.map((i) => (
          <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
            <span>
              <Addr address={i.from} /> · <span className="text-destructive">{i.error}</span>
            </span>
            <Button size="sm" variant="ghost" onClick={() => void q.retry(i.id)}>
              Retry
            </Button>
          </li>
        ))}
        {sent.map((i) => (
          <li key={i.id} className="flex justify-between gap-2 py-1.5 text-muted-foreground">
            <span>
              <Addr address={i.from} /> → <Addr address={i.to} /> · {formatUsdc(BigInt(i.amount))} USDC
            </span>
            <span className="text-xs">sent</span>
          </li>
        ))}
      </ul>
      {groups.length > 0 && (
        <p className="text-xs text-muted-foreground">Send now sends these within a minute of each other, so a coworker can link the addresses.</p>
      )}
    </div>
  );
}

export function Spend() {
  const flow = useSpendFlow();
  const queue = useQueue();
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
        description="Each source address sends in its own transaction, with gas paid in USDC. Sends are queued, one address per random window of hours, so your addresses aren't linked by timing."
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
          <QueueList />
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
              {formatUsdc(s.draft.allocation.fees, { precise: true })} USDC (unused fee is refunded).{" "}
              {s.draft.allocation.parts.length > 1
                ? `Queued: one address per window of ${hours(queue.window)}, in random order, while the app is open. Send now links them by timing.`
                : "Queued for the next window; Send now skips the wait."}
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
          {s.draft.plan && (
            <GuardDecision
              plan={s.draft.plan}
              override={s.override}
              onOverride={flow.setOverride}
              txUrl={svc.mock ? undefined : (h) => explorerTxUrl(svc.settings.chainId, h)}
            />
          )}
          {s.error && <Alert variant="destructive">{s.error}</Alert>}
          <div className="flex gap-2">
            <Button className="flex-1" onClick={() => void flow.send()} disabled={!canSend(s.draft.plan)}>
              Queue send
            </Button>
            <Button
              variant="outline"
              onClick={() => void flow.sendNow()}
              disabled={!canSend(s.draft.plan)}
              title="Sends every source within a minute: a coworker watching the chain can link these addresses."
            >
              Send now
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

      {s.step === "queued" && (
        <div className="space-y-4">
          <Card>
            <CardHeader
              title={`Queued ${formatUsdc(s.draft.amount)} USDC`}
              description={
                <>
                  to <Addr address={s.draft.to} chars={6} />, one address per window, in random order. Keep the app open, or come back later.
                </>
              }
            />
            <QueueList groupId={s.groupId} />
          </Card>
          <Button variant="outline" onClick={flow.reset}>
            New send
          </Button>
        </div>
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
          {s.outcome.results.map((r) => (
            <GaslessProofPanel key={`proof:${r.userOpHash}`} address={r.from} txHash={r.txHash} />
          ))}
          <Button variant="outline" onClick={flow.reset}>
            New send
          </Button>
        </div>
      )}
    </>
  );
}
