import { Hono } from "hono";
import { verifyTypedData, type Hex } from "viem";
import { isValidLabel, metaRotationTypedData, rotationClaimTypedData, rotationSignal } from "@soapay/sdk";
import { jsonBody, type AppDeps } from "../app.js";
import { tx, type Db } from "../db.js";
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

/** The meta-address a rotation starts from: the last attested one, else the claimed one. */
function currentMeta(db: Db, label: string, claimed: string): string {
  const row = db
    .prepare("SELECT new_meta FROM attestations WHERE label = ? ORDER BY id DESC LIMIT 1")
    .get(label) as { new_meta: string } | undefined;
  return row?.new_meta ?? claimed;
}

function present(a: AttestationRow) {
  return { label: a.label, oldMeta: a.old_meta, newMeta: a.new_meta, verifiedAt: String(a.verified_at), signature: a.signature };
}

/**
 * Key rotation under option A (docs/mvp-spec.md §2.1): the registrant writes its own ENSv2
 * record; this route re-verifies the same human (World ID session) and issues the
 * MetaRotation attestation that sender apps require before auto-accepting the change.
 */
export function rotationRoutes(deps: AppDeps): Hono {
  const r = new Hono();
  const { db, config, logger } = deps;

  r.post("/names/:label/rotation", async (c) => {
    if (!deps.worldId) {
      throw new ApiError(503, "worldid_disabled", "World ID is disabled, so no rotation can be attested");
    }
    if (!deps.attester) throw new ApiError(503, "attester_disabled", "ATTESTER_PRIVATE_KEY is not configured");
    const label = c.req.param("label");
    if (!isValidLabel(label)) throw new ApiError(400, "invalid_label", "invalid label");
    const name = getName(db, label);
    if (!name) throw new ApiError(404, "not_found", "name not found");

    const body = await jsonBody(c);
    const { uri: newMeta } = parseMetaAddress(body.newMeta);
    const deadline = parseDeadline(body.deadline);
    const registrantSig = requireHex(body.registrantSig, "registrantSig", 65);
    if (deadline <= BigInt(deps.now())) throw new ApiError(400, "expired", "deadline has passed");
    const oldMeta = currentMeta(db, label, name.meta_address);
    if (newMeta === oldMeta) throw new ApiError(409, "no_change", "newMeta equals the current meta-address");

    enforceRateLimits(
      db,
      [{ bucket: "rotation:ip", key: deps.getIp(c), limit: config.rateLimit.namesPerIp }],
      config.rateLimit.windowSeconds,
      deps.now(),
    );

    let sigOk = false;
    try {
      sigOk = await verifyTypedData({
        address: name.registrant,
        ...rotationClaimTypedData({ label, oldMeta, newMeta, deadline, chainId: config.chainId }),
        signature: registrantSig,
      });
    } catch {
      sigOk = false;
    }
    if (!sigOk) throw new ApiError(401, "bad_signature", "RotationClaim signature does not recover to the name's registrant");

    const { commit, sessionNullifier } = await deps.worldId.verifyRotation({
      label,
      signal: rotationSignal(label, newMeta, deadline),
      result: body.worldIdResult,
    });

    const verifiedAt = deps.now();
    const signature = await deps.attester.signTypedData(
      metaRotationTypedData({ label, oldMeta, newMeta, verifiedAt: BigInt(verifiedAt), chainId: config.chainId }),
    );
    const { bytes: newBytes } = parseMetaAddress(newMeta);
    const id = tx(db, () => {
      // Another rotation may have landed while we awaited World ID; the claim is over oldMeta.
      if (currentMeta(db, label, name.meta_address) !== oldMeta) {
        throw new ApiError(409, "stale_rotation", "the meta-address changed during this request; sign a new RotationClaim");
      }
      commit();
      const res = db
        .prepare(
          `INSERT INTO attestations (label, old_meta, new_meta, verified_at, attester, signature, session_nullifier)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(label, oldMeta, newMeta, verifiedAt, deps.attester!.address, signature, sessionNullifier);
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

    const topup = await topUpRegistrant(deps, name.registrant);
    if (topup.status === "sent") db.prepare("UPDATE attestations SET topup_tx = ? WHERE id = ?").run(topup.txHash, id);

    const row = db.prepare("SELECT * FROM attestations WHERE id = ?").get(id) as AttestationRow;
    return c.json({ attester: deps.attester.address, attestation: present(row), topup }, 201);
  });

  r.get("/names/:label/attestations", (c) => {
    const label = c.req.param("label").toLowerCase();
    if (!isValidLabel(label)) throw new ApiError(400, "invalid_label", "invalid label");
    if (!getName(db, label)) throw new ApiError(404, "not_found", "name not found");
    const rows = db
      .prepare("SELECT * FROM attestations WHERE label = ? ORDER BY id DESC")
      .all(label) as unknown as AttestationRow[];
    return c.json({ attester: deps.attester?.address ?? null, items: rows.map(present) });
  });

  return r;
}
