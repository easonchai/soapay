import { AtSign, BookOpen, Droplets, GitBranch } from 'lucide-react';
import { useAccount, useConnect } from 'wagmi';
import { GITHUB } from './config.js';

/** Hero-only landing. "Login" connects the wallet; App switches to the dashboard once connected. */
export function Landing({ connected, onLogin }: { connected: boolean; onLogin: () => void }) {
  const { connect, connectors, isPending, error } = useConnect();
  const { isConnecting } = useAccount();
  const connector = connectors[0];
  const busy = isPending || isConnecting;

  function login() {
    onLogin();
    if (!connected && connector) connect({ connector });
  }

  return (
    <section className="l-hero">
      <div className="l-nav-wrap">
        <nav className="l-nav liquid-glass" aria-label="Main">
          <div className="l-nav-left">
            <Droplets size={22} color="#fff" aria-hidden />
            <span className="wordmark">Soapay</span>
            <div className="l-nav-links">
              <a href={`${GITHUB}/blob/main/PRD.md`} target="_blank" rel="noreferrer">
                How it works
              </a>
              <a href={GITHUB} target="_blank" rel="noreferrer">
                GitHub
              </a>
            </div>
          </div>
          <div className="l-nav-right">
            <button className="l-pill liquid-glass" onClick={login} disabled={busy || !connector}>
              {busy ? 'Connecting…' : 'Login'}
            </button>
          </div>
        </nav>
      </div>

      <div className="l-hero-body">
        <h1 className="l-h1">
          One name, <em>infinite</em> addresses.
        </h1>
        <p className="l-sub">
          Pay your team on-chain without publishing the payroll. Every payment lands on a fresh address that only the
          employee can open.
        </p>
        <div className="l-cta">
          <button className="l-pill l-pill-white" onClick={login} disabled={busy || !connector}>
            {busy ? 'Connecting…' : connector ? 'Login with wallet' : 'Install a wallet to continue'}
          </button>
          <a className="l-pill liquid-glass" href={GITHUB} target="_blank" rel="noreferrer">
            View on GitHub
          </a>
        </div>
        {error && <p className="l-hint">{error.message.split('\n')[0]}</p>}
        {!error && <p className="l-hint">Your wallet is your login. Nothing to sign up for.</p>}
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
