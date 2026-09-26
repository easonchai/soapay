import { useState } from "react";
import { keccak256, toHex } from "viem";
import { WORLD_ID_ACTION, worldIdSignalHash } from "@soapay/sdk";
import { HumanCheckFrame } from "./WorldHumanCheck.js";
import type { HumanCheckProps, HumanCheckResult } from "./types.js";

/** The mock's one World ID: the same "person" every time, unless a test picks another. */
export const MOCK_IDENTITY = "mock-human";

/** A deterministic nullifier per mock identity (stable per human, like World ID's per RP and action). */
export function mockNullifier(identity = MOCK_IDENTITY): `0x${string}` {
  return keccak256(toHex(`mock:worldid:${identity}`));
}

/**
 * A result shaped like IDKit's v4 one-time Proof of Human result (D-58). The mock API accepts it;
 * the real API never would (the portal check fails).
 */
export function mockProofResult(p: Pick<HumanCheckProps, "signal">, identity = MOCK_IDENTITY): HumanCheckResult {
  return {
    protocol_version: "4.0",
    nonce: keccak256(toHex(`mock:nonce:${p.signal}:${Math.random()}`)),
    action: WORLD_ID_ACTION,
    environment: "staging",
    responses: [
      {
        identifier: "proof_of_human",
        issuer_schema_id: 1,
        signal_hash: worldIdSignalHash(p.signal),
        nullifier: mockNullifier(identity),
        proof: [],
        expires_at_min: 0,
      },
    ],
    mock: true,
  };
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
          await props.onResult(mockProofResult(props));
        } finally {
          setBusy(false);
        }
      }}
    />
  );
}
