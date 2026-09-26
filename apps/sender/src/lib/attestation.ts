// TODO: switch to @soapay/sdk rotation.ts (RotationClaim/MetaRotation typed data) once the World ID branch lands.
// Key rotation under option A (docs/mvp-spec.md §2.1).
//
// The registrant key can rewrite the `stealth` record behind a name, so a changed
// meta-address is a possible salary redirect. apps/api issues an EIP-712
// MetaRotation attestation only after a fresh World ID proof from the human who
// enrolled the name. The sender app is the enforcement point:
//
//   auto-accept a changed pin ONLY IF the newest attestation for the label
//   - is signed by the attester PINNED in this app's config (never the `attester`
//     field of the API response, which the API or a MITM controls),
//   - has oldMeta == the meta-address we pinned, and
//   - has newMeta == the meta-address the name resolves to right now.
//
// Anything else (no attester configured, API down, 404, no items, bad signature,
// wrong transition) leaves the line BLOCKED for explicit employer approval.
import { getAddress, isAddress, verifyTypedData, type Address, type Hex } from "viem";
import { formatMetaAddressURI, parseMetaAddress, PARENT_NAME } from "@soapay/sdk";

/** Must match apps/api exactly (docs/mvp-spec.md §2.1, "Shared formats"). */
export function metaRotationDomain(chainId: number) {
  return { name: "Soapay Attestations", version: "1", chainId } as const;
}

export const META_ROTATION_TYPES = {
  MetaRotation: [
    { name: "label", type: "string" },
    { name: "oldMeta", type: "string" },
    { name: "newMeta", type: "string" },
    { name: "verifiedAt", type: "uint256" },
  ],
} as const;

export type MetaRotationItem = {
  label: string;
  oldMeta: string;
  newMeta: string;
  /** Unix seconds, as a decimal string. */
  verifiedAt: string;
  signature: Hex;
};

/** `GET /names/:label/attestations`, newest first. */
export type AttestationsResponse = { attester?: string; items: MetaRotationItem[] };

export type AttestationStatus =
  /** Valid attestation from the pinned attester for exactly this pin → new meta transition. */
  | { state: "verified"; verifiedAt: number; attester: Address }
  /** The API answered, but nothing covers this change. */
  | { state: "missing"; reason: string }
  /** An attestation exists but fails a check (signer, transition, format). */
  | { state: "invalid"; reason: string }
  /** Couldn't check: API down, not configured, or the name isn't a Soapay subname. */
  | { state: "unavailable"; reason: string };

export type AttestationLookup = (params: { ensName: string; oldMeta: string; newMeta: string }) => Promise<AttestationStatus>;

/** Fetches the attestation list; null means "no record for this label" (404). Throws on network/API errors. */
export type AttestationSource = (label: string) => Promise<AttestationsResponse | null>;

/** Canonical lowercase `st:eth:0x…`, the form the API signs. Throws on malformed input. */
export function canonicalMeta(meta: string): string {
  return formatMetaAddressURI(parseMetaAddress(meta));
}

/** `alice.soapay.eth` → `alice`. Only direct children of the platform parent have attestations. */
export function soapayLabel(ensName: string): string | null {
  const suffix = `.${PARENT_NAME}`;
  if (!ensName.endsWith(suffix)) return null;
  const label = ensName.slice(0, -suffix.length);
  return label && !label.includes(".") ? label : null;
}

export function httpAttestationSource(apiUrl: string, opts: { timeoutMs?: number; fetchImpl?: typeof fetch } = {}): AttestationSource {
  const base = apiUrl.replace(/\/+$/, "");
  const f = opts.fetchImpl ?? fetch;
  return async (label) => {
    const res = await f(`${base}/names/${encodeURIComponent(label)}/attestations`, {
      signal: AbortSignal.timeout(opts.timeoutMs ?? 8_000),
      headers: { accept: "application/json" },
    });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`Attestation API answered ${res.status}`);
    const body = (await res.json()) as unknown;
    if (!body || typeof body !== "object" || !Array.isArray((body as AttestationsResponse).items)) {
      throw new Error("Attestation API returned an unexpected shape");
    }
    return body as AttestationsResponse;
  };
}

/**
 * Verifies ONE attestation item against the transition we observed. Pure apart from
 * signature recovery; exported for tests and for UIs that show attestation details.
 */
export async function verifyRotationItem(params: {
  item: MetaRotationItem;
  label: string;
  oldMeta: string;
  newMeta: string;
  attester: Address;
  chainId: number;
}): Promise<AttestationStatus> {
  const { item, label } = params;
  let oldMeta: string;
  let newMeta: string;
  let itemOld: string;
  let itemNew: string;
  let verifiedAt: bigint;
  try {
    oldMeta = canonicalMeta(params.oldMeta);
    newMeta = canonicalMeta(params.newMeta);
    itemOld = canonicalMeta(item.oldMeta);
    itemNew = canonicalMeta(item.newMeta);
    verifiedAt = BigInt(item.verifiedAt);
  } catch {
    return { state: "invalid", reason: "The attestation is malformed" };
  }
  if (item.label !== label) return { state: "invalid", reason: "The attestation is for a different name" };
  if (itemOld !== oldMeta) return { state: "invalid", reason: "The attestation starts from a different meta-address than the one you pinned" };
  if (itemNew !== newMeta) return { state: "invalid", reason: "The attestation is for a different new meta-address than the name resolves to" };

  let ok = false;
  try {
    // Verify over the values WE expect (canonical), not the response's strings.
    ok = await verifyTypedData({
      address: params.attester,
      domain: metaRotationDomain(params.chainId),
      types: META_ROTATION_TYPES,
      primaryType: "MetaRotation",
      message: { label, oldMeta, newMeta, verifiedAt },
      signature: item.signature,
    });
  } catch {
    ok = false;
  }
  if (!ok) return { state: "invalid", reason: "The attestation isn't signed by the Soapay attester this app trusts" };
  return { state: "verified", verifiedAt: Number(verifiedAt), attester: params.attester };
}

export type AttestationConfig = {
  /** Pinned attester (VITE_ATTESTER). Without it nothing auto-accepts. */
  attester: string | undefined;
  /** EIP-712 chain id of the API's attestation domain (the API's CHAIN_ID). */
  chainId: number;
  source: AttestationSource | null;
};

export function createAttestationLookup(cfg: AttestationConfig): AttestationLookup {
  return async ({ ensName, oldMeta, newMeta }) => {
    if (!cfg.attester || !isAddress(cfg.attester)) {
      return { state: "unavailable", reason: "No Soapay attester is configured, so rotations can't be auto-verified" };
    }
    if (!cfg.source) return { state: "unavailable", reason: "No Soapay API is configured" };
    const label = soapayLabel(ensName);
    if (!label) return { state: "unavailable", reason: `Only ${PARENT_NAME} names carry World ID attestations` };

    let res: AttestationsResponse | null;
    try {
      res = await cfg.source(label);
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      return { state: "unavailable", reason: `Couldn't reach the attestation API: ${m.split("\n")[0]}` };
    }
    const newest = res?.items[0];
    if (!newest) return { state: "missing", reason: "Changed without a World ID proof from the linked person (Soapay has no attestation for this change)" };
    return verifyRotationItem({ item: newest, label, oldMeta, newMeta, attester: getAddress(cfg.attester), chainId: cfg.chainId });
  };
}

/** Human line for the UI. */
export function describeAttestation(s: AttestationStatus): string {
  switch (s.state) {
    case "verified":
      return `Re-verified by World ID on ${new Date(s.verifiedAt * 1000).toLocaleString()}`;
    default:
      return s.reason;
  }
}
