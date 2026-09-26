import { useEffect, useState, type FormEvent } from "react";
import { useLocation, useNavigate } from "react-router";
import { Bloom, CountUp, Fade, Loading, NavyPanel, Presence, Progress, Stagger, StaggerItem, toast } from "@soapay/ui";
import { offersExit, type ExitPrefill } from "../features/exit/entry.js";
import { useExit } from "../hooks/useExit.js";
import { defaultPaymasterMode, type QueueWindow } from "@soapay/sdk";
import { useQueue } from "../hooks/useQueue.js";
import { parseSpendForm, useSpendFlow } from "../hooks/useSpendFlow.js";
import { useWallet } from "../hooks/useWallet.js";
import { explorerTxUrl, exitOffered } from "../config.js";
import { useServices } from "../services/ServicesProvider.js";
import { Addr, Alert, Button, Card, CardHeader, Field, Input, PageHeader, cn } from "../ui/kit.js";
import { formatUsdc, windowTime } from "../ui/format.js";
import { ExitOffer } from "./ExitOffer.js";
import { GaslessProofPanel } from "./GaslessProof.js";
import { GuardDecision, canSend } from "./GuardDecision.js";

const hours = (w: QueueWindow) => `${Math.round(w.minMs / 3_600_000)}–${Math.round(w.maxMs / 3_600_000)} h`;
const USDC_UNIT = 1_000_000;

/**
 * The timing queue (D-28): what's waiting, when each window opens, and the "send now" override.
 * `groupId` narrows it to one Send. `frame` draws it as its own panel (the Send rail) instead of a
 * section under a card.
 */
export function QueueList({ groupId, frame }: { groupId?: string; frame?: boolean }) {
  const q = useQueue();
  const chainId = useServices().settings.chainId;
  const items = q.pending.filter((i) => i.kind === "spend" && (!groupId || i.groupId === groupId));
  const failed = q.recent.filter((i) => i.kind === "spend" && i.status === "failed" && (!groupId || i.groupId === groupId));
  const sent = groupId ? q.recent.filter((i) => i.groupId === groupId && i.status === "sent") : [];
  if (items.length === 0 && failed.length === 0 && sent.length === 0) return null;
  const groups = [...new Set(items.filter((i) => i.status === "queued").map((i) => i.groupId))];
  const next = items.find((i) => i.status === "queued");
  let row = 0;
  return (
    <div className={cn("space-y-2 px-4 py-3 text-sm", frame ? "panel" : "border-t")} data-testid="spend-queue">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-medium">
          {items.length === 0 && sent.length > 0
            ? `Sent · ${sent.length} ${sent.length === 1 ? "transfer" : "transfers"}`
            : `Queued · ${items.length} ${items.length === 1 ? "transfer" : "transfers"}`}
          {next ? <span className="font-normal text-muted-foreground"> · next window {windowTime(next.opensAt)}</span> : null}
        </span>
        {groups.length > 0 && (
          <Button size="sm" variant="outline" loading={q.sending} onClick={() => void Promise.all(groups.map((g) => q.sendNow(g)))}>
            Send now
          </Button>
        )}
      </div>
      <Stagger className="divide-y" keyed={`${items.length}:${failed.length}:${sent.length}`}>
        {items.map((i) => (
          <StaggerItem key={i.id} index={row++} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
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
          </StaggerItem>
        ))}
        {failed.map((i) => (
          <StaggerItem key={i.id} index={row++} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
            <span>
              <Addr address={i.from} /> · <span className="text-destructive">{i.error}</span>
            </span>
            <Button size="sm" variant="ghost" onClick={() => void q.retry(i.id)}>
              Retry
            </Button>
          </StaggerItem>
        ))}
        {sent.map((i) => (
          <StaggerItem key={i.id} index={row++} className="flex justify-between gap-2 py-1.5 text-muted-foreground">
            <span>
              <Addr address={i.from} /> → <Addr address={i.to} /> · {formatUsdc(BigInt(i.amount))} USDC
            </span>
            {i.txHash && explorerTxUrl(chainId, i.txHash) ? (
              <a className="text-xs underline" href={explorerTxUrl(chainId, i.txHash)} target="_blank" rel="noreferrer" title={i.txHash} data-testid="queue-sent-link">
                sent ↗
              </a>
            ) : (
              <span className="text-xs">sent</span>
            )}
          </StaggerItem>
        ))}
      </Stagger>
      {groups.length > 0 && <p className="text-xs text-muted-foreground">Send now sends these within a minute of each other, so a coworker can link the addresses.</p>}
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

  const formValid = !("error" in parseSpendForm(to, amount));
  // Funded addresses not already waiting in the timing queue: what the guard can pick from.
  const readyAddresses = [...wallet.balances].filter(([a, b]) => b > 0n && !queue.locked.has(a.toLowerCase())).length;
  const gas = defaultPaymasterMode(svc.settings.chainId) === "sponsored" ? "Sponsored (testnet)" : "Paid in USDC";
  // Review and queued keep the header + rows + footnote register (edge to edge); the rest is a padded card.
  const padded = s.step !== "review" && s.step !== "queued";

  // One toast per entry into a terminal state.
  const succeeded = s.step === "result" && !s.outcome.failure;
  useEffect(() => {
    if (s.step === "queued") toast.success("Queued");
    else if (succeeded) toast.success("Sent");
  }, [s.step, succeeded]);

  return (
    <>
      <PageHeader
        eyebrow="Send"
        title="Send"
        description="Each address sends in its own transaction, spaced by a random window so your addresses stay unlinked."
        action={
          <Button variant="ghost" size="sm" onClick={() => void navigate("/connect")}>
            Use a dApp instead
          </Button>
        }
      />
      {!flow.ready && <Alert variant="warning">{flow.unavailableReason}</Alert>}

      <div className="send-grid">
        <Card className={cn(padded && "p-4 sm:p-5", s.step === "result" && "result-card")}>
          {s.step === "result" && <Bloom className="halo" />}
          <Presence mode="wait" initial={false}>
            <Fade key={s.step} x={12} duration={0.35} {...(padded ? { className: "space-y-4" } : {})}>
              {s.step === "form" && (
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
                  {s.error && <Alert variant="destructive">{s.error}</Alert>}
                  <Button type="submit" className={cn("w-full", formValid && flow.ready && "pulse")} disabled={!flow.ready}>
                    Review
                  </Button>
                </form>
              )}

              {s.step === "preparing" && <Loading label="Picking sources and quoting fees…" />}

              {s.step === "review" && (
                <>
                  <CardHeader
                    title={`Send ${formatUsdc(s.draft.amount)} USDC`}
                    description={
                      <>
                        to <Addr address={s.draft.to} chars={6} />
                      </>
                    }
                  />
                  <Stagger className="divide-y text-sm">
                    {s.draft.allocation.parts.map((p, i) => (
                      <StaggerItem key={p.address} index={i} className="flex justify-between gap-2 px-4 py-2">
                        <Addr address={p.address} />
                        <span className="tabular-nums">
                          {formatUsdc(p.amount)} <span className="text-muted-foreground">+ ≤{formatUsdc(p.fee, { precise: true })} fee</span>
                        </span>
                      </StaggerItem>
                    ))}
                  </Stagger>
                  <p className="border-t px-4 py-2 text-xs text-muted-foreground">
                    {s.draft.allocation.parts.length} transaction
                    {s.draft.allocation.parts.length === 1 ? "" : "s"}, total fees at most {formatUsdc(s.draft.allocation.fees, { precise: true })} USDC (unused fee is
                    refunded).{" "}
                    {s.draft.allocation.parts.length > 1
                      ? `Queued: one address per window of ${hours(queue.window)}, in random order, while the app is open. Send now links them by timing.`
                      : "Queued for the next window; Send now skips the wait."}
                  </p>
                  <div className="space-y-4 border-t px-4 py-4">
                    {!s.draft.allocation.sufficient && (
                      <Alert variant="destructive" title="Not enough after fees">
                        The most these addresses can deliver is {formatUsdc(s.draft.allocation.maxReceivable)} USDC.
                      </Alert>
                    )}
                    {offersExit(s.draft.plan) && exitOffered(svc.settings.chainId) && (
                      <ExitOffer
                        disabledReason={exit.ready ? undefined : exit.unavailableReason}
                        onExit={() => {
                          const prefill: ExitPrefill = {
                            destination: s.draft.to,
                            sources: s.draft.allocation.parts.map((p) => p.address),
                          };
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
                </>
              )}

              {s.step === "sending" && (
                <>
                  <Progress value={s.total > 0 ? s.done / s.total : null} label={`${s.done} of ${s.total} sent`} />
                  <p className="text-sm text-muted-foreground">Keep this tab open: sends are spaced out on purpose so they don't share a block.</p>
                </>
              )}

              {s.step === "queued" && (
                <>
                  <QueuedHeader groupId={s.groupId} amount={s.draft.amount} to={s.draft.to} />
                  <QueueList groupId={s.groupId} />
                  <div className="border-t px-4 py-3">
                    <Button variant="outline" onClick={flow.reset}>
                      New send
                    </Button>
                  </div>
                </>
              )}

              {s.step === "result" && (
                <>
                  {s.outcome.failure ? (
                    <Alert variant="warning" title={`Partly sent: ${s.outcome.results.length} transaction${s.outcome.results.length === 1 ? "" : "s"} went through`}>
                      <p>
                        The send from <Addr address={s.outcome.failure.from} /> failed: {s.outcome.failure.message}
                      </p>
                      <p>Only the addresses that actually sent are linked. Rescan and send the rest again.</p>
                    </Alert>
                  ) : (
                    <Alert variant="success" title="Sent">
                      {s.outcome.results.length} transaction
                      {s.outcome.results.length === 1 ? "" : "s"} confirmed.
                    </Alert>
                  )}
                  <Stagger className="space-y-1 text-sm">
                    {s.outcome.results.map((r, i) => {
                      const url = r.txHash ? explorerTxUrl(svc.settings.chainId, r.txHash) : undefined;
                      return (
                        <StaggerItem key={r.userOpHash} index={i}>
                          <Addr address={r.from} /> → {formatUsdc(r.amount)} USDC{" "}
                          {url && !svc.mock && (
                            <a className="underline" href={url} target="_blank" rel="noreferrer">
                              view
                            </a>
                          )}
                        </StaggerItem>
                      );
                    })}
                  </Stagger>
                  {s.outcome.results.map((r) => (
                    <GaslessProofPanel key={`proof:${r.userOpHash}`} address={r.from} txHash={r.txHash} />
                  ))}
                  <Button variant="outline" onClick={flow.reset}>
                    New send
                  </Button>
                </>
              )}
            </Fade>
          </Presence>
        </Card>

        <div className="rail">
          <NavyPanel>
            <span className="label">Available</span>
            <span className="amount">
              <CountUp value={Number(wallet.total) / USDC_UNIT} format={(n) => formatUsdc(BigInt(Math.round(n * USDC_UNIT)))} />
              <span className="unit">USDC</span>
            </span>
            <div className="rows">
              <div>
                <span className="k">Ready addresses</span>
                <span>{readyAddresses}</span>
              </div>
              <div>
                <span className="k">Gas</span>
                <span>{gas}</span>
              </div>
              <div>
                <span className="k">Queue</span>
                <span>Random window per address</span>
              </div>
            </div>
          </NavyPanel>
          <QueueList frame />
        </div>
      </div>
    </>
  );
}

/** "Queued …" while transfers wait; "Sent …" once every transfer in this send has gone out. */
function QueuedHeader({ groupId, amount, to }: { groupId?: string; amount: bigint; to: `0x${string}` }) {
  const q = useQueue();
  const waiting = q.pending.some((i) => i.kind === "spend" && i.groupId === groupId);
  return waiting ? (
    <CardHeader
      title={`Queued ${formatUsdc(amount)} USDC`}
      description={
        <>
          to <Addr address={to} chars={6} />, one address per window, in random order. Keep the app open, or come back later.
        </>
      }
    />
  ) : (
    <CardHeader
      title={`Sent ${formatUsdc(amount)} USDC`}
      description={
        <>
          to <Addr address={to} chars={6} />. Each transfer links to the block explorer below.
        </>
      }
    />
  );
}
