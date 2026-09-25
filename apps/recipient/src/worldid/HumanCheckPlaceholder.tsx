import { ScanFace, ShieldCheck } from "lucide-react";
import { Alert, Button } from "../ui/kit.js";
import type { HumanCheckProps } from "./types.js";

/**
 * Stand-in for `@soapay/worldid-react`'s `<HumanCheck>`, with the SAME props. It verifies nothing:
 * on testnet it lets the user continue with `{ placeholder: true }`, and the real API refuses that
 * wherever World ID is enforced. Swap it out in ./index.ts.
 */
export function HumanCheckPlaceholder({ mode, signal, onResult, onCancel }: HumanCheckProps) {
  const purpose =
    mode === "enroll"
      ? "One sponsored registration and one name per person keeps the gas relayer from being drained."
      : "Changing where your salary goes needs the same person who enrolled. A stolen key alone can't redirect pay.";
  return (
    <div className="space-y-4" data-testid="human-check" data-mode={mode} data-signal={signal}>
      <div className="flex items-start gap-3">
        <div className="rounded-full bg-accent p-2.5">
          <ScanFace className="size-5 text-accent-foreground" aria-hidden />
        </div>
        <div className="space-y-1">
          <p className="font-medium">{mode === "enroll" ? "Prove you're a unique person" : "Prove it's still you"}</p>
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
        <Button variant="outline" onClick={() => onResult({ placeholder: true })} className="sm:flex-1">
          Continue without it (testnet)
        </Button>
        {onCancel && (
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        )}
      </div>
      <Alert variant="info">World ID isn't wired up yet. On testnet you can continue without it.</Alert>
    </div>
  );
}
