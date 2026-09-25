import { motion } from 'framer-motion';
import { COMPANY_APP, VIDEO } from '../links.js';
import { Reveal } from './Reveal.js';

export function Featured() {
  return (
    <section className="l-section tight-top">
      <div className="l-wrap">
        <Reveal y={60} duration={0.9}>
          <div className="l-frame">
            <video src={VIDEO.featured} muted autoPlay loop playsInline preload="auto" aria-hidden />
            <div className="shade" />
            <div className="overlay">
              <div className="l-glass-card liquid-glass">
                <p className="tag">How a pay run works</p>
                <p>
                  Paste names and amounts. Soapay derives a brand-new stealth wallet for each employee, pays them all in
                  one transaction, and announces each one so only the right person can find it.
                </p>
              </div>
              <motion.a
                className="l-pill liquid-glass"
                href={COMPANY_APP}
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
              >
                Try a pay run
              </motion.a>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
