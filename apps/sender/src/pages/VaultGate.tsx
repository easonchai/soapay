import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Bloom, BLOOM_OUT_S, ErrorLine, Loading, motionOff } from "@soapay/ui";

/** Exit sequence: content fades first, then the halo flows outward, then the loader takes over. */
const CONTENT_OUT_S = 0.5;
const LEAVE_MS = (CONTENT_OUT_S + BLOOM_OUT_S) * 1000;

/** Copy and card rise in a beat after the halo starts, and sink away first when leaving. */
function Rise({ children, delay = 0, className, leaving = false }: { children: React.ReactNode; delay?: number; className?: string; leaving?: boolean }) {
  if (motionOff()) return <div {...(className ? { className } : {})}>{children}</div>;
  return (
    <motion.div
      {...(className ? { className } : {})}
      initial={{ opacity: 0, y: 14 }}
      animate={leaving ? { opacity: 0, y: -10 } : { opacity: 1, y: 0 }}
      transition={leaving ? { duration: CONTENT_OUT_S, ease: [0.4, 0, 0.6, 1] } : { duration: 0.9, delay, ease: [0.16, 1, 0.3, 1] }}
    >
      {children}
    </motion.div>
  );
}
import type { RestoreOffer, VaultPhase, WalletLock } from "../hooks/store.js";
import type { VaultMode } from "../lib/vault.js";

export type VaultGateProps = {
  phase: Exclude<VaultPhase, "ready">;
  vaultMode: VaultMode | null;
  minPassphrase: number;
  error: string | null;
  onCreate(mode: VaultMode, passphrase?: string): void;
  onUnlock(passphrase?: string): void;
  /** Wallet-signature lock (D-62): offered, and the default, when a real wallet is connected. */
  walletLock?: WalletLock;
  /** The connected wallet's encrypted backup, in the "restore" phase. */
  restore?: RestoreOffer | null;
  onRestore?(passphrase?: string): void;
  onStartFresh?(): void;
  /** Encrypted backups are on (API configured, not demo). */
  backupEnabled?: boolean;
  /** A failed backup lookup, shown on the "new" screen. */
  notice?: string | null;
};

const FOOT = "Encrypted here; nothing is sent to a server.";
const FOOT_BACKUP = "Encrypted here. Backups hold only ciphertext; your key never leaves this browser.";

function when(unixSeconds: number): string {
  try {
    return new Date(unixSeconds * 1000).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  } catch {
    return new Date(unixSeconds * 1000).toISOString();
  }
}

/** Create, unlock or restore the encrypted roster + history vault. One centred column, one thing to press. */
export function VaultGate(p: VaultGateProps) {
  const walletLock = p.walletLock ?? "hidden";
  const [pass, setPass] = useState("");
  const [show, setShow] = useState(false);
  const [mode, setMode] = useState<VaultMode>(walletLock === "available" ? "wallet" : "device");
  const [leaving, setLeaving] = useState(false);
  const primary = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    primary.current?.focus();
  }, [p.phase, p.vaultMode]);
  // The wallet can't lock the vault (it signs differently each time): fall back to a passphrase.
  useEffect(() => {
    if (walletLock === "unavailable") setMode((m) => (m === "wallet" ? "passphrase" : m));
    if (walletLock === "available") setMode((m) => (m === "device" ? "wallet" : m));
    if (walletLock === "hidden") setMode((m) => (m === "wallet" ? "device" : m));
  }, [walletLock]);
  // A failed attempt (e.g. a declined signature) brings the screen back.
  useEffect(() => {
    if (p.error) setLeaving(false);
  }, [p.error]);
  /** Fade the content, let the halo flow out, then hand over. Instant when motion is off. */
  function proceed(fn: () => void) {
    if (leaving) return;
    if (motionOff()) return fn();
    setLeaving(true);
    window.setTimeout(fn, LEAVE_MS);
  }
  const foot = p.backupEnabled ? FOOT_BACKUP : FOOT;

  if (p.phase === "loading") return <Loading label="Opening your vault…" />;

  const passOk = pass.length >= p.minPassphrase;
  const passField = (label: string, placeholder: string) => (
    <div className="pass-row">
      <input
        type={show ? "text" : "password"}
        aria-label={label}
        placeholder={placeholder}
        value={pass}
        onChange={(e) => setPass(e.target.value)}
        autoComplete={label === "Passphrase" ? "current-password" : "new-password"}
        className={pass ? undefined : "pulse-field"}
        autoFocus
      />
      <button type="button" onClick={() => setShow((s) => !s)} aria-label={show ? "Hide passphrase" : "Show passphrase"}>
        {show ? "Hide" : "Show"}
      </button>
    </div>
  );

  if (p.phase === "restore" && p.restore) {
    const r = p.restore;
    return (
      <div className="gate-wrap">
        <div className="gate">
          <Bloom className="halo" leaving={leaving} leaveDelay={CONTENT_OUT_S} />
          <Rise delay={0.6} leaving={leaving}>
            <span className="eyebrow">Payroll vault · backup found</span>
            <h1 style={{ marginTop: 8 }}>Restore your payroll</h1>
            <p className="lead">
              This wallet has an encrypted backup of your roster, invites and history, saved {when(r.updatedAt)}.
            </p>
          </Rise>
          <Rise delay={0.85} leaving={leaving} className="card">
            {r.mode === "wallet" ? (
              <>
                <button
                  ref={primary}
                  className={`btn-primary btn-xl full${leaving ? "" : " pulse"}`}
                  disabled={leaving}
                  onClick={() => proceed(() => p.onRestore?.())}
                >
                  Restore with wallet
                </button>
                <p className="foot">Your wallet signs once to unlock it. The signature stays in this browser.</p>
              </>
            ) : (
              <form
                className="stack-sm"
                onSubmit={(e) => {
                  e.preventDefault();
                  proceed(() => p.onRestore?.(pass));
                }}
              >
                {passField("Passphrase", "Vault passphrase")}
                <button ref={primary} type="submit" className={`btn-primary btn-xl full${pass ? " pulse" : ""}`} disabled={!pass}>
                  Restore
                </button>
                <p className="foot">This backup is locked with a passphrase.</p>
              </form>
            )}
            <ErrorLine error={p.error} />
          </Rise>
          <Rise delay={1.1} leaving={leaving}>
            <p className="foot">
              <button type="button" className="btn-text" onClick={() => p.onStartFresh?.()}>
                Start a new vault instead
              </button>{" "}
              (its first backup replaces this one)
            </p>
          </Rise>
        </div>
      </div>
    );
  }

  if (p.phase === "locked") {
    const unlockMode = p.vaultMode ?? "device";
    return (
      <div className="gate-wrap">
        <div className="gate">
          <Bloom className="halo" leaving={leaving} leaveDelay={CONTENT_OUT_S} />
          <Rise delay={0.6} leaving={leaving}>
            <span className="eyebrow">Payroll vault · locked</span>
            <h1 style={{ marginTop: 8 }}>Unlock your payroll</h1>
            <p className="lead">Your roster and history stay in this browser.</p>
          </Rise>
          <Rise delay={0.85} leaving={leaving} className="card">
            {unlockMode === "passphrase" ? (
              <form
                className="stack-sm"
                onSubmit={(e) => {
                  e.preventDefault();
                  proceed(() => p.onUnlock(pass));
                }}
              >
                {passField("Passphrase", "Passphrase")}
                <button ref={primary} type="submit" className={`btn-primary btn-xl full${pass ? " pulse" : ""}`} disabled={!pass}>
                  Unlock
                </button>
              </form>
            ) : (
              <>
                <button ref={primary} className={`btn-primary btn-xl full${leaving ? "" : " pulse"}`} disabled={leaving} onClick={() => proceed(() => p.onUnlock())}>
                  {unlockMode === "wallet" ? "Unlock with wallet" : "Unlock on this device"}
                </button>
                <p className="foot">
                  {unlockMode === "wallet"
                    ? "Your wallet signs once to unlock. The signature never leaves your browser."
                    : "Key stored in this browser; nothing leaves your device."}
                </p>
              </>
            )}
            <ErrorLine error={p.error} />
          </Rise>
          <Rise delay={1.1} leaving={leaving}>
            <p className="foot">{foot}</p>
          </Rise>
        </div>
      </div>
    );
  }

  const canCreate = mode === "device" || mode === "wallet" || passOk;
  const option = (m: VaultMode, title: string, detail: string) => (
    <button type="button" role="radio" aria-checked={mode === m} className="opt" onClick={() => setMode(m)}>
      <span className="radio" />
      <span>
        <span className="t">{title}</span>
        <span className="d" style={{ display: "block" }}>
          {detail}
        </span>
      </span>
    </button>
  );
  return (
    <div className="gate-wrap">
      <div className="gate">
        <Bloom className="halo" leaving={leaving} leaveDelay={CONTENT_OUT_S} />
        <Rise delay={0.6} leaving={leaving}>
          <span className="eyebrow">Payroll vault · new</span>
          <h1 style={{ marginTop: 8 }}>Set up the payroll vault</h1>
          <p className="lead">Choose how this browser unlocks the vault.</p>
        </Rise>
        <Rise delay={0.85} leaving={leaving}>
        <form
          className="card"
          onSubmit={(e) => {
            e.preventDefault();
            if (canCreate) proceed(() => p.onCreate(mode, mode === "passphrase" ? pass : undefined));
          }}
        >
          <div role="radiogroup" aria-label="Vault protection" className="stack-sm">
            {walletLock === "available" &&
              option(
                "wallet",
                "Wallet signature (recommended)",
                p.backupEnabled
                  ? "Your wallet unlocks it. Backed up encrypted, so logging in restores it in any browser. Your wallet asks you to sign twice now."
                  : "Your wallet unlocks it, in any browser. Your wallet asks you to sign twice now.",
              )}
            {option("device", "Device key", "Fastest. Tied to this browser profile; clearing site data removes it. Can't be backed up.")}
            {option(
              "passphrase",
              "Passphrase",
              p.backupEnabled ? "Backed up encrypted; restoring in another browser asks for the passphrase." : "Survives cleared site data; works on another device.",
            )}
          </div>
          {walletLock === "unavailable" && (
            <p className="note" role="status">
              Your wallet signs differently each time (typical of passkey smart wallets), so it can&apos;t lock the vault. With a passphrase your data is still
              backed up; restoring it asks for the passphrase.
            </p>
          )}
          {mode === "passphrase" && (
            <div className="stack-sm">
              {passField("New passphrase", `At least ${p.minPassphrase} characters`)}
              <span className="counter">
                {pass.length}/{p.minPassphrase}
                {passOk ? " · ok" : ""}
              </span>
            </div>
          )}
          <button ref={primary} type="submit" className={`btn-primary btn-xl full${canCreate && !leaving ? " pulse" : ""}`} disabled={!canCreate || leaving}>
            Create vault
          </button>
          <ErrorLine error={p.error} />
          {p.notice && <p className="note">{p.notice}</p>}
        </form>
        </Rise>
        <Rise delay={1.1} leaving={leaving}>
          <p className="foot">{foot}</p>
        </Rise>
      </div>
    </div>
  );
}
