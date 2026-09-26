import { FreshMark } from "@soapay/ui";
import type { RunOnChain } from "../hooks/useRunOnChain.js";
import { short, usdc } from "../ui/kit.js";

const COLS = "40px 1.4fr 1fr 1.2fr";

/**
 * "What coworkers see" (D-41), props-only: every line of the run's landed transactions exactly as the
 * chain shows it (address and amount from the Transfer logs), with the employer's own names beside it.
 * Before anything lands, the planned lines are shown as a clearly labelled preview.
 */
export function CoworkerViewPanel({ onChain, txUrl }: { onChain: RunOnChain; txUrl(hash: string): string }) {
  const { rows, planned, landed, loading, error } = onChain;
  const preview = landed === 0;
  const txs = [...new Set(rows.map((r) => r.txHash))];
  return (
    <div className="stack-sm" style={{ gap: 12 }} data-testid="coworker-view">
      <div className="between" style={{ alignItems: "baseline", flexWrap: "wrap" }}>
        <span style={{ fontWeight: 500 }}>What coworkers see</span>
        <span className="ink2">
          {preview
            ? "Nothing on-chain yet. Once sent: these addresses and amounts, sorted by address, no names."
            : `Read from ${landed} transaction${landed === 1 ? "" : "s"} on-chain: addresses and amounts. Names appear only on your screen.`}
          {txs.map((h) => (
            <span key={h}>
              {" "}
              <a href={txUrl(h)} target="_blank" rel="noreferrer">
                {short(h, 4)} on Basescan ↗
              </a>
            </span>
          ))}
        </span>
      </div>
      {error && <span className="hint">Couldn't read the transaction: {error}</span>}
      {loading && <span className="hint">Reading logs…</span>}
      <div className="table">
        <div className="thead" style={{ gridTemplateColumns: COLS }}>
          <span className="r">#</span>
          <span style={{ paddingLeft: 16 }}>{preview ? "Will appear as" : "On-chain line"}</span>
          <span className="r">Amount (USDC)</span>
          <span style={{ paddingLeft: 16 }}>Only you see</span>
        </div>
        {(preview ? planned.map((p, i) => ({ ...p, line: i + 1, key: `${p.stealthAddress}-${i}` })) : rows.map((r) => ({ ...r, key: `${r.txHash}-${r.line}` }))).map(
          (r) => (
            <div key={r.key} className="tr" style={{ gridTemplateColumns: COLS }}>
              <span className="r idx">{r.line}</span>
              <span className="mono" style={{ paddingLeft: 16, display: "inline-flex", alignItems: "center", gap: 6 }}>
                <FreshMark />
                {short(r.stealthAddress)}
              </span>
              <span className="r num">{r.amount === null ? <span className="ink3">no transfer</span> : usdc(r.amount)}</span>
              <span style={{ paddingLeft: 16 }}>{r.name ?? <span className="ink3">not in this record</span>}</span>
            </div>
          ),
        )}
        {!loading && (preview ? planned.length === 0 : rows.length === 0) && (
          <div className="tr empty-row" style={{ gridTemplateColumns: "1fr" }}>
            <span>No lines.</span>
          </div>
        )}
      </div>
    </div>
  );
}
