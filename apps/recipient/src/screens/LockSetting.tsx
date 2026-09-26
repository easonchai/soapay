import { useEffect, useState, type FormEvent } from "react";
import { Alert, Button, Field, Input, errorMessage } from "../ui/kit.js";
import { MIN_PASSPHRASE_LENGTH } from "../vault/crypto.js";
import { useVault } from "../vault/VaultProvider.js";

/**
 * Settings → This device (D-35): which lock the vault uses, and a switch between passkey and passphrase.
 * Switching re-encrypts the same vault; the recovery phrase is unaffected.
 */
export function LockSetting() {
  const vault = useVault();
  const [canPasskey, setCanPasskey] = useState(false);
  const [editing, setEditing] = useState(false);
  const [pass, setPass] = useState("");
  const [again, setAgain] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const { passkeyAvailable } = vault;

  useEffect(() => {
    let cancelled = false;
    void passkeyAvailable().then((ok) => !cancelled && setCanPasskey(ok));
    return () => {
      cancelled = true;
    };
  }, [passkeyAvailable]);

  const relock = async (to: Parameters<typeof vault.relock>[0], msg: string) => {
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      await vault.relock(to);
      setEditing(false);
      setPass("");
      setAgain("");
      setDone(msg);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (pass.length < MIN_PASSPHRASE_LENGTH || pass !== again) return;
    void relock({ kind: "passphrase", passphrase: pass }, "This device now unlocks with your passphrase.");
  };

  const passkey = vault.lockKind === "passkey";
  return (
    <div className="stack-sm" data-testid="lock-setting">
      <p className="muted">
        Unlocks with: <strong>{passkey ? "passkey (Face ID / fingerprint)" : "passphrase"}</strong>
      </p>
      {done && <Alert variant="success">{done}</Alert>}
      {error && <Alert variant="destructive">{error}</Alert>}
      {editing ? (
        <form onSubmit={submit} className="stack-sm" noValidate>
          <Field label="New passphrase" hint={`At least ${MIN_PASSPHRASE_LENGTH} characters.`}>
            {({ id, describedBy }) => (
              <Input id={id} type="password" autoComplete="new-password" aria-describedby={describedBy} value={pass} onChange={(e) => setPass(e.target.value)} />
            )}
          </Field>
          <Field label="Repeat passphrase" error={again && again !== pass ? "The passphrases don't match." : null}>
            {({ id, describedBy }) => (
              <Input id={id} type="password" autoComplete="new-password" aria-describedby={describedBy} value={again} onChange={(e) => setAgain(e.target.value)} />
            )}
          </Field>
          <div className="actions">
            <Button type="submit" variant="outline" loading={busy} disabled={busy || pass.length < MIN_PASSPHRASE_LENGTH || pass !== again}>
              Use this passphrase
            </Button>
            <Button type="button" variant="ghost" onClick={() => setEditing(false)} disabled={busy}>
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <div className="actions">
          <Button variant="outline" onClick={() => setEditing(true)}>
            {passkey ? "Use a passphrase instead" : "Change passphrase"}
          </Button>
          {canPasskey && (
            <Button variant="outline" loading={busy} disabled={busy} onClick={() => void relock({ kind: "passkey" }, "This device now unlocks with your passkey.")}>
              {passkey ? "Replace passkey" : "Use a passkey instead"}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
