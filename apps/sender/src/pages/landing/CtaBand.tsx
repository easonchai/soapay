import { Dots, InView } from "@soapay/ui";
import "./trust.css";

export type CtaBandProps = {
  onLogin: () => void;
  disabled: boolean;
  label: string;
  employeeUrl: string;
};

/** Landing · closing navy band. The footer stays in Landing. */
export function CtaBand({ onLogin, disabled, label, employeeUrl }: CtaBandProps) {
  return (
    <section className="land-section cta-band" aria-labelledby="cta-title">
      <Dots mode="right" animate color="255,255,255" className="cta-dots" />
      <div className="land-wrap">
        <InView className="cta-body" y={10}>
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
        </InView>
      </div>
    </section>
  );
}
