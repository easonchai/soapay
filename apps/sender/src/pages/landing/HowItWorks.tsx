import { useRef } from "react";
import { Dots } from "@soapay/ui";
import { StepArt } from "./StepArt.js";
import { useDrawIn } from "./motion.js";
import "./how.css";

const STEPS = [
  {
    title: "One name per person",
    body: "Someone on your team claims alice.soapay.eth once. It publishes a key, not a wallet.",
  },
  {
    title: "A new address per payment",
    body: "From that key, Soapay makes a brand-new address for each payment. No two can be linked.",
  },
  {
    title: "Only its owner can open it",
    body: "Alice's key finds her payments and spends them. To everyone else they are just addresses.",
  },
] as const;

function StepArrow() {
  return (
    <svg className="art-arrow" viewBox="0 0 20 8" aria-hidden="true">
      <path d="M0 4h18M14 1l4 3-4 3" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Plain-language sequence from one public name to privately owned payments. */
export function HowItWorks() {
  const gridRef = useRef<HTMLDivElement>(null);

  useDrawIn(gridRef, ".art-col");

  return (
    <section className="land-section how" id="how" aria-labelledby="how-title">
      <div className="land-wrap">
        <div className="land-head">
          <div className="text">
            <span className="eyebrow">How it works</span>
            <h2 className="land-h2" id="how-title">
              A <span className="how-accent">fresh address</span> for every payment.
            </h2>
            <p className="land-body">That is the whole trick. The app is just where you run it.</p>
          </div>
          <Dots mode="right" className="dots" animate />
        </div>

        <div className="art-cols" ref={gridRef}>
          {STEPS.map((step, index) => (
            <div className="art-col" key={step.title}>
              <span className="art-tag">{String(index + 1).padStart(2, "0")}</span>
              {index < STEPS.length - 1 && <StepArrow />}
              <StepArt step={(index + 1) as 1 | 2 | 3} />
              <h3 className="art-t">{step.title}</h3>
              <p className="art-d">{step.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
