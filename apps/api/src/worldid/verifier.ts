import { signRequest } from "@worldcoin/idkit-server";
import type { Address } from "viem";
import { enrollSignal, worldIdSignalHash } from "@soapay/sdk";
import type { Config } from "../config.js";
import { tx, type Db } from "../db.js";
import type { HumanCheck, HumanVerdict, HumanVerifier } from "../hooks.js";
import { ApiError, type Logger } from "../util.js";
import { portalVerify, type Fetch } from "./portal.js";

/** Proof of Human: the only credential Soapay accepts (issuer schema 1). */
const POH_IDENTIFIER = "proof_of_human";
const POH_SCHEMA_ID = 1;
/** A proof may be verified this long after its RP context expired (the user was mid-flow). */
const PROOF_GRACE_SECONDS = 600;
const MAX_FIELD = (1n << 256n) - 1n;

export type RpKind = "uniqueness" | "session";

export type RpContextResponse = {
  rp_context: { rp_id: string; nonce: string; created_at: number; expires_at: number; signature: string };
  app_id: string;
  environment: string;
  kind: RpKind;
  action?: string;
};

type HumanRow = {
  action: string;
  nullifier: string;
  registrant: Address;
  session_id: string;
  verified_at: number;
  registered_at: number | null;
  label: string | null;
};

type NonceRow = { nonce: string; kind: RpKind; action: string | null; expires_at: number; used_at: number | null };

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

/** A client-side cancel or error that the app forwarded instead of a proof. */
function refuseCancelled(v: unknown, what: string): void {
  if (v === undefined || v === null) throw new ApiError(403, "proof_missing", `${what} is required (World ID)`);
  if (!isObj(v)) throw new ApiError(403, "proof_malformed", `${what} must be the IDKit result object`);
  if ("error" in v || v.cancelled === true) {
    throw new ApiError(403, "proof_cancelled", `${what} was cancelled or failed in World App (${String(v.error ?? "cancelled")})`);
  }
}

/**
 * World ID 4.0 through IDKit (docs/worldid.md).
 * - Enroll: a uniqueness proof (action `soapay-enroll`, Proof of Human) plus a new session,
 *   both bound to the registrant by the signal. Gates POST /register and POST /names.
 * - Rotation: a session proof for the name's enrolled session (POST /names/:label/rotation).
 */
export class WorldId {
  readonly humanVerifier: HumanVerifier;

  constructor(
    private readonly deps: { config: Config; db: Db; fetch: Fetch; logger: Logger; now: () => number },
  ) {
    this.humanVerifier = { verify: (args) => this.verifyEnrollment(args) };
  }

  private get cfg() {
    return this.deps.config.worldId;
  }

  // -------------------------------------------------------------------------
  // RP context (POST /worldid/rp-context)

  issueRpContext(kind: RpKind, action?: string): RpContextResponse {
    const cfg = this.cfg;
    if (kind === "uniqueness") {
      if (action !== undefined && action !== cfg.enrollAction) {
        throw new ApiError(400, "unknown_action", `action must be ${cfg.enrollAction}`);
      }
      action = cfg.enrollAction;
    } else if (action !== undefined) {
      throw new ApiError(400, "unexpected_action", "session requests are signed without an action");
    }
    const sig = signRequest({ signingKeyHex: cfg.signingKey!, ttl: cfg.rpTtlSeconds, ...(action ? { action } : {}) });
    const now = this.deps.now();
    this.deps.db
      .prepare("INSERT INTO worldid_requests (nonce, kind, action, created_at, expires_at) VALUES (?, ?, ?, ?, ?)")
      .run(sig.nonce.toLowerCase(), kind, action ?? null, now, now + cfg.rpTtlSeconds);
    return {
      rp_context: {
        rp_id: cfg.rpId!,
        nonce: sig.nonce,
        created_at: sig.createdAt,
        expires_at: sig.expiresAt,
        signature: sig.sig,
      },
      app_id: cfg.appId,
      environment: cfg.environment,
      kind,
      ...(action ? { action } : {}),
    };
  }

  // -------------------------------------------------------------------------
  // Structural checks (before spending a portal call)

  private checkNonce(nonce: unknown, kind: RpKind): string {
    if (typeof nonce !== "string") throw new ApiError(403, "proof_malformed", "result has no nonce");
    const key = nonce.toLowerCase();
    const row = this.deps.db.prepare("SELECT * FROM worldid_requests WHERE nonce = ?").get(key) as NonceRow | undefined;
    if (!row || row.kind !== kind) {
      throw new ApiError(403, "unknown_request", "proof was not requested through this server (fetch a fresh rp-context)");
    }
    if (row.used_at !== null) throw new ApiError(403, "request_used", "this World ID request was already used");
    if (this.deps.now() > row.expires_at + PROOF_GRACE_SECONDS) {
      throw new ApiError(403, "request_expired", "this World ID request expired; verify again");
    }
    return key;
  }

  private checkCommon(r: Record<string, any>): Record<string, any> {
    if (r.protocol_version !== "4.0") {
      throw new ApiError(403, "legacy_proof_unsupported", "World ID 4.0 proofs only (protocol_version 4.0)");
    }
    if (r.environment !== undefined && r.environment !== this.cfg.environment) {
      throw new ApiError(
        403,
        "environment_mismatch",
        `proof is from the ${String(r.environment)} environment, this server expects ${this.cfg.environment}`,
      );
    }
    const items = Array.isArray(r.responses) ? r.responses : [];
    const poh = items.find((i: any) => isObj(i) && i.identifier === POH_IDENTIFIER && i.issuer_schema_id === POH_SCHEMA_ID);
    if (!poh) throw new ApiError(403, "wrong_credential", "a Proof of Human credential is required");
    return poh;
  }

  private checkSignal(item: Record<string, any>, signal: string): void {
    if (!sameField(item.signal_hash, worldIdSignalHash(signal))) {
      throw new ApiError(403, "signal_mismatch", "proof is not bound to this request (signal mismatch)");
    }
  }

  private parseUniqueness(r: unknown, registrant: Address) {
    refuseCancelled(r, "enroll proof");
    const res = r as Record<string, any>;
    if ("session_id" in res) throw new ApiError(403, "proof_malformed", "enroll must be a uniqueness proof, not a session proof");
    const poh = this.checkCommon(res);
    if (res.action !== this.cfg.enrollAction) throw new ApiError(403, "wrong_action", `action must be ${this.cfg.enrollAction}`);
    this.checkSignal(poh, enrollSignal(registrant));
    const nonce = this.checkNonce(res.nonce, "uniqueness");
    return { nonce, nullifier: fieldToDecimal(poh.nullifier, "nullifier") };
  }

  private parseSession(r: unknown, signal: string, expectedSessionId?: string) {
    refuseCancelled(r, "session proof");
    const res = r as Record<string, any>;
    if (typeof res.session_id !== "string" || !/^session_[0-9a-fA-F]{2,256}$/.test(res.session_id)) {
      throw new ApiError(403, "proof_malformed", "session proof has no valid session_id");
    }
    const poh = this.checkCommon(res);
    if (expectedSessionId !== undefined && res.session_id !== expectedSessionId) {
      throw new ApiError(403, "session_mismatch", "proof is from a different World ID than the one that enrolled this name");
    }
    this.checkSignal(poh, signal);
    const sn = Array.isArray(poh.session_nullifier) ? poh.session_nullifier[0] : undefined;
    const sessionNullifier = fieldToDecimal(sn, "session_nullifier");
    if (this.deps.db.prepare("SELECT 1 FROM worldid_session_nullifiers WHERE session_nullifier = ?").get(sessionNullifier)) {
      throw new ApiError(403, "session_replayed", "this session proof was already used");
    }
    const nonce = this.checkNonce(res.nonce, "session");
    return { nonce, sessionId: res.session_id as string, sessionNullifier };
  }

  /** Marks a nonce used; throws if a concurrent request got there first. Call inside a tx. */
  private useNonce(nonce: string): void {
    const r = this.deps.db
      .prepare("UPDATE worldid_requests SET used_at = ? WHERE nonce = ? AND used_at IS NULL")
      .run(this.deps.now(), nonce);
    if (Number(r.changes) !== 1) throw new ApiError(403, "request_used", "this World ID request was already used");
  }

  private useSessionNullifier(sessionNullifier: string, sessionId: string): void {
    try {
      this.deps.db
        .prepare("INSERT INTO worldid_session_nullifiers (session_nullifier, session_id, at) VALUES (?, ?, ?)")
        .run(sessionNullifier, sessionId, this.deps.now());
    } catch {
      throw new ApiError(403, "session_replayed", "this session proof was already used");
    }
  }

  // -------------------------------------------------------------------------
  // Enroll: HumanVerifier for POST /register and POST /names

  private humanByRegistrant(registrant: Address): HumanRow | undefined {
    return this.deps.db.prepare("SELECT * FROM worldid_humans WHERE registrant = ?").get(registrant) as HumanRow | undefined;
  }

  humanByLabel(label: string): HumanRow | undefined {
    return this.deps.db.prepare("SELECT * FROM worldid_humans WHERE label = ?").get(label) as HumanRow | undefined;
  }

  /**
   * Verifies (once) that `registrant` belongs to a unique human, then checks the one-time
   * benefit for this action. The benefit is consumed by `commit()`, which the route calls
   * only after the relay/issuance succeeded.
   */
  async verifyEnrollment(args: HumanCheck): Promise<HumanVerdict> {
    try {
      return await this.verifyEnrollmentOrThrow(args);
    } catch (e) {
      if (e instanceof ApiError && e.status === 403) return { ok: false, code: e.code, reason: e.message };
      throw e;
    }
  }

  private async verifyEnrollmentOrThrow(args: HumanCheck): Promise<HumanVerdict> {
    const { registrant } = args;
    if (args.action === "update-meta") {
      throw new ApiError(403, "use_rotation", "meta-address changes go through POST /names/:label/rotation (World ID session)");
    }
    let human = this.humanByRegistrant(registrant);
    const proof = args.proof;

    if (human) {
      // Already verified: the request's own registrant signature proves key control. A proof,
      // if sent again, must be the same human's.
      if (isObj(proof) && isObj(proof.enroll) && !("error" in proof.enroll)) {
        const poh = (Array.isArray(proof.enroll.responses) ? proof.enroll.responses : []).find(
          (i: any) => isObj(i) && i.identifier === POH_IDENTIFIER,
        );
        if (poh && !sameField(poh.nullifier, human.nullifier)) {
          throw new ApiError(403, "registrant_bound", "this registrant key is already bound to a different human");
        }
      }
    } else {
      if (proof === undefined || proof === null) throw new ApiError(403, "proof_missing", "World ID proof is required");
      if (!isObj(proof)) throw new ApiError(403, "proof_malformed", "proof must be {enroll, session}");
      refuseCancelled(proof.error === undefined ? proof.enroll : proof, "enroll proof");
      const u = this.parseUniqueness(proof.enroll, registrant);
      const action = this.cfg.enrollAction;
      const prior = this.deps.db
        .prepare("SELECT registrant FROM worldid_humans WHERE action = ? AND nullifier = ?")
        .get(action, u.nullifier) as { registrant: string } | undefined;
      if (prior) {
        throw new ApiError(403, "nullifier_reused", "this human has already enrolled (one registration and one name per human)");
      }
      const s = this.parseSession(proof.session, enrollSignal(registrant));
      if (this.deps.db.prepare("SELECT 1 FROM worldid_humans WHERE session_id = ?").get(s.sessionId)) {
        throw new ApiError(403, "session_taken", "this World ID session is already bound to another name");
      }

      const uv = await portalVerify(this.cfg, this.deps.fetch, this.deps.logger, proof.enroll);
      if (uv.action !== undefined && uv.action !== action) throw new ApiError(403, "wrong_action", `action must be ${action}`);
      if (uv.nullifier !== undefined && !sameField(uv.nullifier, u.nullifier)) {
        throw new ApiError(403, "proof_invalid", "verified nullifier does not match the proof");
      }
      const sv = await portalVerify(this.cfg, this.deps.fetch, this.deps.logger, proof.session);
      if (sv.session_id !== undefined && sv.session_id !== s.sessionId) {
        throw new ApiError(403, "proof_invalid", "verified session_id does not match the proof");
      }

      // Persist the verification now (not in commit): World ID 4.0 uniqueness proofs are
      // one-time per action, so a failed relay must not force the human to prove again.
      tx(this.deps.db, () => {
        this.useNonce(u.nonce);
        this.useNonce(s.nonce);
        this.useSessionNullifier(s.sessionNullifier, s.sessionId);
        try {
          this.deps.db
            .prepare(
              "INSERT INTO worldid_humans (action, nullifier, registrant, session_id, verified_at) VALUES (?, ?, ?, ?, ?)",
            )
            .run(action, u.nullifier, registrant, s.sessionId, this.deps.now());
        } catch {
          throw new ApiError(403, "nullifier_reused", "this human has already enrolled (one registration and one name per human)");
        }
      });
      this.deps.logger.info("worldid: human enrolled", { registrant });
      human = this.humanByRegistrant(registrant)!;
    }

    const db = this.deps.db;
    const h = human;
    if (args.action === "register") {
      if (h.registered_at !== null) {
        throw new ApiError(403, "sponsorship_used", "this human's one sponsored registration was already used");
      }
      return {
        ok: true,
        nullifier: h.nullifier,
        commit: () => {
          db.prepare("UPDATE worldid_humans SET registered_at = ? WHERE registrant = ?").run(this.deps.now(), registrant);
        },
      };
    }
    // action === "name"
    if (h.label !== null && h.label !== args.label) {
      throw new ApiError(403, "name_limit", `this human already holds ${h.label}; one name per human`);
    }
    return {
      ok: true,
      nullifier: h.nullifier,
      commit: () => {
        db.prepare("UPDATE worldid_humans SET label = ? WHERE registrant = ?").run(args.label ?? null, registrant);
      },
    };
  }

  // -------------------------------------------------------------------------
  // Rotation: a session proof for the name's enrolled session

  /**
   * Verifies a proveSession result for `label`. Returns `commit()`, which marks the proof
   * used; the route runs it in the same transaction that stores the attestation.
   */
  async verifyRotation(args: { label: string; signal: string; result: unknown }): Promise<{ commit: () => void; sessionNullifier: string }> {
    const human = this.humanByLabel(args.label);
    if (!human) throw new ApiError(409, "not_enrolled", "this name has no World ID enrollment to rotate against");
    const s = this.parseSession(args.result, args.signal, human.session_id);
    const v = await portalVerify(this.cfg, this.deps.fetch, this.deps.logger, args.result);
    if (v.session_id !== undefined && v.session_id !== human.session_id) {
      throw new ApiError(403, "session_mismatch", "proof is from a different World ID than the one that enrolled this name");
    }
    return {
      sessionNullifier: s.sessionNullifier,
      commit: () => {
        this.useNonce(s.nonce);
        this.useSessionNullifier(s.sessionNullifier, s.sessionId);
      },
    };
  }
}

export function pruneWorldIdRequests(db: Db, nowSeconds: number): void {
  db.prepare("DELETE FROM worldid_requests WHERE expires_at < ?").run(nowSeconds - 86_400);
}
