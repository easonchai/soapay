import { useState } from "react";
import { keccak256, toHex } from "viem";
import { HumanCheckFrame } from "./WorldHumanCheck.js";
import type { HumanCheckProps, HumanCheckResult } from "./types.js";

/**
 * A result shaped like IDKit's v4 session result (`IDKitResultSession`, D-59): a new session for
 * `create-session`, the saved one for `rotate`. The mock API accepts it; the real API never would.
 */
export function mockSessionResult(p: Pick<HumanCheckProps, "mode" | "sessionId" | "signal">): HumanCheckResult {
  const id = p.mode === "rotate" && p.sessionId ? p.sessionId : `session_${keccak256(toHex(`mock:${p.signal}`)).slice(2, 34)}`;
  const nonce = keccak256(toHex(`mock:nonce:${p.signal}:${Math.random()}`));
  return {
    protocol_version: "4.0",
    nonce,
    session_id: id,
    environment: "staging",
    responses: [
      {
        identifier: "proof_of_human",
        issuer_schema_id: 1,
        proof: [],
        session_nullifier: [keccak256(toHex(`mock:sn:${nonce}`)), "0x0"],
        expires_at_min: 0,
      },
    ],
    mock: true,
    signal: p.signal,
  };
}

/** VITE_MOCK_API only: same props and look as the real component, no World App needed. */
export function MockHumanCheck(props: HumanCheckProps) {
  const [busy, setBusy] = useState(false);
  return (
    <HumanCheckFrame
      mode={props.mode}
      {...(props.compact ? { compact: true } : {})}
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
