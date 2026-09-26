import { signRequest } from "@worldcoin/idkit-server";
import { WORLD_ID_CREDENTIAL, WORLD_ID_SCHEMA_ID, worldIdSignalHash } from "@soapay/sdk";
import type { Config } from "../config.js";
import type { Db } from "../db.js";
import { ApiError, type Logger } from "../util.js";
import { portalVerify, type Fetch } from "./portal.js";

/** The required credential's identifier (Proof of Human, D-54). */
const IDENTIFIERS = new Set<string>([WORLD_ID_CREDENTIAL]);
/** A proof may be verified this long after its RP context expired (the user was mid-flow). */
const PROOF_GRACE_SECONDS = 600;
const MAX_FIELD = (1n << 256n) - 1n;
const SESSION_ID = /^session_[0-9a-fA-F]{2,256}$/;

export type RpContextResponse = {
  rp_context: { rp_id: string; nonce: string; created_at: number; expires_at: number; signature: string };
  app_id: string;
  environment: string;
  kind: "session";
};

export type NameSessionRow = { label: string; session_id: string; attached_at: number; via: "enroll" | "attach" };

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

/** A verified session proof, not yet consumed. `commit()` must run inside the caller's DB transaction. */
export type VerifiedSession = { sessionId: string; sessionNullifier: string; commit: () => void };

/**
 * World ID 4.0 through IDKit, a single trust moment (docs/worldid.md, docs/mvp-spec.md §5):
 * - A name MAY carry a World ID session with the Proof of Human credential, created at
 *   enrollment (POST /names) or attached later (POST /names/:label/session).
 * - Rotation (POST /names/:label/rotation) must prove that same session.
 * No enrollment gate, no uniqueness action; we store session ids and used session nullifiers only.
 */
export class WorldId {
  constructor(private readonly deps: { config: Config; db: Db; fetch: Fetch; logger: Logger; now: () => number }) {}

  private get cfg() {
    return this.deps.config.worldId;
  }

  // -------------------------------------------------------------------------
  // RP context (POST /worldid/rp-context)

  /**
   * Signs a fresh RP context for one session request (create or prove). Sessions take no action.
   * `bind` is the Soapay signal the proof is for (`sessionSignal` / `rotationSignal`); it's stored
   * with the single-use nonce because session requests go to World App without a signal.
   */
  issueRpContext(bind?: string): RpContextResponse {
    const cfg = this.cfg;
    const sig = signRequest({ signingKeyHex: cfg.signingKey!, ttl: cfg.rpTtlSeconds });
    const now = this.deps.now();
    this.deps.db
      .prepare("INSERT INTO worldid_requests (nonce, kind, created_at, expires_at, bind) VALUES (?, 'session', ?, ?, ?)")
      .run(sig.nonce.toLowerCase(), now, now + cfg.rpTtlSeconds, bind ?? null);
    return {
      rp_context: { rp_id: cfg.rpId!, nonce: sig.nonce, created_at: sig.createdAt, expires_at: sig.expiresAt, signature: sig.sig },
      app_id: cfg.appId,
      environment: cfg.environment,
      kind: "session",
    };
  }

  // -------------------------------------------------------------------------
  // Session bookkeeping

  sessionForLabel(label: string): NameSessionRow | undefined {
    return this.deps.db.prepare("SELECT * FROM name_sessions WHERE label = ?").get(label) as NameSessionRow | undefined;
  }

  // -------------------------------------------------------------------------
  // Structural checks (before spending a portal call)

  private checkNonce(nonce: unknown): NonceRow {
    if (typeof nonce !== "string") throw new ApiError(403, "proof_malformed", "result has no nonce");
    const key = nonce.toLowerCase();
    const row = this.deps.db.prepare("SELECT * FROM worldid_requests WHERE nonce = ?").get(key) as NonceRow | undefined;
    if (!row || row.kind !== "session") {
      throw new ApiError(403, "unknown_request", "proof was not requested through this server (fetch a fresh rp-context)");
    }
    if (row.used_at !== null) throw new ApiError(403, "request_used", "this World ID request was already used");
    if (this.deps.now() > row.expires_at + PROOF_GRACE_SECONDS) {
      throw new ApiError(403, "request_expired", "this World ID request expired; verify again");
    }
    return row;
  }

  /** Parses an IDKitResultSession and runs every local check. Throws 403 with a precise code. */
  private parseSession(r: unknown, signal: string, expectedSessionId?: string) {
    if (r === undefined || r === null) throw new ApiError(403, "proof_missing", "a World ID session proof is required");
    if (!isObj(r)) throw new ApiError(403, "proof_malformed", "worldIdResult must be the IDKit session result object");
    if ("error" in r || r.cancelled === true) {
      throw new ApiError(403, "proof_cancelled", `World ID was cancelled or failed in the app (${String(r.error ?? "cancelled")})`);
    }
    if (r.protocol_version !== "4.0") {
      throw new ApiError(403, "legacy_proof_unsupported", "World ID 4.0 session proofs only (protocol_version 4.0)");
    }
    if (typeof r.session_id !== "string" || !SESSION_ID.test(r.session_id)) {
      throw new ApiError(403, "proof_malformed", "not a session proof (no valid session_id)");
    }
    const env = r.environment ?? "production";
    if (env !== this.cfg.environment) {
      throw new ApiError(403, "environment_mismatch", `proof is from the ${String(env)} environment, this server expects ${this.cfg.environment}`);
    }
    if (expectedSessionId !== undefined && r.session_id !== expectedSessionId) {
      throw new ApiError(403, "session_mismatch", "proof is from a different World ID than the one bound to this name");
    }
    const items = Array.isArray(r.responses) ? r.responses : [];
    const item = items.find((i: any) => isObj(i) && IDENTIFIERS.has(i.identifier) && i.issuer_schema_id === WORLD_ID_SCHEMA_ID);
    if (!item) throw new ApiError(403, "wrong_credential", "a World ID Proof of Human credential is required");
    const sn = Array.isArray(item.session_nullifier) ? item.session_nullifier[0] : undefined;
    const sessionNullifier = fieldToDecimal(sn, "session_nullifier");
    if (this.deps.db.prepare("SELECT 1 FROM worldid_session_nullifiers WHERE session_nullifier = ?").get(sessionNullifier)) {
      throw new ApiError(403, "session_replayed", "this session proof was already used");
    }
    const row = this.checkNonce(r.nonce);
    // Binding: either the proof carries our signal, or (sessions, which World App runs without a
    // signal) the single-use request it answers was issued for exactly this signal.
    const signedSignal = !isZeroField(item.signal_hash) && sameField(item.signal_hash, worldIdSignalHash(signal));
    const boundRequest = row.bind !== null && row.bind === signal;
    if (!signedSignal && !boundRequest) {
      throw new ApiError(403, "signal_mismatch", "proof is not bound to this request (fetch the rp-context for this exact change)");
    }
    return { nonce: row.nonce, sessionId: r.session_id as string, sessionNullifier };
  }

  private async verify(result: unknown, signal: string, expectedSessionId?: string): Promise<VerifiedSession> {
    const s = this.parseSession(result, signal, expectedSessionId);
    const v = await portalVerify(this.cfg, this.deps.fetch, this.deps.logger, result);
    if (v.session_id !== undefined && v.session_id !== s.sessionId) {
      throw new ApiError(403, "proof_invalid", "verified session_id does not match the proof");
    }
    const { db } = this.deps;
    return {
      sessionId: s.sessionId,
      sessionNullifier: s.sessionNullifier,
      commit: () => {
        const r = db.prepare("UPDATE worldid_requests SET used_at = ? WHERE nonce = ? AND used_at IS NULL").run(this.deps.now(), s.nonce);
        if (Number(r.changes) !== 1) throw new ApiError(403, "request_used", "this World ID request was already used");
        try {
          db.prepare("INSERT INTO worldid_session_nullifiers (session_nullifier, session_id, at) VALUES (?, ?, ?)").run(
            s.sessionNullifier,
            s.sessionId,
            this.deps.now(),
          );
        } catch {
          throw new ApiError(403, "session_replayed", "this session proof was already used");
        }
      },
    };
  }

  // -------------------------------------------------------------------------
  // Create / attach: a new session (no existing_session_id) bound to label + registrant

  /**
   * Verifies a freshly created session. The returned `commit` also binds it to `label`
   * (a session can back one name only; a name keeps its first session).
   */
  async verifyNewSession(args: { label: string; signal: string; result: unknown; via: "enroll" | "attach" }): Promise<VerifiedSession> {
    const v = await this.verify(args.result, args.signal);
    if (this.deps.db.prepare("SELECT 1 FROM name_sessions WHERE session_id = ?").get(v.sessionId)) {
      throw new ApiError(409, "session_taken", "this World ID session is already bound to another name");
    }
    return {
      ...v,
      commit: () => {
        v.commit();
        try {
          this.deps.db
            .prepare("INSERT INTO name_sessions (label, session_id, attached_at, via) VALUES (?, ?, ?, ?)")
            .run(args.label, v.sessionId, this.deps.now(), args.via);
        } catch {
          throw new ApiError(409, "session_exists", "this name already has a World ID session (or the session is taken)");
        }
      },
    };
  }

  // -------------------------------------------------------------------------
  // Rotation: proveSession for the name's saved session

  async verifyRotation(args: { label: string; signal: string; result: unknown }): Promise<VerifiedSession> {
    const bound = this.sessionForLabel(args.label);
    if (!bound) {
      throw new ApiError(409, "no_session", "this name has no World ID session; the employer must approve the change by hand");
    }
    const cooldown = this.cfg.attachCooldownSeconds;
    if (bound.via === "attach" && this.deps.now() < bound.attached_at + cooldown) {
      throw new ApiError(409, "session_cooldown", `a session attached after enrollment can back a rotation ${cooldown}s after attaching`);
    }
    return this.verify(args.result, args.signal, bound.session_id);
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
