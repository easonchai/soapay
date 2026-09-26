import { NavyPanel, Pill, Stagger, StaggerItem, Toggle } from "@soapay/ui";
import { ROSTER, RUN } from "../sample.js";

const COLS = "32px 1.5fr 1fr 60px 1fr";

/** Static picture of the Pay run page: roster table left, denomination + run total right. */
export function PayRunFrame() {
  return (
    <div className="show-main">
      <div className="pagehead">
        <div className="text">
          <span className="eyebrow">Pay run · draft · {RUN.salaries} recipients</span>
          <h1>Pay run</h1>
          <p className="lead">Nothing is sent until you sign.</p>
        </div>
        <div className="actions">
          <span className="btn">Recipients</span>
          <span className="btn">Paste rows</span>
        </div>
      </div>

      <div className="grid-2">
        <div className="stack">
          <div className="table">
            <div className="thead" style={{ gridTemplateColumns: COLS }}>
              <span>#</span>
              <span>Name</span>
              <span className="r">Amount</span>
              <span className="r">Token</span>
              <span className="r">Resolution</span>
            </div>
            <Stagger>
              {ROSTER.map((r, i) => (
                <StaggerItem key={r.name} index={i} className="tr" style={{ gridTemplateColumns: COLS, display: "grid" }}>
                  <span className="idx">{i + 1}</span>
                  <span className="mono" style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                    <span>{r.name}</span>
                    <span className="ink3" style={{ fontSize: 11 }}>
                      {r.label}
                    </span>
                  </span>
                  <span className="r num">{r.amount}</span>
                  <span className="r ink2">USDC</span>
                  <span style={{ display: "flex", justifyContent: "flex-end" }}>
                    <Pill tone={r.status === "Verified" ? "ok" : "muted"}>{r.status}</Pill>
                  </span>
                </StaggerItem>
              ))}
            </Stagger>
          </div>
          <div className="between">
            <span className="ink2">
              {RUN.salaries} names resolved · {RUN.lines} lines of {RUN.chunk} USDC
            </span>
            <span className="btn">Resolve again</span>
          </div>
        </div>

        <div className="stack">
          <div className="panel panel-pad stack-sm">
            <div className="between">
              <span style={{ fontWeight: 500 }}>Denominate in {RUN.chunk} USDC chunks</span>
              <Toggle on onChange={() => {}} label={`Denominate in ${RUN.chunk} USDC chunks`} />
            </div>
            <p className="ink2 pretty">One chunk size company-wide, so amounts identify nobody.</p>
          </div>
          <NavyPanel>
            <span className="label">This run</span>
            <span className="amount">
              {RUN.total}
              <span className="unit">USDC</span>
            </span>
            <div className="rows rule">
              <div>
                <span className="k">Lines</span>
                <span>
                  {RUN.salaries} salaries → {RUN.lines} lines
                </span>
              </div>
              <div>
                <span className="k">Fresh addresses</span>
                <span>{RUN.fresh}</span>
              </div>
              <div>
                <span className="k">Transactions</span>
                <span>{RUN.txs}</span>
              </div>
            </div>
          </NavyPanel>
          <span className="btn btn-primary btn-lg">Review {RUN.lines} lines</span>
          <p className="hint">Resolve re-reads the chain; changed records need re-approval.</p>
        </div>
      </div>
    </div>
  );
}
