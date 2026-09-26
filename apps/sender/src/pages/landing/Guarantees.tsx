import { useRef } from "react";
import { useVisible } from "@soapay/ui";
import { useCountUp, useRiseOnScroll } from "./motion.js";
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

/** A numeric fact: the figure counts up (GSAP) the first time the strip is on screen. */
function NumberFact({ value, label, active }: { value: number; label: string; active: boolean }) {
  const figure = useRef<HTMLSpanElement>(null);
  useCountUp(figure, value, whole, { duration: 1.4, active });
  return (
    <div className="guar-cell">
      <span className="figure" ref={figure}>
        {whole(0)}
      </span>
      <span className="guar-label">{label}</span>
    </div>
  );
}

/** Landing · three guarantees and a facts strip. Items rise in on scroll; numbers count up once the strip is visible. */
export function Guarantees() {
  const root = useRef<HTMLElement>(null);
  const stripRef = useRef<HTMLDivElement>(null);
  const visible = useVisible(stripRef, 0.5);
  useRiseOnScroll(root, "[data-rise]", { y: 10, stagger: 0.1 });
  return (
    <section className="land-section guar" aria-label="Guarantees" ref={root}>
      <div className="land-wrap">
        <div className="guar-grid">
          {ITEMS.map((it) => (
            <div key={it.title} className="guar-item" data-rise>
              <span className="guar-sq" aria-hidden />
              <h3 className="guar-title">{it.title}</h3>
              <p className="guar-body">{it.body}</p>
            </div>
          ))}
        </div>
        <div className="guar-facts" ref={stripRef}>
          {FACTS.map((f) =>
            typeof f.value === "number" ? (
              <NumberFact key={f.label} value={f.value} label={f.label} active={visible} />
            ) : (
              <div className="guar-cell" key={f.label}>
                <span className="figure">{f.value}</span>
                <span className="guar-label">{f.label}</span>
              </div>
            ),
          )}
        </div>
        <p className="guar-note">Compliant exit via Privacy Pools is on testnet; gateway mode is on the roadmap.</p>
      </div>
    </section>
  );
}
