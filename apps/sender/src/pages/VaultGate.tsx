import { useEffect, useRef, useState } from "react";
import { Dots, ErrorLine, Loading } from "@soapay/ui";
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
  const primary = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    primary.current?.focus();
  }, [p.phase, p.vaultMode]);

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
        <Dots mode="diamond" animate className="dots" />
        <div className="gate">
          <div>
            <span className="eyebrow">Payroll vault · locked</span>
            <h1 style={{ marginTop: 8 }}>Unlock your payroll</h1>
            <p className="lead">Your roster and run history are encrypted in this browser.</p>
          </div>
          <div className="card">
            {device ? (
              <>
                <button ref={primary} className="btn-primary btn-xl full pulse" onClick={() => p.onUnlock()}>
                  Unlock on this device
                </button>
                <p className="foot">Uses a key stored in this browser. Nothing leaves your device.</p>
              </>
            ) : (
              <form
                className="stack-sm"
                onSubmit={(e) => {
                  e.preventDefault();
                  p.onUnlock(pass);
                }}
              >
                {passField("Passphrase", "Passphrase")}
                <button ref={primary} type="submit" className={`btn-primary btn-xl full${pass ? " pulse" : ""}`} disabled={!pass}>
                  Unlock
                </button>
              </form>
            )}
            <ErrorLine error={p.error} />
          </div>
          <p className="foot">{FOOT}</p>
        </div>
      </div>
    );
  }

  const canCreate = mode === "device" || passOk;
  return (
    <div className="gate-wrap">
      <Dots mode="diamond" animate className="dots" />
      <div className="gate">
        <div>
          <span className="eyebrow">Payroll vault · new</span>
          <h1 style={{ marginTop: 8 }}>Set up the payroll vault</h1>
          <p className="lead">Choose how this browser unlocks your roster and history.</p>
        </div>
        <form
          className="card"
          onSubmit={(e) => {
            e.preventDefault();
            if (canCreate) p.onCreate(mode, mode === "passphrase" ? pass : undefined);
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
          <button ref={primary} type="submit" className={`btn-primary btn-xl full${canCreate ? " pulse" : ""}`} disabled={!canCreate}>
            Create vault
          </button>
          <ErrorLine error={p.error} />
        </form>
        <p className="foot">{FOOT}</p>
      </div>
    </div>
  );
}
