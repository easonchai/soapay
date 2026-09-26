import { useRef } from "react";
import { FreshMark, NavyPanel, Steps } from "@soapay/ui";
import { PREVIEW_LINES, RUN } from "../sample.js";
import { useRiseIn } from "../motion.js";

const COLS = "32px 1fr 1fr";

/** Static picture of the Review step: the batch summary left, the first few lines right, one signature. */
export function ReviewFrame() {
  const frameRef = useRef<HTMLDivElement>(null);

  useRiseIn(frameRef, "[data-rise]", { duration: 0.4, stagger: 0.04, y: 8 });

  return (
    <div className="show-main" ref={frameRef}>
      <Steps current={1} labels={["Approve USDC", "Sign", "Sent"]} />
      <div className="show-split">
        <div className="stack-lg">
          <span className="eyebrow">Review · {RUN.label}</span>
          <h1>
            {RUN.total} USDC to {RUN.salaries} people.
          </h1>
          <p className="ink2 pretty">
            One transaction, {RUN.fresh} fresh addresses. On chain: {RUN.lines} payments of {RUN.chunk} USDC to {RUN.lines} strangers.
          </p>
          <NavyPanel dots={false}>
            <span className="label">Total</span>
            <span className="amount">
              {RUN.total}
              <span className="unit">USDC</span>
            </span>
            <div className="rows rule">
              <div>
                <span className="k">Lines</span>
                <span>
                  {RUN.lines} transfers · {RUN.lines} announcements
                </span>
              </div>
              <div>
                <span className="k">Order</span>
                <span>Sorted by address, never by person</span>
              </div>
              <div>
                <span className="k">Gas</span>
                <span>≈ {RUN.gasEth} ETH</span>
              </div>
            </div>
          </NavyPanel>
          <div className="actions">
            <span className="btn btn-primary btn-lg" style={{ flex: 1 }}>
              Sign and pay
            </span>
            <span className="btn btn-lg">Export to Safe</span>
          </div>
        </div>

        <div className="stack-sm" style={{ gap: 12 }}>
          <div className="between" style={{ alignItems: "baseline" }}>
            <span style={{ fontWeight: 500 }}>What goes on chain</span>
            <span className="ink2">First {PREVIEW_LINES.length} of {RUN.lines} lines</span>
          </div>
          <div className="table">
            <div className="thead" style={{ gridTemplateColumns: COLS }}>
              <span>#</span>
              <span>Fresh address</span>
              <span className="r">Amount</span>
            </div>
            <div>
              {PREVIEW_LINES.map((l, i) => (
                <div key={l.address} className="tr mono" style={{ gridTemplateColumns: COLS, display: "grid" }} data-rise>
                  <span className="idx">{i + 1}</span>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                    <FreshMark />
                    {l.address}
                  </span>
                  <span className="r num">{l.amount}</span>
                </div>
              ))}
            </div>
            <div className="foot">
              <span>Every payee is a pinned, verified ENS name.</span>
              <span>…and {RUN.lines - PREVIEW_LINES.length} more</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
