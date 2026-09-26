import { ShieldCheck } from "lucide-react";
import { Alert, Button } from "../ui/kit.js";

/**
 * Shown on Send when the guard blocks an identifiable destination: the exit is the primary way out.
 * Props-only, so another UI can reuse or replace it. The override checkbox stays below as the
 * secondary, scary path (GuardDecision).
 */
export function ExitOffer({ onExit, disabledReason }: { onExit: () => void; disabledReason?: string | undefined }) {
  return (
    <Alert
      variant="info"
      title="Cash out without revealing which payments were yours"
      action={
        <div className="space-y-1">
          <Button onClick={onExit} disabled={disabledReason !== undefined} data-testid="exit-offer">
            <ShieldCheck className="size-4" aria-hidden /> Exit through Privacy Pools
          </Button>
          {disabledReason && <p className="text-xs text-muted-foreground">{disabledReason}</p>}
        </div>
      }
    >
      Each stealth address bridges to itself and deposits into a screened pool on its own. The withdrawal to this
      wallet can't be matched to a specific deposit, so coworkers can't tell which payroll lines were yours.
    </Alert>
  );
}
