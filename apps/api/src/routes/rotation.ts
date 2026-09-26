import { Hono } from "hono";
import { verifyTypedData, type Address, type Hash, type Hex, type TypedDataDefinition } from "viem";
import {
  attachSessionTypedData,
  isValidLabel,
  metaRotationTypedData,
  rotationClaimTypedData,
  rotationSignal,
  sessionSignal,
} from "@soapay/sdk";
import { jsonBody, type AppDeps } from "../app.js";
import { tx, type Db } from "../db.js";
import type { Prepared, RegistrationRelay } from "../relay.js";
import { topUpRegistrant } from "../topup.js";
import { ApiError, enforceRateLimits, parseMetaAddress, redactSig, requireHex } from "../util.js";
import { getName, parseDeadline } from "./names.js";

type AttestationRow = {
  id: number;
  label: string;
  old_meta: string;
  new_meta: string;
  verified_at: number;
  attester: string;
  signature: Hex;
};

function latestAttestation(db: Db, label: string): AttestationRow | undefined {
  return db.prepare("SELECT * FROM attestations WHERE label = ? ORDER BY id DESC LIMIT 1").get(label) as
    | AttestationRow
    | undefined;
}

function present(a: AttestationRow) {
  return { label: a.label, oldMeta: a.old_meta, newMeta: a.new_meta, verifiedAt: String(a.verified_at), signature: a.signature };
}

export type RegistryOutcome =
  | { status: "pending" | "success"; txHash: Hash; idempotent?: true }
  | { status: "already_registered" }
  | { status: "skipped"; reason: "relayer_disabled" }
  | { status: "failed"; code: string; message: string };

async function signedBy(address: Address, typed: TypedDataDefinition, signature: Hex): Promise<boolean> {
  try {
    return await verifyTypedData({ address, ...typed, signature } as Parameters<typeof verifyTypedData>[0]);
  } catch {
    return false;
  }
}

/**
 * World ID session routes (docs/worldid.md, docs/mvp-spec.md §2.1 and §5):
 * - POST /names/:label/session attaches a Proof of Human session to a name claimed without one.
 * - POST /names/:label/rotation re-verifies that session (proveSession), signs the
 *   MetaRotation attestation sender apps require before auto-accepting a changed pin,
 *   relays the registrant's ERC-6538 `registerKeysOnBehalf` for the new meta-address (so
 *   `resolveStealthMeta`'s registry cross-check keeps passing; this is part of the rotation,
 *   not of the /register allowance), and tops up the registrant's Sepolia gas for `setText`.
 */
export function rotationRoutes(deps: AppDeps, relay: RegistrationRelay): Hono {
  const r = new Hono();
  const { db, config, logger } = deps;

  const rateLimit = (ip: string) =>
    enforceRateLimits(
      db,
      [{ bucket: "rotation:ip", key: ip, limit: config.rateLimit.namesPerIp }],
      config.rateLimit.windowSeconds,
      deps.now(),
    );

  /** Makes the registry hold `meta` for `registrant`. No-op if it already does or a relay is in flight. */
  async function ensureRegistered(
    registrant: Address,
    meta: Hex,
    prepared: Prepared | undefined,
    signature: Hex | undefined,
  ): Promise<RegistryOutcome> {
    if (!relay.enabled) return { status: "skipped", reason: "relayer_disabled" };
    try {
      if (await relay.onChainMatches(registrant, meta)) return { status: "already_registered" };
      const existing = relay.findExisting(registrant, meta);
      if (existing) {
        const status = existing.status === "pending" ? await relay.refresh(existing.tx_hash) : existing.status;
        if (status === "pending" || status === "success") return { status, txHash: existing.tx_hash, idempotent: true };
      }
      if (!prepared && !signature) throw new ApiError(400, "invalid_registerSig", "registerSig is required");
      const p = prepared ?? (await relay.prepare({ registrant, meta, signature: signature! }));
      return { status: "pending", txHash: await relay.send(p, null) };
    } catch (e) {
      const err = e instanceof ApiError ? e : new ApiError(502, "relay_failed", "registry relay failed");
      logger.error("rotation: registry relay failed", { registrant, code: err.code });
      return { status: "failed", code: err.code, message: err.message };
    }
  }

  const requireWorldId = () => {
    if (!deps.worldId) throw new ApiError(503, "worldid_disabled", "World ID is disabled on this server");
    return deps.worldId;
  };

  const loadName = (raw: string) => {
    if (!isValidLabel(raw)) throw new ApiError(400, "invalid_label", "invalid label");
    const name = getName(db, raw);
    if (!name) throw new ApiError(404, "not_found", "name not found");
    return name;
  };

  // ---------------------------------------------------------------------------
  // Attach a session to an existing name

  r.post("/names/:label/session", async (c) => {
    const worldId = requireWorldId();
    const name = loadName(c.req.param("label"));
    const label = name.label;
    const body = await jsonBody(c);
    const deadline = parseDeadline(body.deadline);
    const signature = requireHex(body.signature, "signature", 65);
    if (deadline <= BigInt(deps.now())) throw new ApiError(400, "expired", "deadline has passed");
    const result = body.worldIdResult as Record<string, unknown> | undefined;
    const sessionId = result && typeof result === "object" ? result.session_id : undefined;
    if (typeof sessionId !== "string" || !/^session_[0-9a-fA-F]+$/.test(sessionId)) {
      throw new ApiError(403, result ? "proof_malformed" : "proof_missing", "worldIdResult must be an IDKit session result");
    }
    if (worldId.sessionForLabel(label)) {
      throw new ApiError(409, "session_exists", "this name already has a World ID session; it can't be replaced here");
    }
    rateLimit(deps.getIp(c));

    const ok = await signedBy(
      name.registrant,
      attachSessionTypedData({ label, sessionId, deadline, chainId: config.chainId }) as unknown as TypedDataDefinition,
      signature,
    );
    if (!ok) throw new ApiError(401, "bad_signature", "AttachSession signature does not recover to the name's registrant");

    const v = await worldId.verifyNewSession({ label, signal: sessionSignal(label, name.registrant), result, via: "attach" });
    tx(db, () => v.commit());
    logger.warn("names: world id session attached", { label, signature: redactSig(signature) });
    const bound = worldId.sessionForLabel(label)!;
    return c.json(
      { label, sessionId: bound.session_id, attachedAt: bound.attached_at, rotationAllowedFrom: bound.attached_at + config.worldId.attachCooldownSeconds },
      201,
    );
  });

  // ---------------------------------------------------------------------------
  // Rotation

  r.post("/names/:label/rotation", async (c) => {
    const worldId = requireWorldId();
    if (!deps.attester) throw new ApiError(503, "attester_disabled", "ATTESTER_PRIVATE_KEY is not configured");
    const attester = deps.attester;
    const name = loadName(c.req.param("label"));
    const label = name.label;

    const body = await jsonBody(c);
    const { uri: newMeta, bytes: newBytes } = parseMetaAddress(body.newMeta);
    const deadline = parseDeadline(body.deadline);
    const registrantSig = requireHex(body.registrantSig, "registrantSig", 65);
    // ERC-6538 signature over the new meta-address (ERC-1271 allowed, so up to 1 KiB).
    const registerSig =
      body.registerSig === undefined && !relay.enabled ? undefined : requireHex(body.registerSig, "registerSig", 1024);
    if (deadline <= BigInt(deps.now())) throw new ApiError(400, "expired", "deadline has passed");
    rateLimit(deps.getIp(c));

    const claimOk = (oldMeta: string) =>
      signedBy(
        name.registrant,
        rotationClaimTypedData({ label, oldMeta, newMeta, deadline, chainId: config.chainId }) as unknown as TypedDataDefinition,
        registrantSig,
      );

    // Retry of an already-attested rotation: finish the registry relay; no second World ID proof.
    const latest = latestAttestation(db, label);
    if (latest && latest.new_meta === newMeta && name.meta_address === newMeta) {
      if (!(await claimOk(latest.old_meta))) {
        throw new ApiError(401, "bad_signature", "RotationClaim signature does not recover to the name's registrant");
      }
      const registry = await ensureRegistered(name.registrant, newBytes, undefined, registerSig);
      return c.json({ attester: attester.address, attestation: present(latest), registry, idempotent: true }, 200);
    }

    const oldMeta = name.meta_address;
    if (newMeta === oldMeta) throw new ApiError(409, "no_change", "newMeta equals the current meta-address");
    if (!(await claimOk(oldMeta))) {
      throw new ApiError(401, "bad_signature", "RotationClaim signature does not recover to the name's registrant");
    }

    const proof = await worldId.verifyRotation({ label, signal: rotationSignal(label, newMeta, deadline), result: body.worldIdResult });

    // Simulate the registry relay before consuming the proof, so a bad registerSig costs nothing.
    let prepared: Prepared | undefined;
    if (relay.enabled && !(await relay.onChainMatches(name.registrant, newBytes))) {
      prepared = await relay.prepare({ registrant: name.registrant, meta: newBytes, signature: registerSig! });
    }

    const verifiedAt = deps.now();
    const signature = await attester.signTypedData(
      metaRotationTypedData({ label, oldMeta, newMeta, verifiedAt: BigInt(verifiedAt), chainId: config.chainId }),
    );
    const id = tx(db, () => {
      // Another change may have landed while we awaited World ID; the claim is over oldMeta.
      if (getName(db, label)!.meta_address !== oldMeta) {
        throw new ApiError(409, "stale_rotation", "the meta-address changed during this request; sign a new RotationClaim");
      }
      proof.commit();
      const res = db
        .prepare(
          `INSERT INTO attestations (label, old_meta, new_meta, verified_at, attester, signature, session_nullifier)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(label, oldMeta, newMeta, verifiedAt, attester.address, signature, proof.sessionNullifier);
      db.prepare("UPDATE names SET meta_address = ?, meta_bytes = ?, updated_at = ? WHERE label = ?").run(
        newMeta,
        newBytes,
        verifiedAt,
        label,
      );
      db.prepare(
        `INSERT INTO name_history (label, registrant, old_meta, new_meta, deadline, nullifier, tx_hash, at)
         VALUES (?, ?, ?, ?, ?, NULL, NULL, ?)`,
      ).run(label, name.registrant, oldMeta, newMeta, deadline.toString(), verifiedAt);
      return Number(res.lastInsertRowid);
    });
    // Senders pin the meta-address; this is the event their "re-verified" badge rests on.
    logger.warn("names: rotation attested", { label, oldMeta, newMeta, registrantSig: redactSig(registrantSig) });

    const registry = await ensureRegistered(name.registrant, newBytes, prepared, registerSig);
    const topup = await topUpRegistrant(deps, name.registrant);
    if (topup.status === "sent") db.prepare("UPDATE attestations SET topup_tx = ? WHERE id = ?").run(topup.txHash, id);

    const row = db.prepare("SELECT * FROM attestations WHERE id = ?").get(id) as AttestationRow;
    return c.json({ attester: attester.address, attestation: present(row), registry, topup }, 201);
  });

  r.get("/names/:label/attestations", (c) => {
    const label = c.req.param("label").toLowerCase();
    loadName(label);
    const rows = db
      .prepare("SELECT * FROM attestations WHERE label = ? ORDER BY id DESC")
      .all(label) as unknown as AttestationRow[];
    return c.json({ attester: deps.attester?.address ?? null, items: rows.map(present) });
  });

  return r;
}
