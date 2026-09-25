import { ArrowUpRight } from 'lucide-react';
import { COMPANY_APP, EMPLOYEE_APP, VIDEO } from '../links.js';
import { Reveal } from './Reveal.js';

const CARDS = [
  {
    href: COMPANY_APP,
    video: VIDEO.card1,
    tag: 'Company',
    title: 'Pay your team',
    body: 'Resolve names, derive a fresh wallet per person, pay and announce in one batch. One signature when your wallet supports atomic batches.',
  },
  {
    href: EMPLOYEE_APP,
    video: VIDEO.card2,
    tag: 'Employee',
    title: 'Get paid privately',
    body: 'One name, one signature. Every wallet you were paid into, listed with its live balance and the key to spend it.',
  },
];

export function Cards() {
  return (
    <section className="l-section">
      <div className="l-radial-center" />
      <div className="l-wrap">
        <Reveal y={30} duration={0.7}>
          <div className="l-head-row">
            <h2 className="l-h4">What it does</h2>
            <span className="right">Two apps, one protocol</span>
          </div>
        </Reveal>
        <div className="l-cards">
          {CARDS.map((c, i) => (
            <Reveal key={c.title} y={50} duration={0.8} delay={i * 0.15}>
              <a className="l-card liquid-glass" href={c.href}>
                <div className="media">
                  <video src={c.video} muted autoPlay loop playsInline preload="auto" aria-hidden />
                  <div className="shade" />
                </div>
                <div className="body">
                  <div className="top">
                    <span className="tag">{c.tag}</span>
                    <span className="icon liquid-glass">
                      <ArrowUpRight size={16} />
                    </span>
                  </div>
                  <h3>{c.title}</h3>
                  <p>{c.body}</p>
                </div>
              </a>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
