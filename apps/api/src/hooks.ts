import type { Address } from "viem";
import { ApiError } from "./util.js";

/**
 * On-chain issuance of `<label>.<parent>`. The ENSv2 workstream implements the real
 * issuer (creates the subname in the ENSv2 registry on Sepolia and grants the
 * registrant edit rights on its own `stealth` record). The API only stores.
 */
export interface NameIssuer {
  /** Called once, when a label is first claimed. A throw aborts the claim (nothing is stored). */
  issue(args: { label: string; registrant: Address; metaAddress: string }): Promise<{ txHash?: string }>;
  /**
   * Optional: called when the registrant changes its meta-address through POST /names.
   * Omit it if the registrant edits its own record on-chain.
   */
  updateMeta?(args: { label: string; registrant: Address; metaAddress: string }): Promise<{ txHash?: string }>;
}

/** Default issuer: nothing on-chain, the API database is the only record. */
export class NoopNameIssuer implements NameIssuer {
  async issue(): Promise<{ txHash?: string }> {
    return {};
  }
}

export type HumanAction = "register" | "name" | "update-meta";

export type HumanVerdict = { ok: true; nullifier?: string } | { ok: false; reason: string };

/**
 * Proof-of-personhood hook (World ID later). Called by POST /register and POST /names
 * after input validation and before anything is sent or stored. `proof` is the raw
 * `proof` field of the request body, passed through untouched.
 */
export interface HumanVerifier {
  verify(args: { action: HumanAction; registrant: Address; proof?: unknown }): Promise<HumanVerdict>;
}

export const allowAllVerifier: HumanVerifier = {
  async verify() {
    return { ok: true };
  },
};

/** Runs the verifier; throws 403 on refusal, returns the nullifier (if any) to store. */
export async function requireHuman(
  verifier: HumanVerifier,
  args: { action: HumanAction; registrant: Address; proof?: unknown },
): Promise<string | null> {
  const v = await verifier.verify(args);
  if (!v.ok) throw new ApiError(403, "human_verification_failed", v.reason || "human verification failed");
  if (v.nullifier === undefined) return null;
  return String(v.nullifier).slice(0, 256);
}
