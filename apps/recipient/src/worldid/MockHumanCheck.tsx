import { useState } from "react";
import { keccak256, toHex } from "viem";
import { HumanCheckFrame } from "./WorldHumanCheck.js";
import type { HumanCheckProps, HumanCheckResult } from "./types.js";

/** A result shaped like IDKit's session result. The mock API accepts it; the real API never would. */
export function mockSessionResult(p: Pick<HumanCheckProps, "mode" | "sessionId" | "signal">): HumanCheckResult {
  const id = p.mode === "rotate" && p.sessionId ? p.sessionId : `session_${keccak256(toHex(`mock:${p.signal}`)).slice(2, 34)}`;
  return { session_id: id, protocol_version: "4.0", mock: true, signal: p.signal };
}

/** VITE_MOCK_API only: same props and look as the real component, no World App needed. */
export function MockHumanCheck(props: HumanCheckProps) {
  const [busy, setBusy] = useState(false);
  return (
    <HumanCheckFrame
      mode={props.mode}
      busy={busy}
      {...(props.onCancel ? { onCancel: props.onCancel } : {})}
      onOpen={async () => {
        setBusy(true);
        await new Promise((r) => setTimeout(r, 700));
        try {
          await props.onResult(mockSessionResult(props));
        } finally {
          setBusy(false);
        }
      }}
    />
  );
}
