/**
 * Employer invite links that reserve a label (docs/mvp-spec.md §7).
 *
 * viem only, no ScopeLift SDK, so the API can load it under plain Node.
 *
 * The employer's connected wallet signs `Invite(label, employer, codeHash, expiresAt)`.
 * `code` is 32 random bytes kept only by the employer (vault) and the invite link;
 * the API sees `codeHash = keccak256(code)` until the employee claims the label with
 * the code itself.
 */
import {
  bytesToHex,
  getAddress,
  isAddress,
  isHex,
  keccak256,
  type Address,
  type Hex,
  type TypedDataDomain,
} from "viem";
import { randomBytes } from "@noble/hashes/utils.js";
import { isValidLabel } from "./registration.js";

/** Default invite lifetime: 14 days. */
export const INVITE_DEFAULT_TTL_SECONDS = 14 * 24 * 3600;
/** Maximum invite lifetime: 30 days. */
export const INVITE_MAX_TTL_SECONDS = 30 * 24 * 3600;
/** Max length of the optional org display name. */
export const INVITE_ORG_MAX_LENGTH = 64;

export const inviteTypes = {
  Invite: [
    { name: "label", type: "string" },
    { name: "employer", type: "address" },
    { name: "codeHash", type: "bytes32" },
    { name: "expiresAt", type: "uint256" },
  ],
} as const;

/** Same domain as NameClaim: `{name: "Soapay Names", version: "1", chainId}` (the API's CHAIN_ID). */
export function inviteDomain(chainId: number) {
  return { name: "Soapay Names", version: "1", chainId } as const satisfies TypedDataDomain;
}

export type Invite = {
  label: string;
  employer: Address;
  codeHash: Hex;
  /** Unix seconds. */
  expiresAt: bigint;
  chainId: number;
};

const BYTES32 = /^0x[0-9a-fA-F]{64}$/;

/** True for a 0x-prefixed 32-byte hex string (an invite code or code hash). */
export function isBytes32(v: unknown): v is Hex {
  return typeof v === "string" && BYTES32.test(v);
}

export function inviteTypedData(invite: Invite) {
  if (!isValidLabel(invite.label)) throw new Error(`Soapay: invalid label "${invite.label}"`);
  if (!isAddress(invite.employer, { strict: false })) throw new Error("Soapay: invalid employer address");
  if (!isBytes32(invite.codeHash)) throw new Error("Soapay: codeHash must be 32 bytes of hex");
  return {
    domain: inviteDomain(invite.chainId),
    types: inviteTypes,
    primaryType: "Invite",
    message: {
      label: invite.label,
      employer: getAddress(invite.employer),
      codeHash: invite.codeHash.toLowerCase() as Hex,
      expiresAt: invite.expiresAt,
    },
  } as const;
}

/** 32 random bytes from the platform CSPRNG, as lowercase 0x hex. */
export function generateInviteCode(): Hex {
  return bytesToHex(randomBytes(32));
}

/** `keccak256(code)` over the 32 raw bytes, lowercase. Throws on a malformed code. */
export function inviteCodeHash(code: Hex): Hex {
  if (!isBytes32(code)) throw new Error("Soapay: invite code must be 32 bytes of hex");
  return keccak256(code.toLowerCase() as Hex);
}

/** Default `expiresAt` for a new invite: now + 14 days, in unix seconds. */
export function defaultInviteExpiry(nowSeconds: number = Math.floor(Date.now() / 1000)): bigint {
  return BigInt(nowSeconds + INVITE_DEFAULT_TTL_SECONDS);
}

/**
 * Anything that can sign EIP-712: a viem WalletClient (pass `account` unless it is hoisted)
 * or a LocalAccount.
 */
export type InviteSigner = {
  signTypedData(args: ReturnType<typeof inviteTypedData> & { account?: any }): Promise<Hex>;
};

/** The employer signs the invite with their connected wallet. */
export async function signInvite(
  signer: InviteSigner,
  invite: Invite,
  account?: Address | { address: Address },
): Promise<Hex> {
  const td = inviteTypedData(invite);
  return signer.signTypedData(account === undefined ? td : { ...td, account });
}

/**
 * The public-client surface `verifyInvite` needs. A viem PublicClient's `verifyTypedData`
 * handles EOAs, ERC-1271 smart wallets and ERC-6492 counterfactual wallets.
 */
export type InviteVerifier = {
  verifyTypedData(args: ReturnType<typeof inviteTypedData> & { address: Address; signature: Hex }): Promise<boolean>;
};

export type InviteVerification =
  | { valid: true }
  | {
      valid: false;
      reason: "invalid-label" | "invalid-employer" | "invalid-code-hash" | "expired" | "expiry-too-far" | "bad-signature";
    };

/**
 * Checks label rules, codeHash shape, `now < expiresAt <= now + 30 days` and the signature
 * through the public client (so smart-wallet employers work). Does not check availability.
 */
export async function verifyInvite(
  client: InviteVerifier,
  invite: Invite & { signature: Hex; nowSeconds?: bigint },
): Promise<InviteVerification> {
  if (!isValidLabel(invite.label)) return { valid: false, reason: "invalid-label" };
  if (!isAddress(invite.employer, { strict: false })) return { valid: false, reason: "invalid-employer" };
  if (!isBytes32(invite.codeHash)) return { valid: false, reason: "invalid-code-hash" };
  const now = invite.nowSeconds ?? BigInt(Math.floor(Date.now() / 1000));
  if (invite.expiresAt <= now) return { valid: false, reason: "expired" };
  if (invite.expiresAt > now + BigInt(INVITE_MAX_TTL_SECONDS)) return { valid: false, reason: "expiry-too-far" };
  if (!isHex(invite.signature)) return { valid: false, reason: "bad-signature" };
  try {
    const ok = await client.verifyTypedData({
      ...inviteTypedData(invite),
      address: getAddress(invite.employer),
      signature: invite.signature,
    });
    if (ok) return { valid: true };
  } catch {
    // malformed signature, or the wallet's isValidSignature reverted
  }
  return { valid: false, reason: "bad-signature" };
}

// ---------------------------------------------------------------------------
// Links: `${RECIPIENT_URL}/#/join?code=<0x…>&label=<label>&org=<org>`
// `label` and `org` are display hints; the truth comes from GET /invites/:codeHash.
// ---------------------------------------------------------------------------

export function buildInviteLink(p: { recipientUrl: string; code: Hex; label: string; org?: string | undefined }): string {
  if (!isBytes32(p.code)) throw new Error("Soapay: invite code must be 32 bytes of hex");
  if (!isValidLabel(p.label)) throw new Error(`Soapay: invalid label "${p.label}"`);
  let q = `code=${p.code.toLowerCase()}&label=${p.label}`;
  const org = p.org?.trim();
  if (org) q += `&org=${encodeURIComponent(org.slice(0, INVITE_ORG_MAX_LENGTH))}`;
  const base = p.recipientUrl.replace(/#.*$/, "").replace(/\/+$/, "");
  return `${base}/#/join?${q}`;
}

/** Minimal query parser (no DOM/Node lib types needed); first value wins, `+` is a space. */
function parseQuery(query: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const part of query.split("&")) {
    if (!part) continue;
    const eq = part.indexOf("=");
    const dec = (x: string) => {
      try {
        return decodeURIComponent(x.replace(/\+/g, " "));
      } catch {
        return "";
      }
    };
    const k = dec(eq >= 0 ? part.slice(0, eq) : part);
    if (!out.has(k)) out.set(k, dec(eq >= 0 ? part.slice(eq + 1) : ""));
  }
  return out;
}

export type ParsedInviteLink = { code: Hex; codeHash: Hex; label: string | undefined; org: string | undefined };

/**
 * Parses a full invite URL, its hash (`#/join?…`), the route (`/join?…`) or a bare query.
 * Returns undefined unless it is a join route with a valid 32-byte code. A label hint that
 * fails label rules is dropped (the API is the source of truth).
 */
export function parseInviteLink(input: string): ParsedInviteLink | undefined {
  let s = input.trim();
  const hashAt = s.indexOf("#");
  if (hashAt >= 0) s = s.slice(hashAt + 1);
  else if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) return undefined; // a URL without the hash route
  const qAt = s.indexOf("?");
  const path = qAt >= 0 ? s.slice(0, qAt) : s;
  const query = qAt >= 0 ? s.slice(qAt + 1) : "";
  if (path !== "" && path.replace(/\/+$/, "") !== "/join" && path !== "join") return undefined;
  const q = parseQuery(query);
  const code = q.get("code") ?? "";
  if (!isBytes32(code)) return undefined;
  const lc = code.toLowerCase() as Hex;
  const label = q.get("label")?.toLowerCase();
  const org = q.get("org")?.trim().slice(0, INVITE_ORG_MAX_LENGTH) || undefined;
  return {
    code: lc,
    codeHash: inviteCodeHash(lc),
    label: label && isValidLabel(label) ? label : undefined,
    org,
  };
}
