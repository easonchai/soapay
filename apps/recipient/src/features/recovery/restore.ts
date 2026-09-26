/**
 * Restoring the World ID link after a recovery-phrase restore (D-64, docs/worldid.md "Restore").
 *
 * The phrase recreates the registrant key but not the vault, and the vault is where the World ID
 * `sessionId` lived. The API still has it, so the registrant reads it back with a signed
 * SessionLookup (POST /names/:label/session/lookup) and the vault stores it again. Without it,
 * `IDKit.proveSession` can't run and rotation would fall back to the employer's manual approval.
 */
import { SESSION_LOOKUP_MAX_TTL_SECONDS, signSessionLookup, type SessionLookupResult } from "@soapay/sdk";
import { isAddressEqual, type Address, type Hex } from "viem";
import type { Api } from "../../api/client.js";
import type { Profile } from "../../vault/types.js";

/**
 * Short-lived: the signature is a bearer credential for reading the session id. Must stay within the
 * API's bound (`SESSION_LOOKUP_MAX_TTL_SECONDS`, 1 h).
 */
export const LOOKUP_TTL_SECONDS = BigInt(Math.min(600, SESSION_LOOKUP_MAX_TTL_SECONDS));

/** Signs a SessionLookup with the registrant key and asks the API. null when the name has no session. */
export async function lookupSession(p: {
  api: Api;
  chainId: number;
  label: string;
  registrantKey: Hex;
  now?: number;
}): Promise<SessionLookupResult | null> {
  const deadline = BigInt(Math.floor((p.now ?? Date.now()) / 1000)) + LOOKUP_TTL_SECONDS;
  const signature = await signSessionLookup({ label: p.label, deadline, chainId: p.chainId, registrantKey: p.registrantKey });
  return p.api.lookupSession(p.label, { deadline: deadline.toString(), signature });
}

/** The vault's recovery record for a session read back from the API. */
export function restoredRecovery(res: SessionLookupResult): NonNullable<Profile["recovery"]> {
  return {
    kind: "world-id",
    at: res.attachedAt * 1000,
    sessionId: res.sessionId,
    attachedTo: res.label,
    rotationAllowedFrom: res.rotationAllowedFrom,
    restored: true,
  };
}

/** A claimed name whose World ID link isn't in this vault (a restore, or a link made elsewhere). */
export function needsSessionRestore(profile: Profile): boolean {
  const name = profile.name;
  if (!name) return false;
  const r = profile.recovery;
  return !(r?.sessionId && r.attachedTo === name.label);
}

/**
 * Checks the public name record first (no signature needed when there's nothing to fetch), then
 * reads the session id back. Returns the recovery record to store, or null when the API has no
 * session for this name or the name belongs to another registrant.
 */
export async function fetchLinkedSession(p: {
  api: Api;
  chainId: number;
  label: string;
  registrant: Address;
  registrantKey: Hex;
  now?: number;
}): Promise<NonNullable<Profile["recovery"]> | null> {
  const rec = await p.api.getName(p.label);
  if (!rec?.worldIdSession || !isAddressEqual(rec.registrant, p.registrant)) return null;
  const res = await lookupSession(p);
  return res ? restoredRecovery(res) : null;
}
