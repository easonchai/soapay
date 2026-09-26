import type { Address } from "viem";
import type { AgentMetadata } from "@soapay/sdk/ensv2";
import { ApiError } from "./util.js";

/**
 * On-chain issuance of `<label>.<parent>`. The ENSv2 workstream implements the real
 * issuer (creates the subname in the ENSv2 registry on Sepolia and grants the
 * registrant edit rights on its own `stealth` record). The API only stores.
 */
export interface NameIssuer {
  /** Called once, when a label is first claimed. A throw aborts the claim (nothing is stored). */
  issue(args: {
    label: string;
    registrant: Address;
    metaAddress: string;
    /** ENSIP-25/26 agent records (docs/mvp-spec.md §8), already validated. Set once at issuance. */
    agent?: AgentMetadata;
  }): Promise<{ txHash?: string }>;
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

export type HumanCheck = {
  action: HumanAction;
  registrant: Address;
  /** The raw `proof` field of the request body, passed through untouched. */
  proof?: unknown;
  /** POST /names only: the label being claimed or updated. */
  label?: string;
  /** POST /names only: the canonical meta-address URI being set. */
  metaAddress?: string;
  /** POST /names only: the NameClaim deadline. */
  deadline?: bigint;
};

export type HumanVerdict =
  | {
      ok: true;
      nullifier?: string;
      /**
       * Records that the scarce benefit was actually granted (relayer tx sent, name stored).
       * The route calls it only after success, so a failed send or issuance never burns
       * the human's one-time allowance. Must be synchronous (it runs inside a DB transaction).
       */
      commit?: () => void;
    }
  | { ok: false; reason: string; code?: string };

/**
 * Proof-of-personhood hook (World ID: `humanVerifier/worldid.ts`). Called by POST /register
 * and POST /names after input validation and before anything is sent or stored.
 */
export interface HumanVerifier {
  verify(args: HumanCheck): Promise<HumanVerdict>;
}

export const allowAllVerifier: HumanVerifier = {
  async verify() {
    return { ok: true };
  },
};

/** Runs the verifier; throws 403 on refusal, returns the nullifier (if any) to store and the commit hook. */
export async function requireHuman(
  verifier: HumanVerifier,
  args: HumanCheck,
): Promise<{ nullifier: string | null; commit: () => void }> {
  const v = await verifier.verify(args);
  if (!v.ok) throw new ApiError(403, v.code ?? "human_verification_failed", v.reason || "human verification failed");
  return {
    nullifier: v.nullifier === undefined ? null : String(v.nullifier).slice(0, 256),
    commit: v.commit ?? (() => {}),
  };
}
