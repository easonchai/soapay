import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Dots, ErrorLine, Loading, motionOff } from "@soapay/ui";

/** The diamond behind the gate: blooms in on arrival, flows outward when the user proceeds. */
function Halo({ leaving }: { leaving: boolean }) {
  if (motionOff()) return <div className="halo" aria-hidden><Dots mode="diamond" className="dots" /></div>;
  return (
    <motion.div
      className="halo"
      aria-hidden
      initial={{ scale: 0.55, opacity: 0 }}
      animate={leaving ? { scale: 1.45, opacity: 0 } : { scale: 1, opacity: 0.55 }}
      transition={leaving ? { duration: 1.1, ease: [0.4, 0, 0.6, 1] } : { duration: 2.4, ease: [0.16, 1, 0.3, 1] }}
    >
      <Dots mode="diamond" animate className="dots" />
    </motion.div>
  );
}

/** Copy and card rise in a beat after the halo starts. */
function Rise({ children, delay = 0, className }: { children: React.ReactNode; delay?: number; className?: string }) {
  if (motionOff()) return <div {...(className ? { className } : {})}>{children}</div>;
  return (
    <motion.div {...(className ? { className } : {})} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.9, delay, ease: [0.16, 1, 0.3, 1] }}>
      {children}
    </motion.div>
  );
}
const LEAVE_MS = 1100;
import type { VaultPhase } from "../hooks/store.js";
import type { VaultMode } from "../lib/vault.js";

export type VaultGateProps = {
  phase: Exclude<VaultPhase, "ready">;
  vaultMode: VaultMode | null;
  minPassphrase: number;
  error: string | null;
  onCreate(mode: VaultMode, passphrase?: string): void;
  onUnlock(passphrase?: string): void;
};

const FOOT = "The roster (names and amounts) and run history are encrypted here. Nothing is sent to a server.";

/** Create or unlock the encrypted roster + history vault. One centred column, one thing to press. */
export function VaultGate(p: VaultGateProps) {
  const [pass, setPass] = useState("");
  const [show, setShow] = useState(false);
  const [mode, setMode] = useState<VaultMode>("device");
  const [leaving, setLeaving] = useState(false);
  const primary = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    primary.current?.focus();
  }, [p.phase, p.vaultMode]);
  /** Let the halo flow out, then hand over. Instant when motion is off. */
  function proceed(fn: () => void) {
    if (leaving) return;
    if (motionOff()) return fn();
    setLeaving(true);
    window.setTimeout(fn, LEAVE_MS);
  }

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

  if (p.phase === "locked") {
    const device = p.vaultMode !== "passphrase";
    return (
      <div className="gate-wrap">
        <div className="gate">
          <Halo leaving={leaving} />
          <Rise delay={0.6}>
            <span className="eyebrow">Payroll vault · locked</span>
            <h1 style={{ marginTop: 8 }}>Unlock your payroll</h1>
            <p className="lead">Your roster and run history are encrypted in this browser.</p>
          </Rise>
          <Rise delay={0.85} className="card">
            {device ? (
              <>
                <button ref={primary} className={`btn-primary btn-xl full${leaving ? "" : " pulse"}`} disabled={leaving} onClick={() => proceed(() => p.onUnlock())}>
                  Unlock on this device
                </button>
                <p className="foot">Uses a key stored in this browser. Nothing leaves your device.</p>
              </>
            ) : (
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
            )}
            <ErrorLine error={p.error} />
          </Rise>
          <Rise delay={1.1}>
            <p className="foot">{FOOT}</p>
          </Rise>
        </div>
      </div>
    );
  }

  const canCreate = mode === "device" || passOk;
  return (
    <div className="gate-wrap">
      <div className="gate">
        <Halo leaving={leaving} />
        <Rise delay={0.6}>
          <span className="eyebrow">Payroll vault · new</span>
          <h1 style={{ marginTop: 8 }}>Set up the payroll vault</h1>
          <p className="lead">Choose how this browser unlocks your roster and history.</p>
        </Rise>
        <Rise delay={0.85}>
        <form
          className="card"
          onSubmit={(e) => {
            e.preventDefault();
            if (canCreate) proceed(() => p.onCreate(mode, mode === "passphrase" ? pass : undefined));
          }}
        >
          <div role="radiogroup" aria-label="Vault protection" className="stack-sm">
            <button type="button" role="radio" aria-checked={mode === "device"} className="opt" onClick={() => setMode("device")}>
              <span className="radio" />
              <span>
                <span className="t">Device key</span>
                <span className="d" style={{ display: "block" }}>
                  Fastest. Tied to this browser profile; clearing site data removes it.
                </span>
              </span>
            </button>
            <button type="button" role="radio" aria-checked={mode === "passphrase"} className="opt" onClick={() => setMode("passphrase")}>
              <span className="radio" />
              <span>
                <span className="t">Passphrase</span>
                <span className="d" style={{ display: "block" }}>
                  Survives clearing site data. Needed if you move to another device.
                </span>
              </span>
            </button>
          </div>
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
        </form>
        </Rise>
        <Rise delay={1.1}>
          <p className="foot">{FOOT}</p>
        </Rise>
      </div>
    </div>
  );
}
