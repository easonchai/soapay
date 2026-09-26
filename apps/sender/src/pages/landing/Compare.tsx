import { useRef } from "react";
import { Dots } from "@soapay/ui";
import { CompareArt } from "./CompareArt.js";
import { useDrawIn, useRiseOnScroll } from "./motion.js";
import "./compare.css";

/** The same payroll shown with and without private recipient links. */
export function Compare() {
  const headRef = useRef<HTMLDivElement>(null);
  const colsRef = useRef<HTMLDivElement>(null);

  useRiseOnScroll(headRef, "[data-rise]");
  useDrawIn(colsRef, ".art-col");

  return (
    <section className="land-section cmp" aria-labelledby="cmp-h2">
      <div className="land-wrap">
        <div className="land-head" ref={headRef}>
          <div className="text" data-rise>
            <span className="eyebrow">The same payroll, twice</span>
            <h2 className="land-h2" id="cmp-h2">
              One batch. Two ways to read it.
            </h2>
            <p className="land-body">What a block explorer shows, before and after.</p>
          </div>
          <Dots mode="field" animate className="dots" />
        </div>

        <div className="art-cols cmp-cols" ref={colsRef}>
          <div className="art-col">
            <span className="art-tag muted">Without Soapay</span>
            <CompareArt kind="without" />
            <h3 className="art-t">Names and salaries, readable by anyone</h3>
            <p className="art-d">
              The same wallet every month. Whoever knows one address can follow the salary behind it.
            </p>
          </div>
          <div className="art-col">
            <span className="art-tag">With Soapay</span>
            <CompareArt kind="with" />
            <h3 className="art-t">Fresh addresses, equal amounts, no names</h3>
            <p className="art-d">
              Every line is a brand-new address for the same amount. Only the recipient knows which lines are theirs.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
