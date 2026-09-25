import { useState, type FormEvent } from "react";
import { Lock } from "lucide-react";
import { Logo } from "../onboarding/Onboarding.js";
import { Alert, Button, Card, Field, Input, errorMessage } from "../ui/kit.js";
import { useVault } from "../vault/VaultProvider.js";

export function Unlock() {
  const vault = useVault();
  const [pass, setPass] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmWipe, setConfirmWipe] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await vault.unlock(pass);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center gap-6 px-4 py-10">
      <Logo />
      <Card className="space-y-4 p-5">
        <div className="flex items-center gap-2">
          <Lock className="size-4 text-muted-foreground" aria-hidden />
          <h1 className="text-lg font-semibold">Unlock Soapay</h1>
        </div>
        <form onSubmit={submit} className="space-y-4">
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
          <Button type="submit" className="w-full" loading={busy} disabled={!pass}>
            {busy ? "Decrypting…" : "Unlock"}
          </Button>
        </form>
      </Card>
      <div className="text-center text-xs text-muted-foreground">
        {confirmWipe ? (
          <div className="space-y-2">
            <p>This deletes the encrypted vault from this browser. You'll need your recovery phrase to get back in.</p>
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
          <button type="button" className="underline underline-offset-2" onClick={() => setConfirmWipe(true)}>
            Forgot the passphrase? Restore from recovery phrase
          </button>
        )}
      </div>
    </div>
  );
}
