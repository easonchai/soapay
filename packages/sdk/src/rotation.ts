import { keccak256, stringToBytes, type Address, type Hex, type TypedDataDomain } from "viem";
import { formatMetaAddressURI } from "./keys.js";
import { isValidLabel } from "./registration.js";

// ---------------------------------------------------------------------------
// Key rotation under option A (docs/mvp-spec.md §2.1). The API, the recipient app and
// the sender app must all use these exact formats.
// ---------------------------------------------------------------------------

export const rotationClaimTypes = {
  RotationClaim: [
    { name: "label", type: "string" },
    { name: "oldMeta", type: "string" },
    { name: "newMeta", type: "string" },
    { name: "deadline", type: "uint256" },
  ],
} as const;

export const metaRotationTypes = {
  MetaRotation: [
    { name: "label", type: "string" },
    { name: "oldMeta", type: "string" },
    { name: "newMeta", type: "string" },
    { name: "verifiedAt", type: "uint256" },
  ],
} as const;

/** RotationClaim domain: the same name as NameClaim, `chainId` = the API's CHAIN_ID. */
export function rotationClaimDomain(chainId: number) {
  return { name: "Soapay Names", version: "1", chainId } as const satisfies TypedDataDomain;
}

export function metaRotationDomain(chainId: number) {
  return { name: "Soapay Attestations", version: "1", chainId } as const satisfies TypedDataDomain;
}

/**
 * AttachSession (signed by the registrant key): binds a World ID session to a name that was
 * claimed without one. Same domain as NameClaim / RotationClaim.
 */
export const attachSessionTypes = {
  AttachSession: [
    { name: "label", type: "string" },
    { name: "sessionId", type: "string" },
    { name: "deadline", type: "uint256" },
  ],
} as const;

export type AttachSession = {
  label: string;
  /** The IDKit `session_<hex>` id, unchanged. */
  sessionId: string;
  /** Unix seconds. */
  deadline: bigint;
  chainId: number;
};

export function attachSessionTypedData(a: AttachSession) {
  if (!isValidLabel(a.label)) throw new Error(`Soapay: invalid label "${a.label}"`);
  if (!/^session_[0-9a-fA-F]+$/.test(a.sessionId)) throw new Error("Soapay: sessionId must be session_<hex>");
  return {
    domain: rotationClaimDomain(a.chainId),
    types: attachSessionTypes,
    primaryType: "AttachSession",
    message: { label: a.label, sessionId: a.sessionId, deadline: a.deadline },
  } as const;
}

export type RotationClaim = {
  label: string;
  /** Meta-addresses as URI or raw bytes; signed as canonical `st:eth:0x<lowercase>`. */
  oldMeta: string;
  newMeta: string;
  /** Unix seconds. */
  deadline: bigint;
  chainId: number;
};

export function rotationClaimTypedData(c: RotationClaim) {
  if (!isValidLabel(c.label)) throw new Error(`Soapay: invalid label "${c.label}"`);
  return {
    domain: rotationClaimDomain(c.chainId),
    types: rotationClaimTypes,
    primaryType: "RotationClaim",
    message: {
      label: c.label,
      oldMeta: formatMetaAddressURI(c.oldMeta),
      newMeta: formatMetaAddressURI(c.newMeta),
      deadline: c.deadline,
    },
  } as const;
}

export type MetaRotation = {
  label: string;
  oldMeta: string;
  newMeta: string;
  /** Unix seconds. */
  verifiedAt: bigint;
  chainId: number;
};

export function metaRotationTypedData(a: MetaRotation) {
  if (!isValidLabel(a.label)) throw new Error(`Soapay: invalid label "${a.label}"`);
  return {
    domain: metaRotationDomain(a.chainId),
    types: metaRotationTypes,
    primaryType: "MetaRotation",
    message: {
      label: a.label,
      oldMeta: formatMetaAddressURI(a.oldMeta),
      newMeta: formatMetaAddressURI(a.newMeta),
      verifiedAt: a.verifiedAt,
    },
  } as const;
}

/** One entry of `GET /names/:label/attestations`. */
export type MetaRotationAttestation = {
  label: string;
  oldMeta: string;
  newMeta: string;
  /** Unix seconds as a decimal string. */
  verifiedAt: string;
  signature: Hex;
};

export type AttestationsResponse = { attester: Address; items: MetaRotationAttestation[] };

// ---------------------------------------------------------------------------
// World ID signals. A proof commits to hashSignal(signal); the API recomputes the
// expected signal and compares, so a proof can't be moved to another registrant or rotation.
// ---------------------------------------------------------------------------

/**
 * World ID credential Soapay requires: Selfie Check (issuer schema 11), in a session.
 * Rotation is a continuity question ("same person who enrolled?"), which sessions answer
 * without an Orb. See docs/worldid.md.
 */
export const WORLD_ID_CREDENTIAL = "selfie" as const;
export const WORLD_ID_SCHEMA_ID = 11;

/** Signal for the session created at enrollment (or attached later): binds it to name + key. */
export function sessionSignal(label: string, registrant: Address): string {
  return `soapay:session:${label}:${registrant.toLowerCase()}`;
}

/** Signal for the session proof that authorises one rotation. */
export function rotationSignal(label: string, newMeta: string, deadline: bigint): string {
  return `soapay:rotate:${label}:${formatMetaAddressURI(newMeta)}:${deadline}`;
}

/**
 * World ID signal hash, as IDKit computes it: keccak256(bytes) >> 8, 32-byte hex.
 * A `0x…` hex string is hashed as bytes, anything else as UTF-8, so Soapay signals
 * use a non-hex `soapay:` prefix.
 */
export function worldIdSignalHash(signal: string): Hex {
  const bytes = /^0x([0-9a-fA-F]{2})+$/.test(signal) ? (signal as Hex) : stringToBytes(signal);
  const h = BigInt(keccak256(bytes)) >> 8n;
  return `0x${h.toString(16).padStart(64, "0")}` as Hex;
}
