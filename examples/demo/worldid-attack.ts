// Pure logic for `pnpm demo:attacker-worldid` (examples/demo/worldid-attacker.ts): argument parsing, the
// proofs the thief presents, and the plain-English lines the presenter reads. No network, no keys.
// Tested by worldid-attack.test.ts.

/** What the thief presents as their World ID proof. */
export type ProofMode =
  /** A session proof from a different World ID session than the one linked to the name (their own). */
  | "other-person"
  /** The victim's own genuine proof from linking the name, captured and replayed. */
  | "replay";

export type Args =
  | { kind: "attack"; label: string; mode: ProofMode }
  | { kind: "setup"; label: string }
  | { kind: "help" }
  | { kind: "error"; message: string };

export const USAGE =
  "usage: pnpm demo:attacker-worldid [label] [--replay]   (the thief tries to rotate <label>.soapay.eth with a World ID proof that isn't the victim's)\n" +
  "       pnpm demo:attacker-worldid [label] --setup      (rehearsal, once: link the victim's name to YOUR real World ID)";

export function parseArgs(argv: string[], defaultLabel: string): Args {
  const flags = argv.filter((a) => a.startsWith("--"));
  const pos = argv.filter((a) => !a.startsWith("--"));
  if (flags.includes("--help") || flags.includes("-h")) return { kind: "help" };
  const unknown = flags.filter((f) => !["--setup", "--replay"].includes(f));
  if (unknown.length) return { kind: "error", message: `unknown flag ${unknown.join(" ")}` };
  if (pos.length > 1) return { kind: "error", message: `one label at most (got ${pos.join(" ")})` };
  const label = (pos[0] ?? defaultLabel).toLowerCase();
  if (!/^[a-z0-9-]{1,63}$/.test(label)) return { kind: "error", message: `invalid label ${pos[0]}` };
  if (flags.includes("--setup")) {
    if (flags.includes("--replay")) return { kind: "error", message: "--setup and --replay don't combine" };
    return { kind: "setup", label };
  }
  return { kind: "attack", label, mode: flags.includes("--replay") ? "replay" : "other-person" };
}

const SESSION_ID = /^session_[0-9a-fA-F]+$/;
const hex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

/**
 * A World ID 4.0 session result (IDKit's `IDKitResultSession` shape) for a session that is NOT the
 * victim's: a random `session_id` and session nullifier, Proof of Human, the API's environment, and the
 * nonce of a real RP context the thief asked Soapay for (bound to this exact rotation). It is not a
 * zero-knowledge proof: without a second human we can't make a genuine proof of another person's
 * session. The API compares the session id with the name's linked one BEFORE it contacts World's
 * Developer Portal, which is exactly where a genuine proof from another person's World ID is refused too.
 */
export function otherPersonSessionResult(p: {
  nonce: string;
  environment: string;
  /** The name's linked session, when the thief read it back; guarantees the forged id differs. */
  victimSessionId?: string;
  random?: (n: number) => Uint8Array;
}): Record<string, unknown> {
  const random = p.random ?? ((n: number) => crypto.getRandomValues(new Uint8Array(n)));
  let sessionId = `session_${hex(random(64))}`;
  while (p.victimSessionId && sessionId.toLowerCase() === p.victimSessionId.toLowerCase()) sessionId = `session_${hex(random(64))}`;
  return {
    protocol_version: "4.0",
    nonce: p.nonce,
    session_id: sessionId,
    environment: p.environment,
    responses: [
      {
        identifier: "proof_of_human",
        issuer_schema_id: 1,
        proof: [`0x${hex(random(32))}`, `0x${hex(random(32))}`, `0x${hex(random(32))}`, `0x${hex(random(32))}`],
        session_nullifier: [`0x${hex(random(31))}`, "0x0"],
        expires_at_min: 0,
      },
    ],
  };
}

/** Checks that a stored proof looks like the IDKit session result it should be, and returns its session id. */
export function capturedSessionId(result: unknown): string {
  const id = (result as { session_id?: unknown } | null)?.session_id;
  if (typeof id !== "string" || !SESSION_ID.test(id)) throw new Error("the captured World ID proof has no session_id");
  return id;
}

/** `session_ab12…9f` for display: enough to compare, not the whole id. */
export const shortSession = (id: string) => (id.length > 22 ? `${id.slice(0, 14)}…${id.slice(-4)}` : id);

/** The API's refusal codes for a rotation, in words the presenter can read out. */
export const REFUSAL_WORDS: Record<string, string> = {
  session_mismatch: "The proof comes from a different World ID than the one linked to this name: a different person. Refused.",
  session_replayed: "That exact proof was already used once. A captured proof can't be replayed. Refused.",
  request_used: "That World ID request was already answered once. Replays are refused.",
  no_session: "This name has no World ID link, so no proof can approve the change; only the employer can, by hand.",
  session_cooldown: "The World ID link is too new to approve a key change yet (the 72-hour wait).",
  proof_missing: "No World ID proof at all. Refused.",
  proof_invalid: "World's Developer Portal rejected the proof. Refused.",
  signal_mismatch: "The proof was made for a different change. Refused.",
  unknown_request: "Soapay never asked for this proof. Refused.",
  request_expired: "The World ID request expired. Refused.",
  proof_malformed: "Not a World ID session proof. Refused.",
  wrong_credential: "Not a Proof of Human credential. Refused.",
  environment_mismatch: "The proof is from the wrong World ID environment. Refused.",
  worldid_unavailable: "Soapay couldn't reach World ID; nothing was judged.",
  worldid_disabled: "World ID is disabled on this API; nothing can be attested.",
};

export function explainRefusal(code: string): string {
  return REFUSAL_WORDS[code] ?? "The API refused to attest the change.";
}

/** What this run can honestly claim, for the closing lines. */
export type Readback = {
  name: string;
  /** The ENS `stealth` record now (on-chain, Sepolia). */
  ensMeta: string | null;
  /** The meta-address the name pointed at before the attempt (and the payer's pin). */
  beforeMeta: string;
  attackerMeta: string;
  /** Attestations the API serves for the name, newest first. */
  attestations: { newMeta: string }[];
  /** Attestations before the attempt. */
  attestationsBefore: number;
  /** The company app's pin check (SDK checkMetaPin) with the pre-attempt pin. */
  pinState: string;
};

const canon = (m: string | null | undefined) => (m ?? "").trim().toLowerCase();

/** The read-back lines and whether they show "nothing changed". */
export function readbackVerdict(r: Readback): { unchanged: boolean; lines: string[] } {
  const ensSame = canon(r.ensMeta) === canon(r.beforeMeta);
  const noNew = r.attestations.length === r.attestationsBefore && !r.attestations.some((a) => canon(a.newMeta) === canon(r.attackerMeta));
  const pinOk = r.pinState === "ok";
  const lines = [
    ensSame ? `ENS (on-chain) ${r.name} stealth record: unchanged` : `ENS (on-chain) ${r.name} stealth record: DIFFERENT from before the attempt`,
    noNew
      ? `Soapay attestation feed: no attestation issued (${r.attestations.length} on record, none for the thief's keys)`
      : "Soapay attestation feed: a NEW attestation appeared; this must never happen",
    pinOk ? "Company app pin check (same SDK check as Resolve names): ok, still Verified" : `Company app pin check: ${r.pinState}`,
  ];
  return { unchanged: ensSame && noNew && pinOk, lines };
}

/** The honest one-liner about what was simulated, printed with every run. */
export function honestyLine(mode: ProofMode): string {
  return mode === "replay"
    ? "Real: the stolen phrase, the signed rotation, the World ID proof (the victim's own, captured when the name was linked), the live API's refusal, and the on-chain read-back. Simulated: only that a thief captured that proof."
    : "Real: the stolen phrase, the signed rotation, the RP request from the live API, its refusal and the on-chain read-back. Simulated: the thief's World ID proof. With no second human here it is a proof-shaped answer for another World ID session; the API refuses it on the session id, the same check (before any call to World) that refuses a genuine proof from another person's World ID.";
}
