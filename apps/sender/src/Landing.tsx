import { useEffect, useRef } from 'react';
import { AtSign, BookOpen, Droplets, GitBranch } from 'lucide-react';
import { useConnect } from 'wagmi';
import { GITHUB, HERO_VIDEO } from './config.js';

/** Fade-in on play, fade-out just before the end, restart from black: a seamless loop with no hard cut. */
function useCrossfadeLoop(ref: React.RefObject<HTMLVideoElement | null>) {
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    let raf = 0;
    let fading = false;
    const fade = (from: number, to: number, ms: number, done?: () => void) => {
      cancelAnimationFrame(raf);
      const t0 = performance.now();
      const step = (t: number) => {
        const k = Math.min(1, (t - t0) / ms);
        v.style.opacity = String(from + (to - from) * k);
        if (k < 1) raf = requestAnimationFrame(step);
        else done?.();
      };
      raf = requestAnimationFrame(step);
    };
    const onCanPlay = () => {
      void v.play().catch(() => {});
      fade(Number(v.style.opacity || 0), 1, 500);
    };
    const onTime = () => {
      if (!fading && v.duration && v.duration - v.currentTime <= 0.55) {
        fading = true;
        fade(Number(v.style.opacity || 1), 0, 500);
      }
    };
    const onEnded = () => {
      v.style.opacity = '0';
      window.setTimeout(() => {
        v.currentTime = 0;
        void v.play().catch(() => {});
        fading = false;
        fade(0, 1, 500);
      }, 100);
    };
    v.addEventListener('canplay', onCanPlay, { once: true });
    v.addEventListener('timeupdate', onTime);
    v.addEventListener('ended', onEnded);
    return () => {
      cancelAnimationFrame(raf);
      v.removeEventListener('canplay', onCanPlay);
      v.removeEventListener('timeupdate', onTime);
      v.removeEventListener('ended', onEnded);
    };
  }, [ref]);
}

/** Hero-only landing. "Login" connects the wallet; App switches to the dashboard once connected. */
export function Landing({ connected, onLogin }: { connected: boolean; onLogin: () => void }) {
  const { connect, connectors, isPending, error } = useConnect();
  const connector = connectors[0];
  // Only an explicit Login click counts as busy; wagmi's background reconnect must not grey the button.
  const busy = isPending;
  const videoRef = useRef<HTMLVideoElement>(null);
  useCrossfadeLoop(videoRef);

  function login() {
    onLogin();
    if (!connected && connector) connect({ connector });
  }

  return (
    <section className="l-hero">
      <video
        ref={videoRef}
        className="l-hero-video"
        src={HERO_VIDEO}
        muted
        autoPlay
        playsInline
        preload="auto"
        aria-hidden
        style={{ opacity: 0 }}
      />
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
