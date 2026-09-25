import { AtSign, BookOpen, GitBranch } from 'lucide-react';
import { COMPANY_APP, GITHUB } from '../links.js';
import { Nav } from './Nav.js';

export function Hero() {
  return (
    <section className="l-hero">
      <Nav />
      <div className="l-hero-body">
        <h1 className="l-h1">
          One name, <em>infinite</em> addresses.
        </h1>
        <p className="l-sub">
          Pay your team on-chain without publishing the payroll. Every payment lands on a fresh address that only the
          employee can open.
        </p>
        <div className="l-cta">
          <a className="l-pill l-pill-white" href={COMPANY_APP}>
            Open company app
          </a>
          <a className="l-pill liquid-glass" href="#how">
            How it works
          </a>
        </div>
      </div>
      <div className="l-social">
        <a className="liquid-glass" href={GITHUB} target="_blank" rel="noreferrer" aria-label="GitHub">
          <GitBranch size={20} />
        </a>
        <a className="liquid-glass" href="https://x.com" target="_blank" rel="noreferrer" aria-label="X">
          <AtSign size={20} />
        </a>
        <a className="liquid-glass" href={`${GITHUB}/blob/main/PRD.md`} target="_blank" rel="noreferrer" aria-label="Product spec">
          <BookOpen size={20} />
        </a>
      </div>
    </section>
  );
}
