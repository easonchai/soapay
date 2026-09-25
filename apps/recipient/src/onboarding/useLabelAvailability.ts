import { useEffect, useState } from "react";
import { isValidLabel } from "@soapay/sdk";
import type { Address } from "viem";
import type { Api } from "../api/client.js";

export type LabelStatus =
  | { kind: "idle" }
  | { kind: "invalid"; message: string }
  | { kind: "checking" }
  | { kind: "available" }
  | { kind: "yours" }
  | { kind: "taken" }
  | { kind: "error"; message: string };

export function labelProblem(label: string): string | null {
  if (label.length === 0) return null;
  if (label.length < 3) return "Use at least 3 characters.";
  if (label.length > 32) return "Use at most 32 characters.";
  if (!/^[a-z0-9-]+$/.test(label)) return "Use lowercase letters, digits and hyphens only.";
  if (!isValidLabel(label)) return "Hyphens can't start or end a name, or sit at positions 3–4.";
  return null;
}

/** Debounced GET /names/:label. */
export function useLabelAvailability(api: Api, label: string, registrant: Address, delayMs = 350): LabelStatus {
  const [status, setStatus] = useState<LabelStatus>({ kind: "idle" });
  useEffect(() => {
    if (!label) return setStatus({ kind: "idle" });
    const problem = labelProblem(label);
    if (problem) return setStatus({ kind: "invalid", message: problem });
    setStatus({ kind: "checking" });
    let live = true;
    const t = setTimeout(() => {
      api
        .getName(label)
        .then((rec) => {
          if (!live) return;
          if (!rec) setStatus({ kind: "available" });
          else setStatus({ kind: rec.registrant.toLowerCase() === registrant.toLowerCase() ? "yours" : "taken" });
        })
        .catch((e: unknown) => live && setStatus({ kind: "error", message: e instanceof Error ? e.message : String(e) }));
    }, delayMs);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [api, label, registrant, delayMs]);
  return status;
}
