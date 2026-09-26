import { useState, type FormEvent } from "react";
import { Lockup } from "@soapay/ui";
import { Alert, Button, Field, Input, errorMessage } from "../ui/kit.js";
import { useVault } from "../vault/VaultProvider.js";

export function Unlock() {
  const vault = useVault();
  const passkey = vault.lockKind === "passkey";
  const [pass, setPass] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmWipe, setConfirmWipe] = useState(false);

  const run = async (open: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await open();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    void run(() => vault.unlock(pass));
  };

  return (
    <div className="page">
      <main className="app-main">
        <div className="mx-auto flex w-full max-w-md flex-col gap-6 pt-10">
          <span className="brand">
            <Lockup height={22} />
          </span>
          <div className="card stack">
            <div>
              <span className="eyebrow">Locked</span>
              <h1 style={{ marginTop: 6 }}>Unlock Soapay</h1>
              <p className="lead">
                {passkey
                  ? "Your keys are encrypted in this browser. Unlock them with your passkey."
                  : "Your keys are encrypted in this browser with your passphrase."}
              </p>
            </div>
            {passkey ? (
              <div className="stack">
                {error && <Alert variant="destructive">{error}</Alert>}
                <Button size="lg" className="w-full" loading={busy} disabled={busy} autoFocus onClick={() => void run(vault.unlockWithPasskey)}>
                  {busy ? "Waiting for your passkey…" : "Unlock with passkey"}
                </Button>
              </div>
            ) : (
              <form onSubmit={submit} className="stack">
                <Field label="Passphrase">
                  {({ id, describedBy }) => (
                    <Input
                      id={id}
                      type="password"
                      autoComplete="current-password"
                      autoFocus
                      aria-describedby={describedBy}
                      value={pass}
                      onChange={(e) => setPass(e.target.value)}
                    />
                  )}
                </Field>
                {error && <Alert variant="destructive">{error}</Alert>}
                <Button type="submit" size="lg" className="w-full" loading={busy} disabled={!pass}>
                  {busy ? "Decrypting…" : "Unlock"}
                </Button>
              </form>
            )}
          </div>
          <div className="text-center text-xs text-muted-foreground">
            {confirmWipe ? (
              <div className="stack-sm items-center">
                <p>
                  This deletes the encrypted vault from this browser. You'll need your recovery phrase (or, for wallet-signature keys, the same
                  wallet) to get back in.
                </p>
                <div className="flex justify-center gap-2">
                  <Button size="sm" variant="destructive" onClick={() => void vault.wipe()}>
                    Delete and restore
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setConfirmWipe(false)}>
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <button type="button" className="btn-text" onClick={() => setConfirmWipe(true)}>
                {passkey
                  ? "Passkey not working? Restore from your recovery phrase or wallet"
                  : "Forgot the passphrase? Restore from your recovery phrase or wallet"}
              </button>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
