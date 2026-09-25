import { Reveal } from './Reveal.js';

export function About() {
  return (
    <section className="l-section" id="how" style={{ paddingBottom: 40 }}>
      <div className="l-radial-top" />
      <div className="l-wrap">
        <Reveal y={20} duration={0.6}>
          <p className="l-label">Why Soapay</p>
        </Reveal>
        <Reveal y={40} duration={0.8} delay={0.1}>
          <h2 className="l-h2">
            Every address on Ethereum is a <em>public bank statement</em>.
            <br />
            Soapay gives each employee one name and lands every salary on an address <em>nobody else can link</em>.
          </h2>
        </Reveal>
      </div>
    </section>
  );
}
