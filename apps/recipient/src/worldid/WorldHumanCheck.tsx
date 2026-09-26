import { useState } from "react";
import { HumanCheck as WorldIdHumanCheck } from "@soapay/worldid-react";
import { ScanFace, ShieldCheck } from "lucide-react";
import { Button } from "../ui/kit.js";
import type { HumanCheckProps, HumanCheckResult } from "./types.js";

/** Shared explainer + buttons; `open` is what the real and the mock component each do. */
export function HumanCheckFrame({ mode, onCancel, busy, onOpen }: Pick<HumanCheckProps, "mode" | "onCancel"> & { busy: boolean; onOpen: () => void }) {
  const create = mode === "create-session";
  return (
    <div className="space-y-4" data-testid="human-check" data-mode={mode}>
      <div className="flex items-start gap-3">
        <div className="rounded-full bg-accent p-2.5">
          <ScanFace className="size-5 text-accent-foreground" aria-hidden />
        </div>
        <div className="space-y-1">
          <p className="font-medium">{create ? "Proof of Human with World ID" : "Prove it's still you"}</p>
          <p className="text-sm text-muted-foreground">
            {create
              ? "Links a private World ID session to your name, so you can move it to new keys later without asking your employer."
              : "The same person who set up recovery must confirm this change. A stolen key alone can't redirect your pay."}
          </p>
          <p className="text-sm text-muted-foreground">No passport, no Orb. Soapay never learns who you are.</p>
        </div>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Button onClick={onOpen} loading={busy} className="sm:flex-1">
          <ShieldCheck className="size-4" aria-hidden />
          {create ? "Set up with World ID" : "Confirm with World ID"}
        </Button>
        {onCancel && (
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        )}
      </div>
    </div>
  );
}

/** The real `@soapay/worldid-react` component (IDKit session widget), driven in controlled mode. */
export function WorldHumanCheck(props: HumanCheckProps) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const sessionId = props.sessionId as `session_${string}` | undefined;
  return (
    <>
      <HumanCheckFrame mode={props.mode} busy={busy || open} onOpen={() => setOpen(true)} {...(props.onCancel ? { onCancel: props.onCancel } : {})} />
      <WorldIdHumanCheck
        mode={props.mode}
        apiUrl={props.apiUrl}
        sessionId={sessionId}
        signal={props.signal}
        open={open}
        onOpenChange={setOpen}
        onResult={async (r) => {
          setBusy(true);
          try {
            await props.onResult(r as unknown as HumanCheckResult);
          } finally {
            setBusy(false);
            setOpen(false);
          }
        }}
        onCancel={() => setOpen(false)}
        onError={(e) => {
          setOpen(false);
          props.onError?.(e);
        }}
      />
    </>
  );
}
