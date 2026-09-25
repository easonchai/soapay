import { useState } from "react";
import type { VaultPhase } from "../hooks/store.js";
import type { VaultMode } from "../lib/vault.js";
import { Banner, Button, Card, Input } from "../ui/kit.js";

export type VaultGateProps = {
  phase: Exclude<VaultPhase, "ready">;
  vaultMode: VaultMode | null;
  minPassphrase: number;
  error: string | null;
  onCreate(mode: VaultMode, passphrase?: string): void;
  onUnlock(passphrase?: string): void;
};

/** Create or unlock the encrypted roster + history vault. */
export function VaultGate(p: VaultGateProps) {
  const [pass, setPass] = useState("");
  if (p.phase === "loading") return <p className="text-sm text-slate-500">Opening vault…</p>;
  if (p.phase === "locked") {
    return (
      <Card title="Unlock">
        {p.vaultMode === "passphrase" ? (
          <form className="flex gap-2" onSubmit={(e) => (e.preventDefault(), p.onUnlock(pass))}>
            <Input type="password" placeholder="Passphrase" value={pass} onChange={(e) => setPass(e.target.value)} autoFocus />
            <Button type="submit">Unlock</Button>
          </form>
        ) : (
          <Button onClick={() => p.onUnlock()}>Unlock on this device</Button>
        )}
        {p.error && <div className="mt-3"><Banner tone="error">{p.error}</Banner></div>}
      </Card>
    );
  }
  return (
    <Card title="Set up the payroll vault">
      <p className="mb-3 text-sm text-slate-600">
        The roster (names → amounts) and run history are encrypted in this browser. Nothing is sent to a server.
      </p>
      <div className="flex flex-col gap-3">
        <Button variant="ghost" onClick={() => p.onCreate("device")}>Use a device key (no passphrase)</Button>
        <form className="flex gap-2" onSubmit={(e) => (e.preventDefault(), p.onCreate("passphrase", pass))}>
          <Input type="password" placeholder={`Passphrase (${p.minPassphrase}+ characters)`} value={pass} onChange={(e) => setPass(e.target.value)} />
          <Button type="submit" disabled={pass.length < p.minPassphrase}>Create with passphrase</Button>
        </form>
      </div>
      {p.error && <div className="mt-3"><Banner tone="error">{p.error}</Banner></div>}
    </Card>
  );
}
