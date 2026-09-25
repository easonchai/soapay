import { useConnect } from 'wagmi';
import { Dots, Lockup } from '@soapay/ui';
import { GITHUB } from './config.js';

/** Hero-only landing (Marketing 5a). Login connects the wallet; App switches to the dashboard. */
export function Landing({ connected, onLogin }: { connected: boolean; onLogin: () => void }) {
  const { connect, connectors, isPending, error } = useConnect();
  const connector = connectors[0];

  function login() {
    onLogin();
    if (!connected && connector) connect({ connector });
  }

  return (
    <div className="land">
      <div className="land-bar">
        <div className="brand">
          <Lockup height={22} />
        </div>
        <div className="links">
          <a href={`${GITHUB}/blob/main/PRD.md`} target="_blank" rel="noreferrer">
            How it works
          </a>
          <a href={GITHUB} target="_blank" rel="noreferrer">
            GitHub
          </a>
        </div>
        <button className="btn-primary" style={{ height: 36, padding: '0 16px' }} onClick={login} disabled={isPending || !connector}>
          {isPending ? 'Connecting…' : 'Login'}
        </button>
      </div>
      <section className="land-hero">
        <Dots mode="diamond" className="dots l" />
        <Dots mode="diamond" className="dots r" />
        <span className="eyebrow" style={{ fontSize: 13 }}>
          Privacy infrastructure for payments on chain
        </span>
        <h1 className="land-h1">Every wallet address is a public bank statement.</h1>
        <p className="land-sub">
          Soapay gives your team one name each. Every salary lands on a fresh address only they can open, and the payroll
          never shows up on a block explorer.
        </p>
        <div className="land-cta">
          <button className="btn-primary btn-xl" onClick={login} disabled={isPending || !connector}>
            {isPending ? 'Connecting…' : connector ? 'Login with wallet' : 'Install a wallet to continue'}
          </button>
          <a className="btn btn-xl" href={`${GITHUB}/blob/main/PRD.md`} target="_blank" rel="noreferrer">
            Read the docs
          </a>
        </div>
        <p className="hint">{error ? error.message.split('\n')[0] : 'Your wallet is your login. Nothing to sign up for.'}</p>
      </section>
      <div className="land-foot">
        <span>© 2026 Soapay</span>
        <div className="links">
          <a href={`${GITHUB}/blob/main/PRD.md`} target="_blank" rel="noreferrer">
            Docs
          </a>
          <a href={GITHUB} target="_blank" rel="noreferrer">
            GitHub
          </a>
        </div>
      </div>
    </div>
  );
}
