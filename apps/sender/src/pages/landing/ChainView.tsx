import { useRef } from "react";
import { Dots } from "@soapay/ui";
import { ChainArt } from "./ChainArt.js";
import { useDrawIn, useRiseOnScroll } from "./motion.js";
import "./trust.css";

/** What a public payment record reveals, and the identity links it leaves out. */
export function ChainView() {
  const headRef = useRef<HTMLDivElement>(null);
  const colsRef = useRef<HTMLDivElement>(null);

  useRiseOnScroll(headRef, "[data-rise]");
  useDrawIn(colsRef, ".art-col");

  return (
    <section className="land-section chain" aria-labelledby="chain-title">
      <div className="land-wrap">
        <div className="land-head" ref={headRef}>
          <div className="text" data-rise>
            <span className="eyebrow">What the chain sees</span>
            <h2 id="chain-title" className="land-h2">
              Public, but meaningless to a coworker.
            </h2>
            <p className="land-body">
              Every payment leaves one public record. Here is what it gives away, and what it never can.
            </p>
          </div>
          <Dots mode="right" className="dots" animate />
        </div>

        <div className="art-cols chain-cols" ref={colsRef}>
          <div className="art-col">
            <span className="art-tag">The record</span>
            <ChainArt kind="record" />
            <h3 className="art-t">One record per payment</h3>
            <p className="art-d">An address, an amount and a one-time key. No name, ever.</p>
          </div>
          <div className="art-col">
            <span className="art-tag">Anyone can see</span>
            <ChainArt kind="seen" />
            <h3 className="art-t">Lines, amounts and the payer</h3>
            <p className="art-d">
              Every line and its amount, in address order, and your company as the sender.
            </p>
          </div>
          <div className="art-col">
            <span className="art-tag">No one can learn</span>
            <ChainArt kind="hidden" />
            <h3 className="art-t">Which address is whose</h3>
            <p className="art-d">
              No link between a name and a line, between one month and the next, or back to anyone's main wallet.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
