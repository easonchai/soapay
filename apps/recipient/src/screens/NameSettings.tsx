import { useState } from "react";
import { KeyRound, ShieldCheck } from "lucide-react";
import { useRotation } from "../hooks/useRotation.js";
import { useServices } from "../services/ServicesProvider.js";
import { exitOffered } from "../config.js";
import { Link } from "react-router";
import { generateMnemonic } from "@soapay/sdk";
import { ClaimNameLater } from "../onboarding/Onboarding.js";
import { Addr, Alert, Badge, Button, Card, CardHeader, Checkbox, CopyButton, PageHeader, errorMessage } from "../ui/kit.js";
import { relativeTime } from "../ui/format.js";
import { useUnlocked } from "../vault/VaultProvider.js";
import { HumanCheck, sessionSignal } from "../worldid/index.js";

const STAGE_TEXT: Record<string, string> = {
  sign: "Signing the rotation with your registrant key…",
  post: "Sending the World ID proof to the Soapay API…",
  register: "Updating the ERC-6538 registry (relayed, no gas for you)…",
  setText: "Updating your ENS record on Sepolia…",
  done: "Done",
};

/**
 * Wallet-signature accounts rotate by moving to a recovery-phrase account (owner decision 2026-09-26):
 * 1. create a phrase (new keys), 2. optionally Exit or Send funds from the old stealth addresses (they
 * stay scanned and spendable here either way), 3. point the name at the new keys with the normal
 * rotation below (World ID session if linked, otherwise the employer re-approves).
 */
export function MoveToPhrase({
  canRotate,
  onAdopt,
  showExit = true,
}: {
  canRotate: boolean;
  onAdopt: (mnemonic: string) => Promise<void>;
  /** Offer the exit link (false on the Base Sepolia demo, D-52). */
  showExit?: boolean;
}) {
  const [phrase, setPhrase] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <div className="space-y-3" data-testid="move-to-phrase">
      <Alert variant="info" title="Rotating means moving to a recovery-phrase account">
        This account's keys come from a wallet signature, which can't produce new keys. You get a recovery phrase for the new keys; your
        old payments stay in this account and remain spendable. Keep the wallet you signed with: it still controls your name.
      </Alert>
      <ol className="space-y-3 text-sm">
        <li>
          <strong>1. Create your recovery phrase.</strong>{" "}
          {canRotate ? (
            <Badge tone="success">Done</Badge>
          ) : phrase === null ? (
            <Button size="sm" variant="outline" onClick={() => setPhrase(generateMnemonic())}>
              Create recovery phrase
            </Button>
          ) : (
            <span className="mt-2 block space-y-2">
              <span className="block font-mono text-xs" data-testid="new-phrase">
                {phrase}
              </span>
              <Checkbox checked={saved} onChange={setSaved} label="I wrote down all 12 words, in order" />
              <Button
                size="sm"
                disabled={!saved || busy}
                onClick={async () => {
                  setBusy(true);
                  setError(null);
                  try {
                    await onAdopt(phrase);
                    setPhrase(null);
                  } catch (e) {
                    setError(errorMessage(e));
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Use this phrase for my new keys
              </Button>
            </span>
          )}
        </li>
        <li>
          <strong>2. Move funds from the old addresses (optional).</strong>{" "}
          {showExit ? (
            <>
              Cash out privately with <Link to="/exit">Exit</Link>, or use <Link to="/spend">Send</Link>.
            </>
          ) : (
            <>
              Use <Link to="/spend">Send</Link>.
            </>
          )}{" "}
          You can also do this later: the old addresses stay in your ledger.
        </li>
        <li>
          <strong>3. Point your name at the new keys</strong> with "Rotate to new keys" below. With a World ID session your employer's app accepts it
          automatically; otherwise your employer re-approves you by hand.
        </li>
      </ol>
      {error && <Alert variant="destructive">{error}</Alert>}
    </div>
  );
}

export function NameSettings() {
  const r = useRotation();
  const svc = useServices();
  const v = useUnlocked();
  const [attaching, setAttaching] = useState(false);
  const s = r.state;

  if (!r.name) {
    return (
      <div className="onb stack-lg">
        <Alert variant="info" title="You skipped this during setup">
          You're sharing your raw meta-address. A name is easier for your employer to type, and lets you change keys later without re-sending
          anything.
        </Alert>
        <ClaimNameLater />
      </div>
    );
  }

  return (
    <>
      <PageHeader eyebrow="Name settings" title={r.name.name} description="Your employer pays this name. It points to your current meta-address." action={<CopyButton value={r.name.name} />} />
      <div className="space-y-4">
        <Card>
          <CardHeader title="Current keys" description={`Generation ${r.generation}. Older generations are still scanned and spendable.`} />
          <p className="px-4 py-3 font-mono text-xs break-all" data-testid="current-meta">
            {r.currentMeta}
          </p>
        </Card>

        <Card>
          <CardHeader
            title="Self-service recovery"
            action={r.path === "attested" ? <Badge tone="success"><ShieldCheck className="size-3" aria-hidden /> World ID</Badge> : <Badge>Employer approval</Badge>}
          />
          <div className="space-y-3 px-4 py-3 text-sm">
            {r.path === "attested" ? (
              <p>A World ID Selfie Check session is linked to this name. Key changes are attested and your employer's app accepts them automatically.</p>
            ) : r.cooldownUntil ? (
              <Alert variant="info" title="World ID linked, waiting period running">
                A session added after the name was claimed can back a key change from{" "}
                <strong data-testid="cooldown-until">{new Date(r.cooldownUntil).toLocaleString()}</strong> (a 72-hour wait, so someone with a stolen key
                can't add their own and rotate at once). Until then, a key change needs your employer's approval.
              </Alert>
            ) : (
              <>
                <p>No World ID session is linked. You can still change keys, but your employer must approve the change by hand before paying you again.</p>
                <p className="text-xs text-muted-foreground">A session added now can back a key change after a 72-hour waiting period.</p>
                {attaching ? (
                  <HumanCheck
                    mode="create-session"
                    apiUrl={svc.settings.apiUrl}
                    signal={sessionSignal(r.name.label, v.keys.registrantAddress)}
                    onCancel={() => setAttaching(false)}
                    onResult={async (res) => {
                      await r.attach(res);
                      setAttaching(false);
                    }}
                  />
                ) : (
                  <Button variant="outline" size="sm" onClick={() => setAttaching(true)}>
                    Enable with World ID
                  </Button>
                )}
                {r.attachError && <Alert variant="destructive">{r.attachError}</Alert>}
              </>
            )}
          </div>
        </Card>

        <Card>
          <CardHeader title="Rotate keys" description="Point this name at fresh keys from the same recovery phrase, e.g. after a device was compromised." />
          <div className="space-y-3 px-4 py-3">
            {!r.ensReady && <Alert variant="warning">{r.ensUnavailableReason}</Alert>}
            {r.pending && s.step !== "working" && (
              <Alert
                variant="warning"
                title="A rotation is half done"
                action={
                  <Button size="sm" onClick={() => void r.resume()} disabled={!r.ensReady}>
                    Finish it
                  </Button>
                }
              >
                {r.pending.path === "attested" ? "World ID accepted it" : "The registry update is prepared"}; the ENS record still points at your old keys.
              </Alert>
            )}
            {s.step === "idle" && (
              <>
                {s.error && <Alert variant="destructive">{s.error}</Alert>}
                {r.walletKeys && <MoveToPhrase canRotate={r.canRotate} onAdopt={r.adoptPhrase} showExit={exitOffered(svc.settings.chainId)} />}
                <Button onClick={r.start} disabled={!!r.pending || !r.canRotate}>
                  <KeyRound className="size-4" aria-hidden /> Rotate to new keys
                </Button>
              </>
            )}
            {s.step === "confirm" && (
              <div className="space-y-3" data-testid="rotation-confirm" data-path={s.path}>
                <p className="text-sm">
                  New meta-address (generation {s.draft.generation}):
                  <span className="mt-1 block font-mono text-xs break-all">{s.draft.newMeta}</span>
                </p>
                {s.path === "attested" ? (
                  <Alert variant="info">You'll confirm with World ID. Your employer's app then accepts the change automatically.</Alert>
                ) : (
                  <Alert variant="warning" title="Your employer must approve this">
                    Without World ID, the payroll app blocks your line until your employer confirms the change with you. Tell them before the next pay run.
                  </Alert>
                )}
                <div className="flex gap-2">
                  <Button onClick={() => void r.confirm()} disabled={!r.ensReady}>
                    {s.path === "attested" ? "Continue to World ID" : "Rotate anyway"}
                  </Button>
                  <Button variant="ghost" onClick={r.cancel}>
                    Cancel
                  </Button>
                </div>
              </div>
            )}
            {s.step === "human" && (
              <HumanCheck mode="rotate" apiUrl={svc.settings.apiUrl} {...(r.sessionId ? { sessionId: r.sessionId } : {})} signal={s.draft.signal} onResult={(res) => void r.onHuman(res)} onCancel={r.cancel} />
            )}
            {s.step === "working" && <Alert variant="info">{STAGE_TEXT[s.stage] ?? "Working…"}</Alert>}
            {s.step === "done" && (
              <Alert variant="success" title="Keys rotated">
                {s.path === "attested"
                  ? "Your name points at the new keys, with a World ID attestation."
                  : "Your name points at the new keys. Ask your employer to approve the change."}
              </Alert>
            )}
          </div>
        </Card>

        {r.rotations.length > 0 && (
          <Card>
            <CardHeader title="Rotation history" />
            <ul className="divide-y text-sm">
              {r.rotations.map((x) => (
                <li key={x.generation} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2">
                  <span>
                    Generation {x.generation} · {relativeTime(x.at)}
                  </span>
                  <span className="flex items-center gap-2">
                    {x.path === "attested" ? <Badge tone="success">Attested</Badge> : <Badge tone="warning">Needs employer</Badge>}
                    {x.setTextTx && <Addr address={x.setTextTx} />}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>
    </>
  );
}
