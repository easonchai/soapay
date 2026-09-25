import { ScanFace, ShieldCheck } from "lucide-react";
import { Alert, Button } from "../ui/kit.js";

/** World ID actions (docs/mvp-spec.md §5). */
export type HumanAction = "soapay-enroll" | "soapay-meta-update";

export type HumanVerificationProps = {
  action: HumanAction;
  /** Binds the proof to this registrant (IDKit `signal`). */
  signal: string;
  /** `proof` is passed verbatim as the `proof` field of POST /register and POST /names. */
  onVerified: (proof: unknown) => void;
  /** Placeholder only: lets testnet users continue until IDKit lands. */
  allowSkip?: boolean;
  busy?: boolean;
};

/**
 * Proof-of-human step.
 *
 * TODO(world-id): replace the placeholder with IDKit. Render `<IDKitWidget app_id={WORLD_APP_ID}
 * action={action} signal={signal} verification_level="orb|device" onSuccess={(r) => onVerified(r)} />`
 * (or the IDKit v2 hook). The proof is verified server-side by apps/api's HumanVerifier; this component
 * never verifies it. Nothing identifying is stored here: the API keeps nullifier ↔ name only.
 */
export function HumanVerification({ action, signal, onVerified, allowSkip = true, busy }: HumanVerificationProps) {
  const purpose =
    action === "soapay-enroll"
      ? "One sponsored registration and one name per person keeps the gas relayer from being drained."
      : "Changing where your salary goes needs the same person who enrolled. A stolen key alone can't redirect pay.";
  return (
    <div className="space-y-4" data-testid="human-verification" data-action={action} data-signal={signal}>
      <div className="flex items-start gap-3">
        <div className="rounded-full bg-accent p-2.5">
          <ScanFace className="size-5 text-accent-foreground" aria-hidden />
        </div>
        <div className="space-y-1">
          <p className="font-medium">Prove you're a unique person</p>
          <p className="text-sm text-muted-foreground">{purpose}</p>
          <p className="text-sm text-muted-foreground">
            World ID proves uniqueness only. No passport, no selfie, and Soapay never learns who you are.
          </p>
        </div>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Button disabled title="World ID (IDKit) integration is coming" className="sm:flex-1">
          <ShieldCheck className="size-4" aria-hidden />
          Verify with World ID
        </Button>
        {allowSkip && (
          <Button variant="outline" onClick={() => onVerified(undefined)} loading={busy ?? false} className="sm:flex-1">
            Continue without it (testnet)
          </Button>
        )}
      </div>
      <Alert variant="info">World ID verification isn't wired up yet. On testnet you can continue without it.</Alert>
    </div>
  );
}
