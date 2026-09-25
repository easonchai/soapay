import { ScanFace, ShieldCheck } from "lucide-react";
import { Alert, Button } from "../ui/kit.js";
import type { HumanCheckProps } from "./types.js";

/**
 * Stand-in for `@soapay/worldid-react`'s `<HumanCheck>`, with the SAME props. It verifies nothing:
 * on testnet it lets the user continue with `{ placeholder: true }`, which the real API never attests
 * (a rotation then needs the employer's manual approval). Swap it out in ./index.ts.
 */
export function HumanCheckPlaceholder({ mode, signal, onResult, onCancel }: HumanCheckProps) {
  const create = mode === "create-session";
  return (
    <div className="space-y-4" data-testid="human-check" data-mode={mode} data-signal={signal}>
      <div className="flex items-start gap-3">
        <div className="rounded-full bg-accent p-2.5">
          <ScanFace className="size-5 text-accent-foreground" aria-hidden />
        </div>
        <div className="space-y-1">
          <p className="font-medium">{create ? "Selfie Check with World ID" : "Prove it's still you"}</p>
          <p className="text-sm text-muted-foreground">
            {create
              ? "Links a private World ID session to your name, so you can change your keys later without asking your employer."
              : "The same person who set up recovery must confirm this change. A stolen key alone can't redirect your pay."}
          </p>
          <p className="text-sm text-muted-foreground">No passport, no Orb. Soapay never learns who you are.</p>
        </div>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Button disabled title="World ID (IDKit) integration is coming" className="sm:flex-1">
          <ShieldCheck className="size-4" aria-hidden />
          Verify with World ID
        </Button>
        <Button variant="outline" onClick={() => onResult({ placeholder: true })} className="sm:flex-1">
          Continue unverified (testnet)
        </Button>
        {onCancel && (
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        )}
      </div>
      <Alert variant="info">World ID isn't wired up in this build. Unverified results never get an attestation.</Alert>
    </div>
  );
}
