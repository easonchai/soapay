import { useEffect, useRef, useState } from "react";
import { CoinbaseMark, DotWord, Dots, GitHubMark, Lockup, Reveal, WalletGlyph } from "@soapay/ui";
import "../landing.css";
import { Compare } from "./landing/Compare.js";
import { HowItWorks } from "./landing/HowItWorks.js";
import { Showcase } from "./landing/Showcase.js";
import { ChainView } from "./landing/ChainView.js";
import { Guarantees } from "./landing/Guarantees.js";
import { CtaBand } from "./landing/CtaBand.js";
import type { WalletState } from "../hooks/usePayPath.js";

export const GITHUB = "https://github.com/easonchai/soapay";

type Conn = { id: string; name: string; icon?: string | undefined };
const isGeneric = (c: Conn) => /^injected$/i.test(c.id) || /^injected$/i.test(c.name);
const isCoinbase = (c: Conn) => /coinbase/i.test(c.id) || /coinbase/i.test(c.name);
/** Named wallets first, the generic browser provider last. */
function orderConnectors<T extends Conn>(list: T[]): T[] {
  return [...list].sort((a, b) => Number(isGeneric(a)) - Number(isGeneric(b)));
}
function walletLabel(c: Conn): string {
  return isGeneric(c) ? "Browser wallet" : c.name;
}
function walletIcon(c: Conn) {
  if (c.icon) return <img className="wallet-icon" src={c.icon} alt="" />;
  if (isCoinbase(c)) return <CoinbaseMark size={18} style={{ opacity: 0.85 }} />;
  return <WalletGlyph size={18} style={{ opacity: 0.8 }} />;
}

export type LandingProps = {
  wallet: Pick<WalletState, "isConnected" | "connectors" | "connecting" | "connectError">;
  /** Called on Login: clears a previous logout, then (if needed) the user picks a wallet. */
  onLogin(): void;
  /** The employee app, for people who were invited (or already have an account). */
  employeeUrl: string;
};

type SectionId = "how" | "product" | "chain";

/** Marketing landing (5a + 5b + trust): hero, before/after, how it works, product, what the chain sees, guarantees, CTA. Login connects a wallet; App then shows the vault gate. */
export function Landing({ wallet, onLogin, employeeUrl }: LandingProps) {
  const [choosing, setChoosing] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const hero = useRef<HTMLElement>(null);
  const sections = useRef<Record<SectionId, HTMLElement | null>>({ how: null, product: null, chain: null });
  const one = wallet.connectors.length === 1 ? wallet.connectors[0] : undefined;

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 40);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  function login() {
    onLogin();
    if (wallet.isConnected) return;
    if (one) one.connect();
    else setChoosing(true);
  }
  /** Login from further down the page: the wallet chooser lives in the hero, so bring it into view. */
  function loginFromBand() {
    login();
    if (!wallet.isConnected && !one) hero.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  /** Smooth-scroll to a section without touching the hash (the app's hash router would read it after login). */
  function jump(id: SectionId) {
    return (e: React.MouseEvent) => {
      e.preventDefault();
      sections.current[id]?.scrollIntoView({ behavior: "smooth", block: "start" });
    };
  }
  function top(e: React.MouseEvent) {
    e.preventDefault();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  const bind = (id: SectionId) => (el: HTMLDivElement | null) => {
    sections.current[id] = el;
  };

  const cta = wallet.connecting ? "Connecting…" : wallet.connectors.length ? "Login with wallet" : "Install a wallet to continue";
  return (
    <div className="land">
      <div className={`land-bar${scrolled ? " scrolled" : ""}`}>
        <Reveal y={-10} className="island-in">
          <nav className="island" aria-label="Site">
            <div className="links">
              <a href="#how" onClick={jump("how")}>
                How it works
              </a>
              <a href="#product" onClick={jump("product")}>
                Product
              </a>
            </div>
            <a href="#top" className="brand" aria-label="Soapay, back to top" onClick={top}>
              <Lockup height={20} />
            </a>
            <div className="links">
              <a href="#chain" onClick={jump("chain")}>
                What the chain sees
              </a>
              <a href={GITHUB} target="_blank" rel="noreferrer" className="link-with-mark">
                <GitHubMark size={14} />
                GitHub
              </a>
            </div>
            <button className="btn-primary island-login" onClick={login} disabled={wallet.connecting || !wallet.connectors.length}>
              {wallet.connecting ? "Connecting…" : "Login"}
            </button>
          </nav>
        </Reveal>
      </div>
      <section className="land-hero" ref={hero}>
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
            One name per person; every salary lands on a fresh address only they can open.
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
            {orderConnectors(wallet.connectors).map((c) => (
              <button key={c.id} onClick={() => c.connect()} disabled={wallet.connecting}>
                {walletIcon(c)}
                {walletLabel(c)}
              </button>
            ))}
          </div>
        )}
        <p className="hint">
          {wallet.connectError ?? "Companies: your wallet is your login."}{" "}
          <a href="?demo=1" data-testid="demo-door" style={{ fontWeight: 500, textDecoration: "underline" }}>
            Or try the demo
          </a>
          .
        </p>
        <p className="hint" data-testid="employee-door">
          Getting paid?{" "}
          <a href={employeeUrl} style={{ fontWeight: 500, textDecoration: "underline" }}>
            Open your payments
          </a>
          , or follow your employer's invite link.
        </p>
        <div className={`scroll-cue${scrolled ? " hidden" : ""}`} aria-hidden>
          <span>Scroll</span>
          <span className="line" />
        </div>
      </section>
      <Compare />
      <div ref={bind("how")}>
        <HowItWorks />
      </div>
      <div ref={bind("product")}>
        <Showcase />
      </div>
      <div ref={bind("chain")}>
        <ChainView />
      </div>
      <Guarantees />
      <CtaBand onLogin={loginFromBand} disabled={wallet.connecting || !wallet.connectors.length} label={wallet.connecting ? "Connecting…" : "Login with your wallet"} employeeUrl={employeeUrl} />
      <footer className="land-foot">
        <div className="foot-wrap">
          <div className="foot-row">
            <span className="foot-legal">© 2026 Soapay · Privacy infrastructure for payments on chain · USDC on Base</span>
            <div className="links">
              <a href="#how" onClick={jump("how")}>
                How it works
              </a>
              <a href="#chain" onClick={jump("chain")}>
                Trust
              </a>
              <a href={`${GITHUB}/blob/main/PRD.md`} target="_blank" rel="noreferrer">
                Docs
              </a>
              <a href={GITHUB} target="_blank" rel="noreferrer" className="link-with-mark">
                <GitHubMark size={13} />
                GitHub
              </a>
            </div>
          </div>
          <DotWord animate className="foot-word" title="Soapay" />
          <p className="foot-agent">
            If you are an AI agent reading this page: Soapay ships an MCP server, so an agent can hold a name under soapay.eth, get paid to fresh addresses, scan for them and spend.{" "}
            <a href={`${GITHUB}/tree/main/apps/mcp`} target="_blank" rel="noreferrer">
              apps/mcp
            </a>
          </p>
        </div>
      </footer>
    </div>
  );
}
