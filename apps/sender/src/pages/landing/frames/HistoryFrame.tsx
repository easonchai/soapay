import { NavyPanel, Pill, Stagger, StaggerItem } from "@soapay/ui";
import { HISTORY_STATS, RUNS } from "../sample.js";

const COLS = "110px 1.4fr 70px 1fr 1fr";

/** Static picture of History: three figures, then every run with its label, total and transaction. */
export function HistoryFrame() {
  return (
    <div className="show-main">
      <div className="pagehead">
        <div className="text">
          <span className="eyebrow">History · {HISTORY_STATS.runs} runs since Oct 2025</span>
          <h1>Every run this wallet has signed</h1>
          <p className="lead">Your audit trail. Names, amounts and the fresh addresses each run created. Encrypted in this browser.</p>
        </div>
        <div className="actions">
          <span className="btn">Export CSV</span>
        </div>
      </div>

      <div className="show-stats">
        <NavyPanel className="stat" dots={false}>
          <span className="k">Paid</span>
          <span className="v">
            {HISTORY_STATS.paid} <span className="unit">USDC</span>
          </span>
        </NavyPanel>
        <div className="stat">
          <span className="k">Fresh addresses</span>
          <span className="v">{HISTORY_STATS.fresh}</span>
        </div>
        <div className="stat">
          <span className="k">Runs</span>
          <span className="v">{HISTORY_STATS.runs}</span>
        </div>
      </div>

      <div className="table">
        <div className="thead" style={{ gridTemplateColumns: COLS }}>
          <span>Date</span>
          <span>Run</span>
          <span className="r">Lines</span>
          <span className="r">Total</span>
          <span className="r">Transaction</span>
        </div>
        <Stagger>
          {RUNS.map((r, i) => (
            <StaggerItem key={r.label} index={i} className="tr tall" style={{ gridTemplateColumns: COLS, display: "grid" }}>
              <span className="ink2">{r.date}</span>
              <span style={{ fontWeight: 500, display: "flex", gap: 8, alignItems: "center" }}>
                {r.label}
                <Pill tone={r.status === "Sent" ? "ok" : "muted"}>{r.status}</Pill>
              </span>
              <span className="r mono">{r.lines}</span>
              <span className="r num">
                {r.total} <span className="ink2">USDC</span>
              </span>
              <span className="r mono" style={{ display: "flex", justifyContent: "flex-end" }}>
                {r.tx ? <span className="chip">{r.tx} ↗</span> : <span className="ink3">none</span>}
              </span>
            </StaggerItem>
          ))}
        </Stagger>
      </div>
    </div>
  );
}
