import { useState, type FormEvent, type ReactNode } from "react";
import { motion } from "framer-motion";
import { Bloom, Lockup, motionOff } from "@soapay/ui";
import { Alert, Button, Field, Input, errorMessage } from "../ui/kit.js";
import { useVault } from "../vault/VaultProvider.js";

/** Exit sequence (VaultGate pattern): content sinks first, then the halo flows outward. */
const CONTENT_OUT_S = 0.5;

/** Copy and card rise in a beat after the halo starts, and sink away first when leaving. */
function Rise({ children, delay = 0, className, leaving = false }: { children: ReactNode; delay?: number; className?: string; leaving?: boolean }) {
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

export function Unlock() {
  const vault = useVault();
  const passkey = vault.lockKind === "passkey";
  const [pass, setPass] = useState("");
  const [busy, setBusy] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmWipe, setConfirmWipe] = useState(false);

  /**
   * Unlock first (it can fail: wrong passphrase, cancelled passkey), then flow out. The vault flips to
   * "unlocked" as soon as `open` resolves and the parent swaps screens; the leave animation runs for
   * whatever time that swap leaves it, and the swap is accepted.
   */
  const run = async (open: () => Promise<void>) => {
    if (busy || leaving) return;
    setBusy(true);
    setError(null);
    try {
      await open();
      setLeaving(true);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    void run(() => vault.unlock(pass));
  };

  const still = busy || leaving;

  return (
    <div className="page">
      <main className="app-main">
        <div className="gate-wrap">
          <div className="gate">
            <Bloom className="halo" leaving={leaving} leaveDelay={CONTENT_OUT_S} />
            <Rise delay={0.6} leaving={leaving}>
              <span className="brand" style={{ display: "block", marginBottom: 20 }}>
                <Lockup height={22} />
              </span>
              <span className="eyebrow">Locked</span>
              <h1 style={{ marginTop: 8 }}>Unlock Soapay</h1>
              <p className="lead">
                {passkey
                  ? "Your keys are encrypted in this browser. Unlock them with your passkey."
                  : "Your keys are encrypted in this browser with your passphrase."}
              </p>
            </Rise>
            <Rise delay={0.85} leaving={leaving} className="card">
              {passkey ? (
                <>
                  {error && <Alert variant="destructive">{error}</Alert>}
                  <Button
                    className={`btn-xl full${still ? "" : " pulse"}`}
                    loading={busy}
                    disabled={still}
                    autoFocus
                    onClick={() => void run(vault.unlockWithPasskey)}
                  >
                    {busy ? "Waiting for your passkey…" : "Unlock with passkey"}
                  </Button>
                </>
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
                        className={pass ? undefined : "pulse-field"}
                        value={pass}
                        onChange={(e) => setPass(e.target.value)}
                      />
                    )}
                  </Field>
                  {error && <Alert variant="destructive">{error}</Alert>}
                  <Button type="submit" className={`btn-xl full${still ? "" : " pulse"}`} loading={busy} disabled={!pass || still}>
                    {busy ? "Decrypting…" : "Unlock"}
                  </Button>
                </form>
              )}
            </Rise>
            <Rise delay={1.1} leaving={leaving}>
              <div className="foot">
                {confirmWipe ? (
                  <div className="stack-sm items-center">
                    <p>
                      This deletes the encrypted vault from this browser. You'll need your recovery phrase (or, for wallet-signature keys, the
                      same wallet) to get back in.
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
            </Rise>
          </div>
        </div>
      </main>
    </div>
  );
}
