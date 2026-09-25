import { useState } from "react";
import { KeyRound, ShieldCheck, UserRound } from "lucide-react";
import { useRotation } from "../hooks/useRotation.js";
import { useServices } from "../services/ServicesProvider.js";
import { Addr, Alert, Badge, Button, Card, CardHeader, CopyButton, EmptyState, PageHeader } from "../ui/kit.js";
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

export function NameSettings() {
  const r = useRotation();
  const svc = useServices();
  const v = useUnlocked();
  const [attaching, setAttaching] = useState(false);
  const s = r.state;

  if (!r.name) {
    return (
      <>
        <PageHeader title="Name" />
        <Card>
          <EmptyState icon={UserRound} title="No name yet">
            You're sharing your raw meta-address. A name lets you change keys later without re-sending anything to your employer.
          </EmptyState>
        </Card>
      </>
    );
  }

  return (
    <>
      <PageHeader title={r.name.name} description="Your employer pays this name. It points to your current meta-address." action={<CopyButton value={r.name.name} />} />
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
            ) : (
              <>
                <p>No World ID session is linked. You can still change keys, but your employer must approve the change by hand before paying you again.</p>
                {attaching ? (
                  <HumanCheck
                    mode="create-session"
                    apiUrl={svc.settings.apiUrl}
                    signal={sessionSignal(v.keys.registrantAddress)}
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
                <Button onClick={r.start} disabled={!!r.pending}>
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
