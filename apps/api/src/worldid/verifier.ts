import { signRequest } from "@worldcoin/idkit-server";
import { WORLD_ID_CREDENTIAL, WORLD_ID_SCHEMA_ID, worldIdSignalHash } from "@soapay/sdk";
import type { Config } from "../config.js";
import type { Db } from "../db.js";
import { ApiError, type Logger } from "../util.js";
import { portalVerify, type Fetch } from "./portal.js";

/** A proof may be verified this long after its RP context expired (the user was mid-flow). */
const PROOF_GRACE_SECONDS = 600;
const MAX_FIELD = (1n << 256n) - 1n;
/** worldid_requests.kind for the one-time (uniqueness) requests Soapay signs since D-58. */
const REQUEST_KIND = "uniqueness";

export type RpContextResponse = {
  rp_context: { rp_id: string; nonce: string; created_at: number; expires_at: number; signature: string };
  app_id: string;
  environment: string;
  /** The World ID action the proof must be for (WORLD_ACTION). */
  action: string;
  kind: "uniqueness";
};

/** A name's World ID link: the nullifier of the first verified proof (D-58). */
export type NameLinkRow = {
  label: string;
  /** Decimal string. */
  nullifier: string;
  attached_at: number;
  via: "enroll" | "attach";
};

type RawLinkRow = Omit<NameLinkRow, "nullifier"> & { nullifier: string | null; session_id: string | null };

type NonceRow = { nonce: string; kind: string; expires_at: number; used_at: number | null; bind: string | null };

/** 0x hex (or decimal) field element → canonical decimal string; throws on anything else. */
export function fieldToDecimal(v: unknown, what: string): string {
  if (typeof v !== "string" || !/^(0x[0-9a-fA-F]{1,64}|\d{1,78})$/.test(v)) {
    throw new ApiError(403, "proof_malformed", `${what} is not a field element`);
  }
  const n = BigInt(v);
  if (n > MAX_FIELD) throw new ApiError(403, "proof_malformed", `${what} exceeds 256 bits`);
  return n.toString(10);
}

function sameField(a: unknown, b: string): boolean {
  try {
    return typeof a === "string" && BigInt(a) === BigInt(b);
  } catch {
    return false;
  }
}

function isObj(v: unknown): v is Record<string, any> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

/**
 * A verified World ID proof, not yet consumed. `commit()` must run inside the caller's DB
 * transaction; it marks the proof's single-use request nonce as used.
 */
export type VerifiedProof = {
  /** The proof's nullifier, decimal. Stable per (human, RP, action): the link. */
  nullifier: string;
  /** The single-use request nonce (lowercase hex): identifies this one proof. */
  nonce: string;
  commit: () => void;
};

/**
 * World ID 4.0 through IDKit, a single trust moment: account recovery (docs/worldid.md, D-58).
 * - Every proof is a one-time Proof of Human request on WORLD_ACTION (`soapay-recovery`).
 * - Link: a name MAY store the nullifier of a verified proof, at enrollment (POST /names) or
 *   later (POST /names/:label/session). The same human may link several names.
 * - Rotation (POST /names/:label/rotation) needs a verified proof with the SAME nullifier.
 *   The nullifier is RP- and action-scoped: it says nothing about the person and can't be linked
 *   across apps. Replays are stopped by the single-use RP nonce.
 */
export class WorldId {
  constructor(private readonly deps: { config: Config; db: Db; fetch: Fetch; logger: Logger; now: () => number }) {}

  private get cfg() {
    return this.deps.config.worldId;
  }

  // -------------------------------------------------------------------------
  // RP context (POST /worldid/rp-context)

  /**
   * Signs a fresh RP context for one Proof of Human request on WORLD_ACTION. `bind` is the
   * Soapay signal the proof is for (`sessionSignal` / `rotationSignal`); it's stored with the
   * single-use nonce (D-57), so the binding holds even if a proof comes back without a signal.
   */
  issueRpContext(bind?: string): RpContextResponse {
    const cfg = this.cfg;
    const sig = signRequest({ signingKeyHex: cfg.signingKey!, action: cfg.action, ttl: cfg.rpTtlSeconds });
    const now = this.deps.now();
    this.deps.db
      .prepare("INSERT INTO worldid_requests (nonce, kind, created_at, expires_at, bind) VALUES (?, ?, ?, ?, ?)")
      .run(sig.nonce.toLowerCase(), REQUEST_KIND, now, now + cfg.rpTtlSeconds, bind ?? null);
    return {
      rp_context: { rp_id: cfg.rpId!, nonce: sig.nonce, created_at: sig.createdAt, expires_at: sig.expiresAt, signature: sig.sig },
      app_id: cfg.appId,
      environment: cfg.environment,
      action: cfg.action,
      kind: "uniqueness",
    };
  }

  // -------------------------------------------------------------------------
  // Link bookkeeping

  /** The name's World ID link, if any. A legacy session-only row (D-16/D-57) is not a link. */
  linkForLabel(label: string): NameLinkRow | undefined {
    const row = this.deps.db.prepare("SELECT * FROM name_sessions WHERE label = ?").get(label) as RawLinkRow | undefined;
    if (!row || row.nullifier === null) return undefined;
    return { label: row.label, nullifier: row.nullifier, attached_at: row.attached_at, via: row.via };
  }

  // -------------------------------------------------------------------------
  // Structural checks (before spending a portal call)

  private checkNonce(nonce: unknown): NonceRow {
    if (typeof nonce !== "string") throw new ApiError(403, "proof_malformed", "result has no nonce");
    const key = nonce.toLowerCase();
    const row = this.deps.db.prepare("SELECT * FROM worldid_requests WHERE nonce = ?").get(key) as NonceRow | undefined;
    if (!row || row.kind !== REQUEST_KIND) {
      throw new ApiError(403, "unknown_request", "proof was not requested through this server (fetch a fresh rp-context)");
    }
    if (row.used_at !== null) throw new ApiError(403, "request_used", "this World ID request was already used");
    if (this.deps.now() > row.expires_at + PROOF_GRACE_SECONDS) {
      throw new ApiError(403, "request_expired", "this World ID request expired; verify again");
    }
    return row;
  }

  /** Parses an IDKit v4 uniqueness result and runs every local check. Throws 403 with a precise code. */
  private parseProof(r: unknown, signal: string) {
    if (r === undefined || r === null) throw new ApiError(403, "proof_missing", "a World ID proof is required");
    if (!isObj(r)) throw new ApiError(403, "proof_malformed", "worldIdResult must be the IDKit result object");
    if ("error" in r || r.cancelled === true) {
      throw new ApiError(403, "proof_cancelled", `World ID was cancelled or failed in the app (${String(r.error ?? "cancelled")})`);
    }
    if (r.protocol_version !== "4.0") {
      throw new ApiError(403, "legacy_proof_unsupported", "World ID 4.0 proofs only (protocol_version 4.0)");
    }
    if (r.session_id !== undefined) {
      throw new ApiError(403, "proof_malformed", "session proofs aren't accepted; send a one-time Proof of Human proof");
    }
    const env = r.environment ?? "production";
    if (env !== this.cfg.environment) {
      throw new ApiError(403, "environment_mismatch", `proof is from the ${String(env)} environment, this server expects ${this.cfg.environment}`);
    }
    if (r.action !== this.cfg.action) {
      throw new ApiError(403, "action_mismatch", `proof is for another World ID action (expected ${this.cfg.action})`);
    }
    const items = Array.isArray(r.responses) ? r.responses : [];
    const item = items.find((i: any) => isObj(i) && i.identifier === WORLD_ID_CREDENTIAL && i.issuer_schema_id === WORLD_ID_SCHEMA_ID);
    if (!item) throw new ApiError(403, "wrong_credential", "a World ID Proof of Human credential is required");
    const nullifier = fieldToDecimal(item.nullifier, "nullifier");
    const row = this.checkNonce(r.nonce);
    // Binding: the proof carries our signal, or the single-use request it answers was issued for
    // exactly this signal (D-57).
    const signedSignal = !isZeroField(item.signal_hash) && sameField(item.signal_hash, worldIdSignalHash(signal));
    const boundRequest = row.bind !== null && row.bind === signal;
    if (!signedSignal && !boundRequest) {
      throw new ApiError(403, "signal_mismatch", "proof is not bound to this request (fetch the rp-context for this exact change)");
    }
    return { nonce: row.nonce, nullifier };
  }

  private async verify(result: unknown, signal: string, expectedNullifier?: string): Promise<VerifiedProof> {
    const s = this.parseProof(result, signal);
    if (expectedNullifier !== undefined && s.nullifier !== expectedNullifier) {
      throw new ApiError(403, "human_mismatch", "proof is from a different person than the one linked to this name");
    }
    const v = await portalVerify(this.cfg, this.deps.fetch, this.deps.logger, result);
    if (v.nullifier !== undefined && !sameField(v.nullifier, s.nullifier)) {
      throw new ApiError(403, "proof_invalid", "verified nullifier does not match the proof");
    }
    if (v.action !== undefined && v.action !== this.cfg.action) {
      throw new ApiError(403, "action_mismatch", "the portal verified a proof for another action");
    }
    const { db } = this.deps;
    return {
      nullifier: s.nullifier,
      nonce: s.nonce,
      commit: () => {
        const r = db.prepare("UPDATE worldid_requests SET used_at = ? WHERE nonce = ? AND used_at IS NULL").run(this.deps.now(), s.nonce);
        if (Number(r.changes) !== 1) throw new ApiError(403, "request_used", "this World ID request was already used");
      },
    };
  }

  // -------------------------------------------------------------------------
  // Link (enrollment, or attach later): store the verified nullifier on `label`

  /**
   * Verifies a proof for `sessionSignal(label, registrant)`. The returned `commit` also links the
   * nullifier to `label`. A name keeps its first link; one human may link several names.
   */
  async verifyLink(args: { label: string; signal: string; result: unknown; via: "enroll" | "attach" }): Promise<VerifiedProof> {
    if (this.linkForLabel(args.label)) {
      throw new ApiError(409, "session_exists", "this name is already linked to a World ID; it can't be replaced here");
    }
    const v = await this.verify(args.result, args.signal);
    return {
      ...v,
      commit: () => {
        v.commit();
        if (this.linkForLabel(args.label)) {
          throw new ApiError(409, "session_exists", "this name is already linked to a World ID; it can't be replaced here");
        }
        // Replaces a legacy session-only row (D-16/D-57), which can't back a rotation anyway.
        this.deps.db
          .prepare(
            `INSERT INTO name_sessions (label, session_id, nullifier, attached_at, via) VALUES (?, NULL, ?, ?, ?)
             ON CONFLICT(label) DO UPDATE SET session_id = NULL, nullifier = excluded.nullifier,
               attached_at = excluded.attached_at, via = excluded.via`,
          )
          .run(args.label, v.nullifier, this.deps.now(), args.via);
      },
    };
  }

  // -------------------------------------------------------------------------
  // Rotation: a proof from the same human (same nullifier)

  async verifyRotation(args: { label: string; signal: string; result: unknown }): Promise<VerifiedProof> {
    const bound = this.linkForLabel(args.label);
    if (!bound) {
      throw new ApiError(409, "no_worldid_link", "this name isn't linked to a World ID; the employer must approve the change by hand");
    }
    const cooldown = this.cfg.attachCooldownSeconds;
    if (bound.via === "attach" && this.deps.now() < bound.attached_at + cooldown) {
      throw new ApiError(409, "session_cooldown", `a World ID linked after enrollment can back a rotation ${cooldown}s after linking`);
    }
    return this.verify(args.result, args.signal, bound.nullifier);
  }
}

export function pruneWorldIdRequests(db: Db, nowSeconds: number): void {
  db.prepare("DELETE FROM worldid_requests WHERE expires_at < ?").run(nowSeconds - 86_400);
}

/** True for an absent or all-zero field element (IDKit sends `0x0` when a request has no signal). */
function isZeroField(v: unknown): boolean {
  if (v === undefined || v === null || v === "") return true;
  try {
    return BigInt(String(v)) === 0n;
  } catch {
    return false;
  }
}
