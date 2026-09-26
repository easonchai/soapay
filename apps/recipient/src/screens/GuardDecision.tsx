import type { SpendPlan } from "@soapay/sdk";
import { Alert, Checkbox } from "../ui/kit.js";

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
}: {
  plan: SpendPlan;
  override: boolean;
  onOverride: (v: boolean) => void;
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
          <p>{plan.reason}</p>
        </Alert>
      )}
      {blocked && (
        <Alert variant="destructive" title="Blocked by the privacy guard">
          <p>{plan.reason}</p>
        </Alert>
      )}
      {warnings.length > 0 && (
        <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
          {warnings.map((w) => (
            <li key={w.code}>{w.message}</li>
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
