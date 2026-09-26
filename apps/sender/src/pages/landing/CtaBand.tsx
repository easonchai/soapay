import { useRef } from "react";
import { Dots } from "@soapay/ui";
import { useRiseOnScroll } from "./motion.js";
import "./trust.css";

export type CtaBandProps = {
  onLogin: () => void;
  disabled: boolean;
  label: string;
  employeeUrl: string;
};

/** Landing · closing navy band. The footer stays in Landing. */
export function CtaBand({ onLogin, disabled, label, employeeUrl }: CtaBandProps) {
  const root = useRef<HTMLElement>(null);
  useRiseOnScroll(root, "[data-rise]", { y: 10 });
  return (
    <section className="land-section cta-band" aria-labelledby="cta-title" ref={root}>
      <Dots mode="right" animate color="255,255,255" className="cta-dots" />
      <div className="land-wrap">
        <div className="cta-body" data-rise>
          <h2 id="cta-title" className="cta-h2">
            Paying a team? Paste names, sign once.
          </h2>
          <p className="cta-sub">Works with your Safe.</p>
          <div className="cta-actions">
            <button type="button" className="btn btn-xl cta-btn" disabled={disabled} onClick={onLogin} data-testid="cta-login">
              {label}
            </button>
            <a className="cta-link" href={employeeUrl}>
              Getting paid? Open your payments
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}
