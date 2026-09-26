import { useState } from "react";
import { ErrorLine, PageHead } from "@soapay/ui";
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

/** Create or unlock the encrypted roster + history vault, in the Ledger design. */
export function VaultGate(p: VaultGateProps) {
  const [pass, setPass] = useState("");
  if (p.phase === "loading") return <p className="ink2">Opening vault…</p>;

  if (p.phase === "locked") {
    return (
      <div className="gate stack-lg">
        <PageHead eyebrow="Payroll vault · locked" title="Unlock your payroll" line="Your roster and run history are encrypted in this browser." />
        <div className="panel panel-pad stack">
          {p.vaultMode === "passphrase" ? (
            <form className="actions" onSubmit={(e) => (e.preventDefault(), p.onUnlock(pass))}>
              <input type="password" aria-label="Passphrase" placeholder="Passphrase" value={pass} onChange={(e) => setPass(e.target.value)} autoFocus style={{ flex: 1 }} />
              <button type="submit" className="btn-primary">
                Unlock
              </button>
            </form>
          ) : (
            <button className="btn-primary btn-lg" onClick={() => p.onUnlock()}>
              Unlock on this device
            </button>
          )}
          <ErrorLine error={p.error} />
        </div>
      </div>
    );
  }

  return (
    <div className="gate stack-lg">
      <PageHead
        eyebrow="Payroll vault · new"
        title="Set up the payroll vault"
        line="The roster (names → amounts) and run history are encrypted in this browser. Nothing is sent to a server."
      />
      <div className="panel panel-pad stack">
        <button className="btn-lg" onClick={() => p.onCreate("device")}>
          Use a device key (no passphrase)
        </button>
        <form className="actions" onSubmit={(e) => (e.preventDefault(), p.onCreate("passphrase", pass))}>
          <input
            type="password"
            aria-label="New passphrase"
            placeholder={`Passphrase (${p.minPassphrase}+ characters)`}
            value={pass}
            onChange={(e) => setPass(e.target.value)}
            style={{ flex: 1 }}
          />
          <button type="submit" className="btn-primary" disabled={pass.length < p.minPassphrase}>
            Create with passphrase
          </button>
        </form>
        <ErrorLine error={p.error} />
      </div>
    </div>
  );
}
