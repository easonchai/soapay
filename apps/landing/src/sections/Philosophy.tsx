import { VIDEO } from '../links.js';
import { Reveal } from './Reveal.js';

export function Philosophy() {
  return (
    <section className="l-section" id="companies">
      <div className="l-wrap">
        <Reveal y={40} duration={0.8}>
          <h2 className="l-h3">
            Company <em>×</em> Employee
          </h2>
        </Reveal>
        <div className="l-grid-2">
          <Reveal x={-40} y={0} duration={0.8}>
            <div className="l-frame-43">
              <video src={VIDEO.philosophy} muted autoPlay loop playsInline preload="auto" aria-hidden />
            </div>
          </Reveal>
          <Reveal x={40} y={0} duration={0.8} className="l-blocks">
            <div className="l-block">
              <p className="tag">For the company</p>
              <p>
                You keep a normal payroll list. Every run creates fresh wallets, one per person, sorted so the on-chain
                order says nothing about who is who. Your dashboard tracks each employee&apos;s wallets and what is still
                sitting in them.
              </p>
            </div>
            <div className="l-divider" />
            <div className="l-block" id="employees">
              <p className="tag">For the employee</p>
              <p>
                Share one address, once. Sign one message to see every payment you have ever received, and spend from
                each wallet without ever touching your main account.
              </p>
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}
