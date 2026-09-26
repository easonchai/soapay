// Meta-address pins and World ID rotation attestations (D-05, D-13, D-49).
//
// ENS is only a reference: a payer resolves a name once, PINS the ERC-6538 meta-address,
// and treats any later change as a possible salary redirect. A change is accepted
// automatically ONLY with a MetaRotation attestation that
//   - is signed by the attester the PAYER pinned (never the `attester` field of the API
//     response, which the API or a MITM controls),
//   - starts from the meta-address the payer pinned (oldMeta), and
//   - ends at the meta-address the name resolves to right now (newMeta).
// Anything else (no attester, API down, 404, no items, bad signature, wrong transition)
// blocks the payee until the payer explicitly accepts the change.
//
// This is the check the sender app enforces (apps/sender/src/lib/attestation.ts) and
// `soapay distribute` uses; the pin store itself (vault, file) belongs to each app.
import { getAddress, isAddress, verifyTypedData, type Address } from "viem";
import { PARENT_NAME } from "./constants.js";
import { formatMetaAddressURI, parseMetaAddress } from "./keys.js";
import { pinnedMetaChanged } from "./names.js";
import { metaRotationTypedData, type AttestationsResponse, type MetaRotationAttestation } from "./rotation.js";

export type RotationAttestationStatus =
  /** Valid attestation from the pinned attester for exactly this pin → new meta transition. */
  | { state: "verified"; verifiedAt: number; attester: Address }
  /** The API answered, but nothing covers this change. */
  | { state: "missing"; reason: string }
  /** An attestation exists but fails a check (signer, transition, format). */
  | { state: "invalid"; reason: string }
  /** Couldn't check: API down, not configured, or the name isn't a Soapay subname. */
  | { state: "unavailable"; reason: string };

/** Fetches `GET /names/:label/attestations` (newest first); null = 404. Throws on network/API errors. */
export type RotationAttestationSource = (label: string) => Promise<AttestationsResponse | null>;

export type RotationAttestationLookup = (params: { ensName: string; oldMeta: string; newMeta: string }) => Promise<RotationAttestationStatus>;

/** Canonical lowercase `st:eth:0x…`, the form the API signs. Throws on malformed input. */
export function canonicalMetaAddress(meta: string): string {
  return formatMetaAddressURI(parseMetaAddress(meta));
}

/** `alice.soapay.eth` → `alice`. Only direct children of the platform parent carry attestations. */
export function soapayLabel(ensName: string, parent: string = PARENT_NAME): string | null {
  const name = ensName.trim().toLowerCase();
  const suffix = `.${parent}`;
  if (!name.endsWith(suffix)) return null;
  const label = name.slice(0, -suffix.length);
  return label && !label.includes(".") ? label : null;
}

export function httpRotationAttestationSource(
  apiUrl: string,
  opts: { timeoutMs?: number; fetchImpl?: typeof fetch } = {},
): RotationAttestationSource {
  const base = apiUrl.replace(/\/+$/, "");
  const f = opts.fetchImpl ?? fetch;
  return async (label) => {
    const res = await f(`${base}/names/${encodeURIComponent(label)}/attestations`, {
      signal: AbortSignal.timeout(opts.timeoutMs ?? 8_000),
      headers: { accept: "application/json" },
    });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`attestation API answered ${res.status}`);
    const body = (await res.json()) as unknown;
    if (!body || typeof body !== "object" || !Array.isArray((body as AttestationsResponse).items)) {
      throw new Error("attestation API returned an unexpected shape");
    }
    return body as AttestationsResponse;
  };
}

/** Verifies ONE attestation against the transition we observed (pinned → resolved now). */
export async function verifyRotationAttestation(params: {
  item: MetaRotationAttestation;
  label: string;
  oldMeta: string;
  newMeta: string;
  attester: Address;
  chainId: number;
}): Promise<RotationAttestationStatus> {
  const { item, label } = params;
  let oldMeta: string, newMeta: string, itemOld: string, itemNew: string, verifiedAt: bigint;
  try {
    oldMeta = canonicalMetaAddress(params.oldMeta);
    newMeta = canonicalMetaAddress(params.newMeta);
    itemOld = canonicalMetaAddress(item.oldMeta);
    itemNew = canonicalMetaAddress(item.newMeta);
    verifiedAt = BigInt(item.verifiedAt);
  } catch {
    return { state: "invalid", reason: "The attestation is malformed" };
  }
  if (item.label !== label) return { state: "invalid", reason: "The attestation is for a different name" };
  if (itemOld !== oldMeta) return { state: "invalid", reason: "The attestation starts from a different meta-address than the pinned one" };
  if (itemNew !== newMeta) return { state: "invalid", reason: "The attestation is for a different new meta-address than the name resolves to" };

  let ok = false;
  try {
    // Verify over the values WE expect (canonical), not the response's strings.
    ok = await verifyTypedData({
      address: params.attester,
      ...metaRotationTypedData({ label, oldMeta, newMeta, verifiedAt, chainId: params.chainId }),
      signature: item.signature,
    });
  } catch {
    ok = false;
  }
  if (!ok) return { state: "invalid", reason: "The attestation isn't signed by the pinned Soapay attester" };
  return { state: "verified", verifiedAt: Number(verifiedAt), attester: params.attester };
}

export function rotationAttestationLookup(cfg: {
  /** The PINNED attester. Without it nothing auto-accepts. */
  attester: string | undefined;
  /** EIP-712 chain id of the API's attestation domain (the API's CHAIN_ID). */
  chainId: number;
  source: RotationAttestationSource | null;
  parent?: string;
}): RotationAttestationLookup {
  return async ({ ensName, oldMeta, newMeta }) => {
    if (!cfg.attester || !isAddress(cfg.attester, { strict: false })) {
      return { state: "unavailable", reason: "No Soapay attester is pinned, so rotations can't be auto-verified" };
    }
    if (!cfg.source) return { state: "unavailable", reason: "No Soapay API is configured" };
    const label = soapayLabel(ensName, cfg.parent);
    if (!label) return { state: "unavailable", reason: `Only ${cfg.parent ?? PARENT_NAME} names carry World ID attestations` };
    let res: AttestationsResponse | null;
    try {
      res = await cfg.source(label);
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      return { state: "unavailable", reason: `Couldn't reach the attestation API: ${m.split("\n")[0]}` };
    }
    const newest = res?.items[0];
    if (!newest) return { state: "missing", reason: "No World ID re-verification on record for this change" };
    return verifyRotationAttestation({ item: newest, label, oldMeta, newMeta, attester: getAddress(cfg.attester), chainId: cfg.chainId });
  };
}

// ---------------------------------------------------------------------------------------------
// Pin book: a serialisable map identifier → pinned meta-address, with its history.

export type PinReason = "pinned" | "rotated-world-id" | "accepted-by-payer";

export type MetaPin = {
  /** Canonical `st:eth:0x…`. The only meta-address this payer pays for the identifier. */
  metaAddressURI: string;
  registrant?: Address;
  /** Which resolver answered when it was pinned (ens, erc6538, …). */
  source?: string;
  /** Unix ms. */
  pinnedAt: number;
  history: { metaAddressURI: string; at: number; reason: PinReason; verifiedAt?: number; attester?: Address }[];
};

export type PinBook = { version: 1; pins: Record<string, MetaPin> };

export function emptyPinBook(): PinBook {
  return { version: 1, pins: {} };
}

/** Pin key for an identifier: trimmed, lowercased (ENS names and 0x addresses are case-insensitive). */
export function pinKey(identifier: string): string {
  return identifier.trim().toLowerCase();
}

/** Parses and validates a stored pin book. Throws with a clear message on anything unexpected. */
export function parsePinBook(json: string): PinBook {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    throw new Error("Soapay: pin file is not valid JSON");
  }
  const r = raw as Partial<PinBook> | null;
  if (!r || typeof r !== "object" || r.version !== 1 || !r.pins || typeof r.pins !== "object") {
    throw new Error("Soapay: pin file has an unexpected shape (want { version: 1, pins: {…} })");
  }
  const pins: Record<string, MetaPin> = {};
  for (const [k, p] of Object.entries(r.pins)) {
    if (!p || typeof p.metaAddressURI !== "string") throw new Error(`Soapay: pin for "${k}" has no metaAddressURI`);
    pins[pinKey(k)] = { ...p, metaAddressURI: canonicalMetaAddress(p.metaAddressURI), history: Array.isArray(p.history) ? p.history : [] };
  }
  return { version: 1, pins };
}

export type PinDecision =
  /** First resolve: pin it. */
  | { state: "new" }
  /** Resolves to the pinned meta-address. */
  | { state: "ok" }
  /** Changed, and a valid World ID attestation covers exactly pinned → current. */
  | { state: "rotated"; from: string; verifiedAt: number; attester: Address }
  /** Changed, no valid attestation, but the payer explicitly accepted it. */
  | { state: "accepted"; from: string; attestation: UnverifiedAttestation }
  /** Changed and not accepted: do not pay. */
  | { state: "blocked"; from: string; to: string; attestation: UnverifiedAttestation };

/** Any attestation outcome other than "verified"; always carries a human reason. */
export type UnverifiedAttestation = Exclude<RotationAttestationStatus, { state: "verified" }>;

/**
 * Checks a freshly resolved meta-address against its pin. The attestation lookup only runs
 * when the meta-address changed; `acceptChange` is the payer's explicit override.
 */
export async function checkMetaPin(params: {
  identifier: string;
  pin: MetaPin | undefined;
  resolvedMeta: string;
  lookup?: RotationAttestationLookup;
  acceptChange?: boolean;
}): Promise<PinDecision> {
  const { pin, identifier } = params;
  if (!pin) return { state: "new" };
  if (!pinnedMetaChanged(pin.metaAddressURI, params.resolvedMeta)) return { state: "ok" };
  const attestation: RotationAttestationStatus = params.lookup
    ? await params.lookup({ ensName: identifier, oldMeta: pin.metaAddressURI, newMeta: params.resolvedMeta })
    : { state: "unavailable", reason: "Attestations weren't checked" };
  if (attestation.state === "verified") {
    return { state: "rotated", from: pin.metaAddressURI, verifiedAt: attestation.verifiedAt, attester: attestation.attester };
  }
  if (params.acceptChange) return { state: "accepted", from: pin.metaAddressURI, attestation };
  return { state: "blocked", from: pin.metaAddressURI, to: canonicalMetaAddress(params.resolvedMeta), attestation };
}

/** Returns the book with `decision` applied (new pin, moved pin, or unchanged). Never mutates. */
export function applyPinDecision(
  book: PinBook,
  params: { identifier: string; resolved: { metaAddressURI: string; registrant?: Address; source?: string }; decision: PinDecision; now: number },
): PinBook {
  const { decision, resolved, now } = params;
  if (decision.state === "ok" || decision.state === "blocked") return book;
  const key = pinKey(params.identifier);
  const meta = canonicalMetaAddress(resolved.metaAddressURI);
  const prev = book.pins[key];
  const entry =
    decision.state === "new"
      ? { metaAddressURI: meta, at: now, reason: "pinned" as const }
      : decision.state === "rotated"
        ? { metaAddressURI: meta, at: now, reason: "rotated-world-id" as const, verifiedAt: decision.verifiedAt, attester: decision.attester }
        : { metaAddressURI: meta, at: now, reason: "accepted-by-payer" as const };
  const pin: MetaPin = { metaAddressURI: meta, pinnedAt: now, history: [...(prev?.history ?? []), entry] };
  if (resolved.registrant) pin.registrant = resolved.registrant;
  if (resolved.source) pin.source = resolved.source;
  return { version: 1, pins: { ...book.pins, [key]: pin } };
}
