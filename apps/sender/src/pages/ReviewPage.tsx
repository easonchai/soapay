import { useMemo, useState } from "react";
import { formatEther } from "viem";
import { Bloom, Collapse, CountUp, ErrorLine, FreshMark, NavyPanel, Stagger, StaggerItem } from "@soapay/ui";
import type { PayPathState, WalletState } from "../hooks/usePayPath.js";
import type { PayRunState } from "../hooks/usePayRun.js";
import { USDC_DECIMALS } from "../lib/amount.js";
import type { RunPlan } from "../lib/run.js";
import { testnetRunConfirmation } from "../lib/testnet.js";
import { Notice, plural, short, usdc } from "../ui/kit.js";

export type ReviewPageProps = {
  run: PayRunState;
  plan: RunPlan;
  wallet: WalletState;
  payPath: PayPathState;
  chainName: string;
  /** On a testnet, a run above 50 USDC asks for a confirmation first (D-47). */
  testnet?: boolean;
  onBack(): void;
};

const trim = (s: string) => s.replace(/\.00$/, "");

/** CK's Review & sign over our plan: pay on the wallet's path, or export the run for a Safe. */
export function ReviewPage({ run, plan, wallet, payPath, chainName, testnet = false, onBack }: ReviewPageProps) {
  const [safe, setSafe] = useState("");
  const bigTestRun = testnetRunConfirmation(plan.total, testnet);
  const [bigRunOk, setBigRunOk] = useState(false);
  const confirmed = !bigTestRun || bigRunOk;
  const [showSafe, setShowSafe] = useState(false);
  const [showHow, setShowHow] = useState(false);
  const path = payPath.probe?.path;
  const canPay = path?.kind === "batch" || path?.kind === "disperse";
  const sending = run.stage === "executing";
  const chunk = plan.denomination?.chunkSize;
  const chunkLabel = chunk ? trim(usdc(chunk)) : undefined;
  const txs = plan.estimate.txCount;
  const remainders = chunk ? plan.lines.filter((l) => l.amount !== chunk).length : 0;

  const people = useMemo(() => {
    const m = new Map<string, { id: string; name: string; amount: bigint; amounts: bigint[]; first: `0x${string}` }>();
    for (const l of plan.lines) {
      const cur = m.get(l.recipientId) ?? { id: l.recipientId, name: plan.names.get(l.recipientId) ?? l.recipientId, amount: 0n, amounts: [], first: l.stealthAddress };
      cur.amount += l.amount;
      cur.amounts.push(l.amount);
      m.set(l.recipientId, cur);
    }
    return [...m.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [plan]);

  const linesText = (p: { amounts: bigint[] }) => {
    if (!chunk || p.amounts.length === 1) return String(p.amounts.length);
    const full = p.amounts.filter((a) => a === chunk).length;
    const rest = p.amounts.filter((a) => a !== chunk);
    return `${full} × ${chunkLabel}${rest.length ? ` + ${rest.map((a) => trim(usdc(a))).join(", ")} rem.` : ""}`;
  };

  const modeCard = !wallet.isConnected
    ? { h: "Connect a wallet to pay", p: "Or export for a Safe below." }
    : payPath.loading
      ? { h: "Checking your wallet…", p: "" }
      : path
        ? {
            h:
              path.kind === "batch"
                ? `${plural(txs, "atomic batch", "atomic batches")}, one signature each (EIP-5792)`
                : path.kind === "disperse"
                  ? `Approve the exact total, then ${plural(txs, "StealthDisperse payment")}`
                  : path.title,
            p: path.reason,
          }
        : { h: "Couldn't check your wallet", p: payPath.error ?? "" };

  // One "Before you send" box: every condition that used to be its own Notice, as a list item.
  const warnings: { key: string; text: string }[] = [];
  if (plan.smallTeam) warnings.push({ key: "small-team", text: plan.smallTeam });
  if (!chunk) warnings.push({ key: "denoms-off", text: "Denominated payouts off: every line is a whole salary, readable by coworkers on chain." });
  if (chunk && remainders > 0) {
    warnings.push({
      key: "remainders",
      text: `${remainders === 1 ? "1 remainder line" : `${remainders} remainder lines`} under ${chunkLabel} USDC stand${remainders === 1 ? "s" : ""} out: paid in full, never carried over.`,
    });
  }
  if (plan.denomStats && plan.denomStats.uniqueAmountCount > 0) {
    warnings.push({ key: "unique-amounts", text: `${plural(plan.denomStats.uniqueAmountCount, "line amount")} occur only once and can single someone out.` });
  }
  for (const m of run.funding?.problems ?? []) warnings.push({ key: `funding:${m}`, text: m });
  if (wallet.wrongChain) warnings.push({ key: "wrong-chain", text: `Wallet on another chain; it will be asked to switch to ${chainName}.` });

  return (
    <div className="review">
      <div className="stack">
        <button className="btn-text" style={{ alignSelf: "flex-start", marginLeft: -6 }} onClick={onBack} disabled={sending}>
          ← Back to edit
        </button>
        <span className="eyebrow">Review · {run.label.trim() || "pay run"}</span>
        <h1>
          <CountUp value={Number(plan.total) / 10 ** USDC_DECIMALS} format={(n) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} duration={0.8} /> USDC
          to {plural(people.length, "person", "people")}, on {plural(plan.lines.length, "fresh address", "fresh addresses")}.
        </h1>
        <p className="ink2 pretty">
          {txs === 1 ? "One transaction." : `${txs} transactions from one sorted list.`}{" "}
          {chunk
            ? `On chain: ${plan.lines.length} payments of about ${chunkLabel} USDC to ${plan.lines.length} strangers.`
            : `On chain: ${plan.lines.length} payments to ${plan.lines.length} strangers.`}
        </p>
        <NavyPanel dots={false}>
          <div className="rows">
            <div>
              <span className="k">Recipients</span>
              <span>{people.length}</span>
            </div>
            <div>
              <span className="k">{chunk ? `Lines (${chunkLabel} USDC chunks${plan.denomination?.mode === "carry" ? ", carry" : ""})` : "Lines"}</span>
              <span>{plan.lines.length}</span>
            </div>
            <div>
              <span className="k">Transactions</span>
              <span>{txs}</span>
            </div>
            <div>
              <span className="k">Gas (est.)</span>
              <span>
                {plan.estimate.totalGas.toString()}
                {run.funding?.feeWei != null ? ` · ${Number(formatEther(run.funding.feeWei)).toPrecision(3)} ETH` : ""}
              </span>
            </div>
            <div className="total">
              <span className="k">Total</span>
              <span className="v">{usdc(plan.total)} USDC</span>
            </div>
            <div>
              <span className="k">Network</span>
              <span>{chainName}</span>
            </div>
            <div>
              <span className="k">From</span>
              <span>{wallet.address ? short(wallet.address) : "—"}</span>
            </div>
          </div>
        </NavyPanel>
        <div className="panel" style={{ padding: "12px 16px" }}>
          <div className="between">
            <span style={{ fontSize: 13, fontWeight: 500 }}>{modeCard.h}</span>
            {modeCard.p && (
              <button className="btn-text" style={{ marginRight: -6 }} onClick={() => setShowHow((s) => !s)} aria-expanded={showHow}>
                {showHow ? "Hide" : "How it pays"}
              </button>
            )}
          </div>
          <Collapse open={showHow && !!modeCard.p}>
            <p className="ink2 pretty" style={{ marginTop: 6, fontSize: 13 }}>
              {modeCard.p}
            </p>
          </Collapse>
        </div>
        {warnings.length > 0 && (
          <Notice tone="warn">
            <span className="t">Before you send</span>
            <ul>
              {warnings.map((w) => (
                <li key={w.key}>{w.text}</li>
              ))}
            </ul>
          </Notice>
        )}
        {bigTestRun && (
          <Notice tone="warn">
            <span data-testid="testnet-big-run">{bigTestRun}</span>{" "}
            <label style={{ display: "inline-flex", alignItems: "center", gap: 6, marginTop: 6 }}>
              <input type="checkbox" checked={bigRunOk} onChange={(e) => setBigRunOk(e.target.checked)} />
              Send it anyway
            </label>
          </Notice>
        )}
        <ErrorLine error={run.error} />
      </div>

      <div className="col-right">
        <Bloom className="halo" leaving={sending} />
        <div className="between" style={{ alignItems: "baseline", marginBottom: 12 }}>
          <span style={{ fontWeight: 500 }}>What each person receives</span>
          <span className="ink2">History keeps them for audit; every run derives new ones.</span>
        </div>
        <div className="table">
          <div className="thead" style={{ gridTemplateColumns: "1.2fr 0.9fr 1.5fr 1.3fr" }}>
            <span>Name</span>
            <span className="r">Amount</span>
            <span className="r">Lines</span>
            <span className="r">First fresh address</span>
          </div>
          <Stagger>
            {people.slice(0, 12).map((p, i) => (
              <StaggerItem key={p.id} index={i} className="tr mono" style={{ gridTemplateColumns: "1.2fr 0.9fr 1.5fr 1.3fr", display: "grid" }}>
                <span>{p.name}</span>
                <span className="r num">{usdc(p.amount)}</span>
                <span className="r ink2" style={{ whiteSpace: "nowrap" }}>{linesText(p)}</span>
                <span className="r" style={{ display: "inline-flex", justifyContent: "flex-end", alignItems: "center", gap: 6, whiteSpace: "nowrap" }}>
                  <FreshMark />
                  {short(p.first, 4)}
                  {p.amounts.length > 1 && <span className="ink3">+{p.amounts.length - 1}</span>}
                </span>
              </StaggerItem>
            ))}
          </Stagger>
          <div className="foot">
            <span>
              {people.length > 12 ? `…and ${people.length - 12} more. ` : ""}
              {chunk
                ? plan.denomination?.mode === "carry"
                  ? "Carry mode: every line is a whole chunk."
                  : "rem. = remainder: one smaller final line, the only one that stands out."
                : "One line per recipient."}
            </span>
          </div>
        </div>
      </div>

      {/* Safe export row: full width, directly above the bar, so opening it never moves the actions. */}
      <div className="safe-row">
        <Collapse open={showSafe}>
          <div className="actions">
            <input className="mono" style={{ flex: 1 }} placeholder="Safe address 0x…" value={safe} onChange={(e) => setSafe(e.target.value)} aria-label="Safe address" />
            <button onClick={() => void run.exportSafe(safe)} disabled={!safe || sending}>
              Export for Safe
            </button>
          </div>
        </Collapse>
      </div>

      <div className="action-bar">
        <button className="btn-lg" onClick={onBack} disabled={sending}>
          Back to edit
        </button>
        <button className="btn-text" onClick={() => setShowSafe((s) => !s)} aria-expanded={showSafe}>
          {showSafe ? "Hide Safe export" : "Paying from a Safe? Export instead"}
        </button>
        <span className="spacer" />
        <button className="btn-primary btn-lg" onClick={() => void run.execute()} disabled={sending || !canPay || !confirmed}>
          {sending ? "Sending… confirm in wallet" : path?.kind === "disperse" ? "Approve and send" : "Sign and send"}
        </button>
      </div>
    </div>
  );
}
