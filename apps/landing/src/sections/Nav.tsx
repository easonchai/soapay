import { Droplets } from 'lucide-react';
import { COMPANY_APP, GITHUB } from '../links.js';

export function Nav() {
  return (
    <div className="l-nav-wrap">
      <nav className="l-nav liquid-glass" aria-label="Main">
        <div className="l-nav-left">
          <Droplets size={22} color="#fff" aria-hidden />
          <span className="wordmark">Soapay</span>
          <div className="l-nav-links">
            <a href="#how">How it works</a>
            <a href="#companies">Companies</a>
            <a href="#employees">Employees</a>
          </div>
        </div>
        <div className="l-nav-right">
          <a className="text" href={GITHUB} target="_blank" rel="noreferrer">
            GitHub
          </a>
          <a className="l-pill liquid-glass" href={COMPANY_APP}>
            Open company app
          </a>
        </div>
      </nav>
    </div>
  );
}
