import type { ReactNode } from "react";
import type { SpendPlan } from "@soapay/sdk";
import { Alert, Checkbox } from "../ui/kit.js";
import { shortAddr } from "../ui/format.js";

const TX_HASH = /0x[0-9a-fA-F]{64}/g;

/**
 * Guard copy names pay runs by their tx hash. Shows each hash short (0x681f…9e2a), linked to the
 * explorer when `txUrl` gives a link, instead of 66 raw characters (docs/demo-flow.md gap 7).
 */
export function linkTxHashes(text: string, txUrl?: (hash: string) => string | undefined): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(TX_HASH)) {
    const i = m.index ?? 0;
    if (i > last) out.push(text.slice(last, i));
    const url = txUrl?.(m[0]);
    const label = shortAddr(m[0], 4);
    out.push(
      url ? (
        <a key={i} href={url} target="_blank" rel="noreferrer" title={m[0]}>
          {label}
        </a>
      ) : (
        <code key={i} title={m[0]}>
          {label}
        </code>
      ),
    );
    last = i + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/**
 * Renders the privacy guard's decision for a spend. Props-only, so any UI can reuse or replace it.
 * - allow: nothing to confirm
 * - warn: shows the warnings; sending is allowed
 * - block: sending is disabled until the user ticks the override (which re-plans the spend)
 */
export function GuardDecision({
  plan,
  override,
  onOverride,
  txUrl,
}: {
  plan: SpendPlan;
  override: boolean;
  onOverride: (v: boolean) => void;
  /** Explorer link for a pay-run tx hash named in the guard's copy (omit in mock mode). */
  txUrl?: ((hash: string) => string | undefined) | undefined;
}) {
  const warnings = plan.warnings.filter((w) => w.code !== "override-used");
  const blocked = plan.decision === "block";
  const overridden = plan.override;
  return (
    <div className="space-y-3" data-testid="guard-decision" data-decision={plan.decision}>
      {plan.decision === "allow" && (
        <Alert variant="success" title="No new links">
          This spend doesn't connect any of your stealth addresses to each other or to an identifiable wallet.
        </Alert>
      )}
      {plan.decision === "warn" && (
        <Alert variant="warning" title={overridden ? "Sending with override" : "Privacy warning"}>
          <p>{linkTxHashes(plan.reason, txUrl)}</p>
        </Alert>
      )}
      {blocked && (
        <Alert variant="destructive" title="Blocked by the privacy guard">
          <p>{linkTxHashes(plan.reason, txUrl)}</p>
        </Alert>
      )}
      {warnings.length > 0 && (
        <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
          {warnings.map((w) => (
            <li key={w.code}>{linkTxHashes(w.message, txUrl)}</li>
          ))}
        </ul>
      )}
      {(blocked || overridden) && (
        <Checkbox
          tone="destructive"
          checked={override}
          onChange={onOverride}
          label="Send anyway. I understand coworkers may be able to link these payments to me."
          description="The override is recorded in your local history."
        />
      )}
    </div>
  );
}

/** Whether the Send button is enabled for a plan. */
export function canSend(plan: SpendPlan | null): boolean {
  return plan !== null && plan.decision !== "block";
}
