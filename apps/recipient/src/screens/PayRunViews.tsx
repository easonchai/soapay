import { Fragment, useState } from "react";
import { Toggle } from "@soapay/ui";
import type { OwnedBatch } from "@soapay/sdk";
import type { Hex } from "viem";
import { explorerTxUrl } from "../config.js";
import { payRunGroups, usePayRunBatch } from "../hooks/useChainViews.js";
import { useWallet } from "../hooks/useWallet.js";
import { useServices } from "../services/ServicesProvider.js";
import { Addr, Alert } from "../ui/kit.js";
import { formatUsdc } from "../ui/format.js";

/**
 * "Same transaction, two views" (D-41), props-only: the whole batch as the chain shows it. Coworker
 * view: every line, owner unknown. My view: the same list with the lines the viewing key matched.
 * Amounts come from the transaction's USDC Transfer logs, never from announcement metadata.
 */
export function BatchTable({ batch, myView, txUrl }: { batch: OwnedBatch; myView: boolean; txUrl?: string }) {
  const n = batch.lines.length;
  const others = n - batch.mineCount;
  return (
    <div className="stack-sm" data-testid="batch-views" data-view={myView ? "mine" : "coworker"}>
      <p className="muted" data-testid="batch-caption">
        {myView ? (
          <>
            <strong style={{ color: "var(--ink)" }}>
              {batch.mineCount} of {n} {n === 1 ? "line is" : "lines are"} yours
            </strong>{" "}
            ({formatUsdc(batch.mineTotal)} USDC). Only your viewing key finds them; the other {others}{" "}
            {others === 1 ? "line stays" : "lines stay"} anonymous to you too.
          </>
        ) : (
          <>
            This is everything anyone can see on-chain: {n} {n === 1 ? "payment" : "payments"} totalling {formatUsdc(batch.total)} USDC from{" "}
            <Addr address={batch.from} /> in one transaction, and nothing that says whose line is whose.
          </>
        )}
        {txUrl && (
          <>
            {" "}
            <a href={txUrl} target="_blank" rel="noreferrer">
              View on Basescan ↗
            </a>
          </>
        )}
      </p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th className="num">#</th>
              <th>Stealth address</th>
              <th className="num">Amount (USDC)</th>
              <th>Owner</th>
            </tr>
          </thead>
          <tbody>
            {batch.lines.map((l) => {
              const hit = myView && l.mine;
              return (
                <tr key={l.logIndex} data-mine={hit ? "true" : undefined} style={hit ? { background: "var(--accent-soft)" } : undefined}>
                  <td className="num muted">{l.index + 1}</td>
                  <td>
                    <Addr address={l.stealthAddress} />
                  </td>
                  <td className="num">{l.amount === null ? <span className="muted">no transfer</span> : formatUsdc(l.amount)}</td>
                  <td>{hit ? <span className="pill" style={{ background: "var(--accent)", color: "var(--surface)" }}>You</span> : <span className="muted">unknown</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {batch.unfunded > 0 && (
        <p className="hint">
          {batch.unfunded} announced {batch.unfunded === 1 ? "address got" : "addresses got"} no USDC in this transaction; shown without an amount.
        </p>
      )}
    </div>
  );
}

/** One pay-run transaction: loads its batch and holds the Coworker view / My view toggle. */
export function PayRunBatchPanel({ txHash }: { txHash: Hex }) {
  const svc = useServices();
  const batch = usePayRunBatch(txHash);
  const [myView, setMyView] = useState(false);
  const url = svc.mock ? undefined : explorerTxUrl(svc.settings.chainId, txHash);
  return (
    <div className="stack-sm">
      <div className="row" style={{ gap: 10, alignItems: "center" }}>
        <span className={myView ? "muted" : undefined} style={myView ? undefined : { fontWeight: 500 }}>
          Coworker view
        </span>
        <Toggle on={myView} onChange={setMyView} label="My view" />
        <span className={myView ? undefined : "muted"} style={myView ? { fontWeight: 500 } : undefined}>
          My view
        </span>
      </div>
      {batch.status === "loading" && <p className="muted">Reading the transaction's logs…</p>}
      {batch.status === "error" && <Alert variant="warning">Couldn't read this transaction: {batch.error}</Alert>}
      {batch.status === "ready" && <BatchTable batch={batch.value} myView={myView} {...(url ? { txUrl: url } : {})} />}
    </div>
  );
}

/** Payments: one row per transaction that paid you, each opening its two views. */
export function PayRuns() {
  const wallet = useWallet();
  const svc = useServices();
  const [open, setOpen] = useState<string | null>(null);
  const runs = payRunGroups(wallet.ledger);
  if (runs.length === 0) return null;
  return (
    <section className="stack-sm" data-testid="pay-runs">
      <div className="between" style={{ alignItems: "baseline" }}>
        <h2>Pay runs</h2>
        <span className="muted">What a coworker sees in the same transaction, next to what you see.</span>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Block</th>
              <th>From</th>
              <th className="num">Your lines</th>
              <th>Tx</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {runs.map((r) => {
              const isOpen = open === r.txHash;
              const url = svc.mock ? undefined : explorerTxUrl(svc.settings.chainId, r.txHash);
              return (
                <Fragment key={r.txHash}>
                  <tr className={isOpen ? "expanded" : undefined}>
                    <td className="num">{r.blockNumber.toString()}</td>
                    <td>{wallet.payerName(r.payer) ?? (r.payer ? <Addr address={r.payer} /> : <span className="muted">unknown</span>)}</td>
                    <td className="num">{r.mine.length}</td>
                    <td>
                      {url ? (
                        <a href={url} target="_blank" rel="noreferrer">
                          <Addr address={r.txHash} /> ↗
                        </a>
                      ) : (
                        <Addr address={r.txHash} />
                      )}
                    </td>
                    <td>
                      <span className="row" style={{ justifyContent: "flex-end" }}>
                        <button type="button" className="btn-text btn-inline" onClick={() => setOpen(isOpen ? null : r.txHash)}>
                          {isOpen ? "Hide" : "Two views"}
                        </button>
                      </span>
                    </td>
                  </tr>
                  {isOpen && (
                    <tr className="expanded">
                      <td colSpan={5}>
                        <PayRunBatchPanel txHash={r.txHash} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
