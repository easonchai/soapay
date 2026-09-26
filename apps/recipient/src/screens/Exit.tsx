import { useMemo, useState } from "react";
import { useLocation } from "react-router";
import { CheckCircle2, Circle, ExternalLink, Loader2, XCircle } from "lucide-react";
import type { Address } from "viem";
import { exitChainName, exitTxLink } from "../features/exit/config.js";
import { exitPrefill } from "../features/exit/entry.js";
import { fmtUsdcUp, noEligibleMessage, type ExitEstimate } from "../features/exit/planner.js";
import { legLabel, timelineOf, type TimelineStep } from "../features/exit/timeline.js";
import type { ExitLeg, ExitPrivacy, ExitRecord } from "../features/exit/types.js";
import { DEFAULT_PRIVACY, useExit, type ExitView } from "../hooks/useExit.js";
import { Addr, Alert, Badge, Button, Card, CardHeader, Checkbox, Field, Input, PageHeader, cn } from "../ui/kit.js";
import { formatUsdc, windowTime } from "../ui/format.js";

export function Exit() {
  const exit = useExit();
  const location = useLocation();
  const prefill = useMemo(() => exitPrefill(location.state), [location.state]);
  const inFlight = exit.exits.filter((x) => !x.finished);
  const finished = exit.exits.filter((x) => x.finished);
  return (
    <>
      <PageHeader
        eyebrow="Compliant exit · Privacy Pools"
        title="Exit through Privacy Pools"
        description="Move salary to a wallet people know is yours without revealing which payroll lines it came from."
      />
      <div className="space-y-4">
        {!exit.ready && <Alert variant="warning">{exit.unavailableReason}</Alert>}
        {inFlight.map((x) => (
          <ExitCard key={x.record.id} view={x} />
        ))}
        {exit.ready && <Planner key={prefill ? `${prefill.destination}` : "blank"} prefill={prefill} />}
        <PrivacyNote />
        {finished.map((x) => (
          <ExitCard key={x.record.id} view={x} />
        ))}
      </div>
    </>
  );
}

/** What the pool hides and what it doesn't. Keep this honest. */
export function PrivacyNote() {
  return (
    <Card className="space-y-2 p-4 text-sm" aria-labelledby="exit-privacy">
      <h2 id="exit-privacy" className="font-medium">
        What this hides, and what it doesn't
      </h2>
      <p>
        <span className="font-medium">Hidden:</span> which deposit a withdrawal came from. Each stealth address bridges to itself
        and deposits on its own, so your addresses aren't linked to each other on the way in, and the withdrawal to your wallet
        can't be matched to a specific deposit.
      </p>
      <p>
        <span className="font-medium">Not hidden:</span> amounts and timing. A withdrawal of exactly a deposit minus fees, or one
        that lands right after a deposit is approved, points back to it. The testnet pool is small (a few hundred deposits), so
        treat this as a demo of the mechanics, not strong privacy.
      </p>
      <p className="text-muted-foreground">
        We recommend round partial withdrawals (leave the change in the pool) and a random delay before withdrawing. Both are on
        by default.
      </p>
    </Card>
  );
}

function Planner({ prefill }: { prefill: { destination: Address; sources: Address[] } | null }) {
  const exit = useExit();
  const [destination, setDestination] = useState<string>(prefill?.destination ?? "");
  const [privacy, setPrivacy] = useState<ExitPrivacy>(DEFAULT_PRIVACY);
  const all = useMemo(() => exit.estimate(exit.sources.map((s) => s.stealthAddress), privacy), [exit, privacy]);
  const eligible = useMemo(() => new Set(all?.eligible.map((l) => l.stealthAddress.toLowerCase()) ?? []), [all]);
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set((prefill?.sources ?? []).map((a) => a.toLowerCase()).filter((a) => eligible.has(a))),
  );
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const picked = exit.sources.filter((s) => selected.has(s.stealthAddress.toLowerCase())).map((s) => s.stealthAddress);
  const est = exit.estimate(picked, privacy);

  const toggle = (a: Address, on: boolean) =>
    setSelected((s) => {
      const n = new Set(s);
      if (on) n.add(a.toLowerCase());
      else n.delete(a.toLowerCase());
      return n;
    });

  const start = async () => {
    setStarting(true);
    const r = await exit.start({ sources: picked, destination, privacy });
    setStarting(false);
    if ("error" in r) return setError(r.error);
    setError(null);
    setSelected(new Set());
  };

  if (!all) return null;
  const minLeg = fmtUsdcUp(all.minAmount);
  const nothingEligible = noEligibleMessage(all);
  return (
    <Card>
      <CardHeader
        title="Plan an exit"
        description="Pick the stealth addresses to exit. Each one is its own leg with its own bridge, deposit and withdrawal; they are never combined, and each starts in its own random time window."
      />
      <div className="space-y-4 p-4 pt-0">
        <Field label="Destination" hint="The wallet the pool pays out to, for example your main wallet or an exchange deposit address.">
          {({ id, describedBy }) => (
            <Input
              id={id}
              aria-describedby={describedBy}
              className="font-mono"
              placeholder="0x…"
              value={destination}
              onChange={(e) => setDestination(e.target.value)}
            />
          )}
        </Field>

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">Sources</legend>
          <p className="text-xs text-muted-foreground">
            The pool takes deposits of {fmtUsdcUp(all.minDeposit)} USDC or more, so after bridge fees and gas each leg needs at least{" "}
            <span className="font-medium" data-testid="exit-minimum">{minLeg} USDC</span> on one address.
          </p>
          {nothingEligible && (
            <div data-testid="exit-none-eligible">
              <Alert variant="warning" title="Below the exit minimum">
                {nothingEligible}
              </Alert>
            </div>
          )}
          {exit.sources.length === 0 && <p className="text-sm text-muted-foreground">No stealth addresses with a balance. Scan first.</p>}
          <ul className="divide-y rounded-md border">
            {all.legs.map((l) => (
              <li key={l.stealthAddress} className={cn("flex items-start gap-3 px-3 py-2 text-sm", !l.eligible && "opacity-60")} data-testid="exit-source">
                <input
                  type="checkbox"
                  aria-label={`Exit from ${l.stealthAddress}`}
                  className="mt-1 size-4 accent-primary"
                  disabled={!l.eligible}
                  checked={selected.has(l.stealthAddress.toLowerCase())}
                  onChange={(e) => toggle(l.stealthAddress, e.target.checked)}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex justify-between gap-2">
                    <Addr address={l.stealthAddress} />
                    <span className="tabular-nums">{formatUsdc(l.amount)} USDC</span>
                  </div>
                  {l.eligible ? (
                    <p className="text-xs text-muted-foreground">
                      Arrives as about {usdcRange(l.receive, l.receiveHigh)} USDC
                    </p>
                  ) : (
                    <p className="text-xs text-muted-foreground" data-testid="below-minimum">
                      {l.reason}
                    </p>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </fieldset>

        <div className="space-y-3">
          <Checkbox
            checked={privacy.roundWithdrawals}
            onChange={(v) => setPrivacy((p) => ({ ...p, roundWithdrawals: v }))}
            label="Withdraw round amounts"
            description="Withdraw whole USDC and leave the change in the pool, so the withdrawal doesn't equal the deposit minus fees."
          />
          <Checkbox
            checked={privacy.randomDelay}
            onChange={(v) => setPrivacy((p) => ({ ...p, randomDelay: v }))}
            label="Wait a random delay after approval"
            description={exit.mock ? "A few seconds in mock mode; hours in production." : "Between 2 and 24 hours, so the withdrawal doesn't follow the approval."}
          />
        </div>

        {est && est.eligible.length > 0 && <FeeSummary est={est} destination={destination} />}
        {error && <Alert variant="destructive">{error}</Alert>}
        <Button className="w-full" onClick={() => void start()} loading={starting} disabled={picked.length === 0}>
          Start exit{picked.length > 1 ? ` (${picked.length} legs)` : ""}
        </Button>
      </div>
    </Card>
  );
}

const usdcRange = (lo: bigint, hi: bigint) => (formatUsdc(lo) === formatUsdc(hi) ? formatUsdc(lo) : `${formatUsdc(lo)}–${formatUsdc(hi)}`);

export function FeeSummary({ est, destination }: { est: ExitEstimate; destination: string }) {
  const t = est.totals;
  const n = est.eligible.length;
  const row = (label: string, value: string, testId?: string) => (
    <div className="flex justify-between gap-2 py-1" {...(testId ? { "data-testid": testId } : {})}>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  );
  return (
    <dl className="rounded-md border px-3 py-2 text-sm" data-testid="exit-fees">
      {row(`From ${n} address${n === 1 ? "" : "es"} (${n} leg${n === 1 ? "" : "s"})`, `${formatUsdc(t.amount)} USDC`)}
      {row("CCTP forwarding (Circle mints for you)", `−${formatUsdc(t.forwardFeeLow)}–${formatUsdc(t.forwardFeeHigh)}`, "fee-forward")}
      {row("Paymaster gas reserve, both chains (unused gas is refunded to the address)", `−${formatUsdc(t.gas)}`, "fee-gas")}
      {row("Pool entry fee (1%)", `−${formatUsdc(t.vettingFee)}`, "fee-pool")}
      {row("Relayer (0.1%)", `−${formatUsdc(t.relayerFee, { precise: true })}`, "fee-relayer")}
      {t.leftInPool > 0n && row("Left in the pool (round withdrawals)", formatUsdc(t.leftInPool, { precise: true }), "left-in-pool")}
      <div className="mt-1 flex justify-between gap-2 border-t pt-2 font-medium" data-testid="exit-receive">
        <dt>
          Arrives at {destination ? <Addr address={destination} /> : "the destination"} on {exitChainName(11155111)}
        </dt>
        <dd className="tabular-nums">
          ≈ {usdcRange(t.receive, t.receiveHigh)} USDC
        </dd>
      </div>
    </dl>
  );
}

function ExitCard({ view }: { view: ExitView }) {
  const { record, legs } = view;
  const done = legs.filter((l) => l.status === "done").length;
  return (
    <Card>
      <CardHeader
        title={view.finished ? "Finished exit" : "Exit in progress"}
        description={
          <>
            {legs.length} leg{legs.length === 1 ? "" : "s"} to <Addr address={record.destination} chars={6} /> ·{" "}
            {new Date(record.createdAt).toLocaleString()}
            {view.finished && ` · ${done} of ${legs.length} delivered`}
          </>
        }
      />
      <ul className="space-y-4 p-4 pt-0">
        {legs.map((leg) => (
          <li key={leg.id}>
            <LegTimeline leg={leg} record={record} />
          </li>
        ))}
      </ul>
    </Card>
  );
}

function statusTone(leg: ExitLeg): "neutral" | "success" | "warning" | "destructive" | "accent" {
  if (leg.status === "done") return "success";
  if (leg.status === "declined" || leg.status === "refunded") return "warning";
  if (leg.status === "failed") return "destructive";
  return "accent";
}

export function LegTimeline({ leg, record }: { leg: ExitLeg; record: ExitRecord }) {
  const exit = useExit();
  const steps = timelineOf(leg);
  const hold = record.holdUntil[leg.id];
  const holding = leg.status === "approved" && hold !== undefined && hold > Date.now();
  const queuedAt = exit.queuedAt[leg.id];
  const error = exit.errors[leg.id] ?? leg.error;
  return (
    <div className="rounded-md border p-3" data-testid="exit-leg" data-status={leg.status}>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-sm">
        <span>
          <Addr address={leg.stealthAddress} /> · {formatUsdc(BigInt(leg.amount))} USDC
        </span>
        <Badge tone={statusTone(leg)}>{legLabel(leg)}</Badge>
      </div>
      <ol className="space-y-1.5">
        {steps.map((s) => (
          <Step key={s.status} step={s} record={record} mock={exit.mock} />
        ))}
      </ol>
      {leg.status === "planned" && queuedAt !== undefined && (
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground" data-testid="exit-queued">
          <span>Queued: this deposit starts {windowTime(queuedAt)}. One address per window, so your deposits aren&apos;t linked by timing.</span>
          <Button
            size="sm"
            variant="outline"
            onClick={() => void exit.startNow(record.id)}
            title="Starts every queued leg of this exit now: a coworker can link these addresses by timing."
          >
            Start now
          </Button>
        </div>
      )}
      {holding && (
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
          <span>Random delay: withdrawing around {new Date(hold).toLocaleTimeString()}.</span>
          <Button size="sm" variant="outline" onClick={() => void exit.withdrawNow(record.id, leg.id)}>
            Withdraw now
          </Button>
        </div>
      )}
      {(leg.status === "declined" || leg.status === "refunded") && (
        <Alert variant="warning" className="mt-2" title={leg.status === "declined" ? "Declined: refunding" : "Refunded"}>
          The pool's screening didn't approve this deposit, so it goes back through ragequit to the same stealth address on{" "}
          {exitChainName(record.destChainId)}. That refund is public, and nothing from this leg reaches your destination.
        </Alert>
      )}
      {error && (
        <Alert
          variant={leg.status === "failed" ? "destructive" : "warning"}
          className="mt-2"
          action={
            leg.status === "failed" ? (
              <Button size="sm" variant="outline" onClick={() => void exit.retry(record.id, leg.id)}>
                Retry
              </Button>
            ) : undefined
          }
        >
          {leg.status === "failed" ? error : `Will retry: ${error}`}
        </Alert>
      )}
    </div>
  );
}

function Step({ step, record, mock }: { step: TimelineStep; record: ExitRecord; mock: boolean }) {
  const Icon = step.state === "done" ? CheckCircle2 : step.state === "active" ? Loader2 : step.state === "error" ? XCircle : Circle;
  const chainId = step.tx?.chain === "source" ? record.sourceChainId : record.destChainId;
  const link = step.tx ? exitTxLink(chainId, step.tx.hash) : null;
  return (
    <li className="flex items-start gap-2 text-sm" data-state={step.state}>
      <Icon
        aria-hidden
        className={cn(
          "mt-0.5 size-4 shrink-0",
          step.state === "done" && "text-success",
          step.state === "active" && "animate-spin text-primary",
          step.state === "error" && "text-warning",
          step.state === "todo" && "text-muted-foreground/50",
        )}
      />
      <div className="min-w-0 flex-1">
        <span className={cn(step.state === "todo" && "text-muted-foreground")}>{step.title}</span>
        {link && (
          <a
            className="ml-2 inline-flex items-center gap-0.5 text-xs underline"
            href={link.href}
            target="_blank"
            rel="noreferrer"
            title={mock ? "Mock transaction: this hash doesn't exist on-chain" : undefined}
          >
            {link.name}
            <ExternalLink className="size-3" aria-hidden />
          </a>
        )}
        {step.hint && (step.state === "active" || step.state === "error") && <p className="text-xs text-muted-foreground">{step.hint}</p>}
      </div>
    </li>
  );
}
