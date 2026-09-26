/**
 * Why a World ID-attested rotation was refused, in plain words (docs/worldid.md, "Failure path").
 *
 * Two sources refuse a rotation at the World ID step:
 * - the Soapay API (`POST /names/:label/rotation`), with the codes from apps/api/src/worldid/verifier.ts
 *   and routes/rotation.ts, e.g. `403 session_mismatch` when the proof comes from a different person's
 *   World ID than the one linked to the name;
 * - the World ID app itself, when it can't prove the name's session (`proveSession`) and answers with
 *   an IDKit error instead of a proof.
 *
 * Either way nothing changed: the API signed no attestation, the vault saved no pending rotation and
 * no new key generation, and the ENS record still points at the current keys. The screen says so.
 */
import { ApiError } from "../../api/client.js";

export type RefusalKind =
  /** A different human's World ID (the thief's own). */
  | "different-person"
  /** A proof (or RP request) that was already used. */
  | "replay"
  /** The name has no World ID link, or the link is still in its waiting period. */
  | "no-link"
  | "waiting"
  /** A proof that doesn't answer this exact change, or has expired. */
  | "wrong-request"
  /** The World ID step wasn't completed, or the proof isn't a valid Proof of Human session proof. */
  | "invalid-proof"
  /** World ID couldn't be checked at all (nothing was judged). */
  | "unavailable";

export type RotationRefusal = {
  code: string;
  kind: RefusalKind;
  source: "api" | "world-app";
  title: string;
  reason: string;
};

type Copy = { kind: RefusalKind; title: (name: string) => string; reason: string };

/** Every World ID refusal code the rotation route can answer with (apps/api verifier.ts + routes/rotation.ts). */
export const API_REFUSALS: Record<string, Copy> = {
  session_mismatch: {
    kind: "different-person",
    title: (n) => `Refused: this World ID isn't the person linked to ${n}`,
    reason:
      "The World ID that answered belongs to a different person from the one who linked this name. Only that person can approve moving the name to new keys, so a stolen recovery phrase alone can't redirect future pay.",
  },
  no_session: {
    kind: "no-link",
    title: (n) => `Refused: ${n} has no World ID link`,
    reason:
      "Soapay holds no World ID session for this name, so no World ID can approve a key change. A change without it waits for the employer to approve it by hand.",
  },
  session_cooldown: {
    kind: "waiting",
    title: (n) => `Refused: the World ID link on ${n} is too new`,
    reason:
      "A World ID linked after the name was claimed can approve a key change only after a 72-hour wait, so someone holding a stolen key can't link their own World ID and switch at once.",
  },
  session_replayed: {
    kind: "replay",
    title: () => "Refused: this World ID proof was already used",
    reason: "Each proof works once. A copied or replayed proof can't approve a change; a real change needs a fresh confirmation in the World ID app.",
  },
  request_used: {
    kind: "replay",
    title: () => "Refused: this World ID request was already used",
    reason: "Soapay's request behind this proof was already answered once. A replayed answer can't approve a change.",
  },
  unknown_request: {
    kind: "wrong-request",
    title: () => "Refused: Soapay didn't ask for this proof",
    reason: "The proof doesn't answer a request Soapay issued. Start the change again to get a fresh request.",
  },
  signal_mismatch: {
    kind: "wrong-request",
    title: () => "Refused: this proof was made for a different change",
    reason: "A World ID proof is bound to one exact change (this name, these new keys, this deadline). This one was made for another.",
  },
  request_expired: {
    kind: "wrong-request",
    title: () => "Refused: the World ID request expired",
    reason: "The request timed out before the proof arrived. Start the change again.",
  },
  expired: {
    kind: "wrong-request",
    title: () => "Refused: this key change expired",
    reason: "The signed change passed its deadline. Start the change again.",
  },
  proof_invalid: {
    kind: "invalid-proof",
    title: () => "Refused: World ID rejected the proof",
    reason: "World's Developer Portal didn't verify this proof.",
  },
  proof_cancelled: {
    kind: "invalid-proof",
    title: () => "Refused: World ID wasn't completed",
    reason: "The World ID app cancelled or failed, so there is no proof to check.",
  },
  proof_missing: {
    kind: "invalid-proof",
    title: () => "Refused: no World ID proof",
    reason: "A key change on a name linked to World ID needs a proof from the linked person.",
  },
  proof_malformed: {
    kind: "invalid-proof",
    title: () => "Refused: not a World ID session proof",
    reason: "The answer isn't a proof of the World ID session linked to this name.",
  },
  legacy_proof_unsupported: {
    kind: "invalid-proof",
    title: () => "Refused: old World ID proof format",
    reason: "Only World ID 4.0 session proofs are accepted.",
  },
  wrong_credential: {
    kind: "invalid-proof",
    title: () => "Refused: not a Proof of Human credential",
    reason: "A key change needs World ID's Proof of Human credential.",
  },
  environment_mismatch: {
    kind: "invalid-proof",
    title: () => "Refused: proof from another World ID environment",
    reason: "The proof came from World ID staging and this server expects production, or the other way round.",
  },
  worldid_unavailable: {
    kind: "unavailable",
    title: () => "World ID couldn't be checked right now",
    reason: "Soapay couldn't reach World ID. Nothing was judged; try again shortly.",
  },
  worldid_disabled: {
    kind: "unavailable",
    title: () => "World ID is turned off on this server",
    reason: "This Soapay server doesn't check World ID, so it can't attest a key change.",
  },
  attester_disabled: {
    kind: "unavailable",
    title: () => "Soapay can't attest key changes right now",
    reason: "The attester isn't configured on this server. Nothing was judged.",
  },
};

/** World ID app answers that are "you backed out", not a refusal: go back quietly. */
const WORLD_APP_CANCEL = new Set(["user_rejected", "cancelled"]);
/** World ID app / connection problems where nothing was judged. */
const WORLD_APP_UNAVAILABLE = new Set(["connection_failed", "timeout", "api_unreachable", "start_failed", "invalid_network", "inclusion_proof_pending"]);

const codeOf = (e: unknown): string | undefined => {
  const c = (e as { code?: unknown } | null)?.code;
  return typeof c === "string" ? c : undefined;
};

/** The API's answer to POST /names/:label/rotation, as a refusal; null for errors that aren't World ID refusals. */
export function refusalFromApi(e: unknown, name: string): RotationRefusal | null {
  if (!(e instanceof ApiError)) return null;
  const copy = API_REFUSALS[e.code];
  if (!copy) return null;
  return { code: e.code, kind: copy.kind, source: "api", title: copy.title(name), reason: copy.reason };
}

/**
 * The World ID app couldn't prove the name's session (it answered an IDKit error, not a proof).
 * Null when the person just cancelled. Soapay never saw a proof, so it signed nothing.
 */
export function refusalFromWorldApp(e: unknown, name: string): RotationRefusal | null {
  const code = codeOf(e) ?? "unknown";
  if (WORLD_APP_CANCEL.has(code)) return null;
  if (code === "no_session") {
    const copy = API_REFUSALS.no_session!;
    return { code, kind: copy.kind, source: "world-app", title: copy.title(name), reason: copy.reason };
  }
  if (WORLD_APP_UNAVAILABLE.has(code) || code.startsWith("http_")) {
    return {
      code,
      kind: "unavailable",
      source: "world-app",
      title: "World ID couldn't be checked right now",
      reason: `The World ID step didn't finish (${code}). Nothing was judged; try again.`,
    };
  }
  return {
    code,
    kind: "different-person",
    source: "world-app",
    title: `Refused: World ID didn't confirm the person linked to ${name}`,
    reason: `The World ID app couldn't prove the World ID session linked to this name (it answered "${code}"). Only the World ID of the person who linked the name can prove it; any other World ID never can.`,
  };
}

/** Any refusal from the World ID step of a rotation. */
export function rotationRefusal(e: unknown, name: string, source: "api" | "world-app"): RotationRefusal | null {
  return source === "api" ? refusalFromApi(e, name) : refusalFromWorldApp(e, name);
}
