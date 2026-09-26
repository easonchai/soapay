import { useState } from "react";
import { Dots, Lockup, Reveal } from "@soapay/ui";
import type { WalletState } from "../hooks/usePayPath.js";

export const GITHUB = "https://github.com/easonchai/soapay";

export type LandingProps = {
  wallet: Pick<WalletState, "isConnected" | "connectors" | "connecting" | "connectError">;
  /** Called on Login: clears a previous logout, then (if needed) the user picks a wallet. */
  onLogin(): void;
};

/** CK's hero-only landing (Marketing 5a). Login connects a wallet; App then shows the vault gate. */
export function Landing({ wallet, onLogin }: LandingProps) {
  const [choosing, setChoosing] = useState(false);
  const one = wallet.connectors.length === 1 ? wallet.connectors[0] : undefined;

  function login() {
    onLogin();
    if (wallet.isConnected) return;
    if (one) one.connect();
    else setChoosing(true);
  }

  const cta = wallet.connecting ? "Connecting…" : wallet.connectors.length ? "Login with wallet" : "Install a wallet to continue";
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
        <button className="btn-primary" style={{ height: 36, padding: "0 16px" }} onClick={login} disabled={wallet.connecting || !wallet.connectors.length}>
          {wallet.connecting ? "Connecting…" : "Login"}
        </button>
      </div>
      <section className="land-hero">
        <Dots mode="diamond" animate className="dots l" />
        <Dots mode="diamond" animate className="dots r" />
        <Reveal delay={0.05}>
          <span className="eyebrow" style={{ fontSize: 13 }}>
            Privacy infrastructure for payments on chain
          </span>
        </Reveal>
        <Reveal delay={0.12} y={12}>
          <h1 className="land-h1">Every wallet address is a public bank statement.</h1>
        </Reveal>
        <Reveal delay={0.2}>
          <p className="land-sub">
            Soapay gives your team one name each. Every salary lands on a fresh address only they can open, and the payroll never shows up
            on a block explorer.
          </p>
        </Reveal>
        <Reveal delay={0.28} className="land-cta">
          <button className="btn-primary btn-xl" onClick={login} disabled={wallet.connecting || !wallet.connectors.length}>
            {cta}
          </button>
          <a className="btn btn-xl" href={`${GITHUB}/blob/main/PRD.md`} target="_blank" rel="noreferrer">
            Read the docs
          </a>
        </Reveal>
        {choosing && !wallet.isConnected && (
          <div className="panel panel-pad connectors" style={{ minWidth: 280 }} role="dialog" aria-label="Choose a wallet">
            <span className="eyebrow">Choose a wallet</span>
            {wallet.connectors.map((c) => (
              <button key={c.id} onClick={() => c.connect()} disabled={wallet.connecting}>
                {c.name}
              </button>
            ))}
          </div>
        )}
        <p className="hint">{wallet.connectError ?? "Your wallet is your login. Nothing to sign up for."}</p>
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
