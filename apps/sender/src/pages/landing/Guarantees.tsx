import { useRef } from "react";
import { CountUp, InView, useVisible } from "@soapay/ui";
import "./trust.css";

const ITEMS = [
  {
    title: "Fresh address, every time",
    body: "Same name every month, new address every run; nothing ties runs together.",
  },
  {
    title: "No custody, one contract",
    body: "StealthDisperse pulls USDC and announces each line in one transaction. It holds no funds, keeps no state.",
  },
  {
    title: "Keys and roster stay in your browser",
    body: "Spending keys never leave the device; roster and history are encrypted locally, never sent to a server.",
  },
] as const;

const FACTS: readonly { value: number | string; label: string }[] = [
  { value: 350, label: "lines per transaction" },
  { value: 1, label: "signature per run" },
  { value: 0, label: "funds held by Soapay" },
  { value: "USDC", label: "on Base" },
];

const whole = (n: number) => String(Math.round(n));

/** Landing · three guarantees and a facts strip. Numbers count up the first time the strip scrolls into view. */
export function Guarantees() {
  const stripRef = useRef<HTMLDivElement>(null);
  const visible = useVisible(stripRef, 0.5);
  return (
    <section className="land-section guar" aria-label="Guarantees">
      <div className="land-wrap">
        <div className="guar-grid">
          {ITEMS.map((it, i) => (
            <InView key={it.title} className="guar-item" delay={i * 0.1} y={10}>
              <span className="guar-sq" aria-hidden />
              <h3 className="guar-title">{it.title}</h3>
              <p className="guar-body">{it.body}</p>
            </InView>
          ))}
        </div>
        <div className="guar-facts" ref={stripRef}>
          {FACTS.map((f) => (
            <div className="guar-cell" key={f.label}>
              <span className="figure">
                {typeof f.value === "number" ? <CountUp value={visible ? f.value : 0} format={whole} duration={1.4} /> : f.value}
              </span>
              <span className="guar-label">{f.label}</span>
            </div>
          ))}
        </div>
        <p className="guar-note">Compliant exit via Privacy Pools is on testnet; gateway mode is on the roadmap.</p>
      </div>
    </section>
  );
}
