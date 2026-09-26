import { useMemo, useState } from "react";
import { useLocation } from "react-router";
import { CheckCircle2, Circle, ExternalLink, Loader2, XCircle } from "lucide-react";
import type { Address } from "viem";
import { exitChainName, exitTxLink } from "../features/exit/config.js";
import { exitPrefill } from "../features/exit/entry.js";
import { fmtPercent, fmtUsdcUp, noEligibleMessage, type ExitEstimate } from "../features/exit/planner.js";
import { legLabel, timelineOf, type TimelineStep } from "../features/exit/timeline.js";
import type { ExitLeg, ExitPrivacy, ExitRecord, ExitWithdrawVia } from "../features/exit/types.js";
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
  const [via, setVia] = useState<ExitWithdrawVia>("relayer");
  const all = useMemo(() => exit.estimate(exit.sources.map((s) => s.stealthAddress), privacy, via), [exit, privacy, via]);
  // Selection survives a switch between relayed and direct: an address may be eligible in only one.
  const [selected, setSelected] = useState<Set<string>>(() => new Set((prefill?.sources ?? []).map((a) => a.toLowerCase())));
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const eligible = new Set(all?.eligible.map((l) => l.stealthAddress.toLowerCase()) ?? []);
  const picked = exit.sources.filter((s) => selected.has(s.stealthAddress.toLowerCase()) && eligible.has(s.stealthAddress.toLowerCase())).map((s) => s.stealthAddress);
  const est = exit.estimate(picked, privacy, via);

  const toggle = (a: Address, on: boolean) =>
    setSelected((s) => {
      const n = new Set(s);
      if (on) n.add(a.toLowerCase());
      else n.delete(a.toLowerCase());
      return n;
    });

  const start = async () => {
    setStarting(true);
    const r = await exit.start({ sources: picked, destination, privacy, withdrawVia: via });
    setStarting(false);
    if ("error" in r) return setError(r.error);
    setError(null);
    setSelected(new Set());
  };

  if (!all) return null;
  const minLeg = fmtUsdcUp(all.minAmount);
  const nothingEligible = noEligibleMessage(all);
  const directHelps = via === "relayer" && all.legs.some((l) => l.directWouldWork);
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
            The pool takes deposits of {fmtUsdcUp(all.minDeposit)} USDC or more, so after bridge fees and gas
            {via === "relayer" ? " (and the relayer's fixed fee)" : ""} each leg needs at least{" "}
            <span className="font-medium" data-testid="exit-minimum">{minLeg} USDC</span> on one address.
          </p>
          <QuoteNote />
          {nothingEligible && (
            <div data-testid="exit-none-eligible">
              <Alert variant="warning" title={directHelps ? "The relayer costs more than these exits" : "Below the exit minimum"}>
                {nothingEligible}
              </Alert>
            </div>
          )}
          {directHelps && !nothingEligible && (
            <div data-testid="exit-direct-suggest">
              <Alert variant="warning" title="The relayer costs more than some of these exits">
                The relayer charges about {fmtUsdcUp(all.relayGas)} USDC per withdrawal for its gas, so the greyed-out addresses can&apos;t exit
                through it. Withdraw directly instead to exit them (each needs {fmtUsdcUp(all.directMinAmount)} USDC).
              </Alert>
            </div>
          )}
          {directHelps && (
            <Button size="sm" variant="outline" onClick={() => setVia("direct")} data-testid="exit-use-direct">
              Withdraw directly instead
            </Button>
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
                  checked={l.eligible && selected.has(l.stealthAddress.toLowerCase())}
                  onChange={(e) => toggle(l.stealthAddress, e.target.checked)}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex justify-between gap-2">
                    <Addr address={l.stealthAddress} />
                    <span className="tabular-nums">{formatUsdc(l.amount)} USDC</span>
                  </div>
                  {l.eligible ? (
                    <p className="text-xs text-muted-foreground">
                      Arrives as about {formatUsdc(l.receive)} USDC ({fmtPercent(10_000n - l.feeShareBps)} of it)
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
            checked={via === "direct"}
            onChange={(v) => setVia(v ? "direct" : "relayer")}
            label="Withdraw directly (your destination wallet pays a little ETH gas)"
            description={<DirectNote />}
          />
          <Checkbox
            checked={privacy.roundWithdrawals}
            onChange={(v) => setPrivacy((p) => ({ ...p, roundWithdrawals: v }))}
            label="Withdraw round amounts"
            description={
              via === "direct"
                ? "Not used with a direct withdrawal: it takes everything in one part, so no change is left behind."
                : "Withdraw whole USDC and leave the change in the pool, so the withdrawal doesn't equal the deposit minus fees."
            }
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

/** Where the fee figures come from: live quotes, or the route's estimates. */
function QuoteNote() {
  const { quote } = useExit();
  const at = quote.quote ? new Date(quote.quote.at).toLocaleTimeString() : "";
  const text =
    quote.status === "loading"
      ? "Getting live fee quotes…"
      : quote.status === "live"
        ? `Fees from live quotes (Circle, the relayer, Sepolia gas) at ${at}.`
        : quote.status === "partial"
          ? `Fees partly from live quotes at ${at}; the rest are estimates.`
          : "Live fee quotes are unavailable, so these fees are estimates.";
  return (
    <p className="text-xs text-muted-foreground" data-testid="exit-quote" data-status={quote.status}>
      {text}
    </p>
  );
}

/** The direct-withdrawal caveat: the ETH for gas must not come from a wallet linked to you. */
export function DirectNote() {
  return (
    <span data-testid="exit-direct-note">
      No relayer fee: your destination wallet sends the withdrawal itself and pays about 0.001 Sepolia ETH of gas. Fund it from a
      source not linked to you, such as a public faucet or an exchange; ETH sent from one of your own wallets links the two.
    </span>
  );
}

export function FeeSummary({ est, destination }: { est: ExitEstimate; destination: string }) {
  const t = est.totals;
  const n = est.eligible.length;
  const row = (label: string, value: string, testId?: string) => (
    <div className="flex justify-between gap-2 py-1" {...(testId ? { "data-testid": testId } : {})}>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  );
  const direct = est.via === "direct";
  const keeps = t.amount > 0n ? 10_000n - est.feeShareBps : 0n;
  return (
    <div className="space-y-2">
      <dl className="rounded-md border px-3 py-2 text-sm" data-testid="exit-fees">
        {row(`From ${n} address${n === 1 ? "" : "es"} (${n} leg${n === 1 ? "" : "s"})`, `${formatUsdc(t.amount)} USDC`)}
        {row("Bridge fees (CCTP + Circle forwarding)", `−${formatUsdc(t.bridgeFee, { precise: true })}`, "fee-bridge")}
        {row("Deposit gas, both chains (paymaster prefund; unused gas stays on the address)", `−${formatUsdc(t.gas, { precise: true })}`, "fee-gas")}
        {row("Pool entry fee (1%)", `−${formatUsdc(t.vettingFee, { precise: true })}`, "fee-pool")}
        {direct
          ? row("Relayer: none (your wallet pays ≈ 0.001 ETH gas)", "0.00", "fee-relayer")
          : row(`Relayer (${formatUsdc(est.relayGas)} USDC gas + 0.1%)`, `−${formatUsdc(t.relayerFee, { precise: true })}`, "fee-relayer")}
        <div className="mt-1 flex justify-between gap-2 border-t pt-2" data-testid="fee-total">
          <dt>Total fees</dt>
          <dd className="tabular-nums">
            −{formatUsdc(t.totalFees, { precise: true })} USDC ({fmtPercent(est.feeShareBps)})
          </dd>
        </div>
        {t.leftInPool > 0n && row("Left in the pool (round withdrawals; yours, withdrawable later)", formatUsdc(t.leftInPool, { precise: true }), "left-in-pool")}
        <div className="mt-1 flex justify-between gap-2 border-t pt-2 font-medium" data-testid="exit-receive">
          <dt>
            You receive at {destination ? <Addr address={destination} /> : "the destination"} on {exitChainName(11155111)}
          </dt>
          <dd className="tabular-nums">
            ≈ {formatUsdc(t.receive)} of {formatUsdc(t.amount)} USDC ({fmtPercent(keeps)})
          </dd>
        </div>
        {!direct && t.relayerFeeCap > 0n && (
          <p className="pt-1 text-xs text-muted-foreground" data-testid="relayer-cap">
            If the relayer asks more than {formatUsdc(t.relayerFeeCap)} USDC when it&apos;s time to withdraw, the exit waits for a lower quote
            (or you can withdraw directly).
          </p>
        )}
      </dl>
      {est.highFees && (
        <div data-testid="exit-fee-warning">
          <Alert variant="warning" title={`Fees take ${fmtPercent(est.feeShareBps)} of this exit`}>
            They are mostly fixed per leg (Circle&apos;s forwarding, Sepolia gas{direct ? "" : ", the relayer's gas"}), so a larger exit loses a
            smaller share. Consider exiting later, once one address holds more, or combining chunks into one address first (that links those
            chunks to each other; the Send guard shows it).{!direct && " A direct withdrawal also skips the relayer's fee."}
          </Alert>
        </div>
      )}
    </div>
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
  const [sending, setSending] = useState(false);
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
      {leg.status === "approved" && !holding && (leg.withdrawVia === "direct" || relayTooExpensive(error)) && (
        <DirectWithdrawOffer
          direct={leg.withdrawVia === "direct"}
          onWithdraw={async () => {
            setSending(true);
            await exit.withdrawDirect(record.id, leg.id);
            setSending(false);
          }}
          sending={sending}
        />
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

/** The relayer refused on price (more than the withdrawal, over the pool limit, or over the accepted fee). */
export function relayTooExpensive(error: string | undefined): boolean {
  return !!error && /relayer asks .*waiting for a lower quote/.test(error);
}

/** An approved leg that should (or must) leave without the relayer: the destination wallet withdraws. */
function DirectWithdrawOffer({ direct, onWithdraw, sending }: { direct: boolean; onWithdraw: () => Promise<void>; sending: boolean }) {
  return (
    <div className="mt-2 space-y-2 rounded-md border p-3 text-xs" data-testid="exit-direct-offer">
      <p>
        {direct
          ? "Approved. This leg withdraws directly: connect the destination wallet in this browser and confirm one transaction."
          : "The relayer would take more than this withdrawal is worth right now. You can wait for a lower quote, or withdraw directly."}
      </p>
      <p className="text-muted-foreground">
        <DirectNote />
      </p>
      <Button size="sm" variant="outline" loading={sending} onClick={() => void onWithdraw()}>
        Withdraw directly (your destination wallet pays a little ETH gas)
      </Button>
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
