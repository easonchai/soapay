import { Hono } from "hono";
import { isValidLabel, sessionSignal, verifyNameClaim } from "@soapay/sdk";
import { getAddress, isAddress, type Address } from "viem";
import { jsonBody, type AppDeps } from "../app.js";
import { readStealthMetaAddress } from "../chain.js";
import { tx, type Db } from "../db.js";
import { requireHuman } from "../hooks.js";
import type { VerifiedSession } from "../worldid/verifier.js";
import { checkInviteForClaim, markInviteClaimed, parseInviteCode } from "./invites.js";
import { ApiError, enforceRateLimits, parseMetaAddress, redactSig, requireHex, sameBytes } from "../util.js";

const UINT256_MAX = (1n << 256n) - 1n;

type NameRow = {
  label: string;
  registrant: Address;
  meta_address: string;
  meta_bytes: string;
  deadline: string;
  issue_tx_hash: string | null;
  created_at: number;
  updated_at: number;
};

export function getName(db: Db, label: string): NameRow | undefined {
  return db.prepare("SELECT * FROM names WHERE label = ?").get(label) as NameRow | undefined;
}

function present(row: NameRow, parent: string, db: Db) {
  const session = db.prepare("SELECT attached_at FROM name_sessions WHERE label = ?").get(row.label) as
    | { attached_at: number }
    | undefined;
  return {
    label: row.label,
    name: `${row.label}.${parent}`,
    registrant: row.registrant,
    metaAddress: row.meta_address,
    deadline: row.deadline,
    txHash: row.issue_tx_hash,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    /** Whether a World ID session backs rotations of this name (never the session id itself). */
    worldIdSession: session ? { attachedAt: session.attached_at } : null,
  };
}

export function parseDeadline(v: unknown): bigint {
  let d: bigint;
  try {
    if (typeof v === "number" && Number.isSafeInteger(v)) d = BigInt(v);
    else if (typeof v === "string" && /^\d{1,78}$/.test(v)) d = BigInt(v);
    else throw new Error();
  } catch {
    throw new ApiError(400, "invalid_deadline", "deadline must be a uint256 (decimal string or integer, unix seconds)");
  }
  if (d > UINT256_MAX) throw new ApiError(400, "invalid_deadline", "deadline exceeds uint256");
  return d;
}

export function nameRoutes(deps: AppDeps): Hono {
  const r = new Hono();
  const { db, config, logger } = deps;
  const labelLocks = new Map<string, Promise<void>>();

  r.post("/names", async (c) => {
    const body = await jsonBody(c);
    const label = body.label;
    if (typeof label !== "string" || !isValidLabel(label)) {
      throw new ApiError(400, "invalid_label", "label must be 3-32 of [a-z0-9-], no leading/trailing hyphen, no '--' at 3-4");
    }
    if (typeof body.registrant !== "string" || !isAddress(body.registrant, { strict: false })) {
      throw new ApiError(400, "invalid_registrant", "registrant must be an address");
    }
    const registrant = getAddress(body.registrant);
    // Claims are signed over the canonical st:eth:0x<lowercase> URI; that is what we store and serve.
    const { bytes: metaBytes, uri: metaAddress } = parseMetaAddress(body.metaAddress);
    const deadline = parseDeadline(body.deadline);
    const signature = requireHex(body.signature, "signature", 65);
    const inviteCode = parseInviteCode(body.inviteCode);

    if (deadline <= BigInt(deps.now())) throw new ApiError(400, "expired", "deadline has passed");

    const v = await verifyNameClaim({
      label,
      registrant,
      metaAddress,
      deadline,
      chainId: config.chainId,
      signature,
      nowSeconds: BigInt(deps.now()),
    });
    if (!v.valid) {
      if (v.reason === "bad-signature") {
        throw new ApiError(401, "bad_signature", "NameClaim signature does not recover to registrant");
      }
      throw new ApiError(400, v.reason.replaceAll("-", "_"), "invalid name claim: " + v.reason);
    }

    const existing = getName(db, label);
    if (existing && existing.registrant !== registrant) throw new ApiError(409, "label_taken", "label is already taken");
    if (existing && BigInt(existing.deadline) === deadline && existing.meta_address === metaAddress) {
      return c.json(present(existing, config.parentName, db)); // idempotent retry
    }
    if (existing && deadline <= BigInt(existing.deadline)) {
      throw new ApiError(409, "stale_claim", "an update needs a later deadline than the stored claim");
    }
    // A label reserved by an unexpired invite needs the matching code (docs/mvp-spec.md §7).
    // Updates of an existing name ignore invites: the label already belongs to the registrant.
    if (!existing) checkInviteForClaim(db, label, inviteCode, deps.now());

    enforceRateLimits(
      db,
      [{ bucket: "names:ip", key: deps.getIp(c), limit: config.rateLimit.namesPerIp }],
      config.rateLimit.windowSeconds,
      deps.now(),
    );

    let onChain = await readStealthMetaAddress(deps.client, registrant);
    if (!sameBytes(onChain, metaBytes)) {
      // Read-after-write lag: public RPCs are load-balanced, so a node may not yet see a
      // registration this API just relayed. If we relayed exactly this meta-address, re-read at
      // the block it landed in (retrying while the node catches up) instead of rejecting.
      const relayed = db
        .prepare(
          `SELECT block_number FROM registrations
           WHERE lower(registrant) = lower(?) AND lower(meta_bytes) = lower(?) AND status = 'success'
             AND block_number IS NOT NULL
           ORDER BY id DESC LIMIT 1`,
        )
        .get(registrant, metaBytes) as { block_number: string } | undefined;
      if (relayed) {
        for (let attempt = 0; attempt < 5 && !sameBytes(onChain, metaBytes); attempt++) {
          try {
            onChain = await readStealthMetaAddress(deps.client, registrant, BigInt(relayed.block_number));
          } catch {
            await new Promise((r) => setTimeout(r, 1_000));
          }
        }
      }
    }
    if (!sameBytes(onChain, metaBytes)) {
      throw new ApiError(409, "meta_mismatch", "metaAddress does not match stealthMetaAddressOf(registrant, 1) on-chain");
    }

    const { nullifier, commit } = await requireHuman(deps.humanVerifier, {
      action: existing ? "update-meta" : "name",
      registrant,
      proof: body.proof,
      label,
      metaAddress,
      deadline,
    });

    // Optional World ID session (Selfie Check) created at enrollment, bound to label + registrant.
    let session: VerifiedSession | undefined;
    if (body.worldIdSession !== undefined && body.worldIdSession !== null) {
      if (existing) {
        throw new ApiError(400, "use_session_route", "attach a session to an existing name with POST /names/:label/session");
      }
      if (!deps.worldId) throw new ApiError(503, "worldid_disabled", "World ID is disabled on this server");
      session = await deps.worldId.verifyNewSession({
        label,
        signal: sessionSignal(label, registrant),
        result: body.worldIdSession,
        via: "enroll",
      });
    }

    // Serialise per label so two racing claims can't both reach the issuer.
    const prev = labelLocks.get(label) ?? Promise.resolve();
    let release!: () => void;
    const mine = new Promise<void>((res) => (release = res));
    const chained = prev.then(() => mine);
    labelLocks.set(label, chained);
    await prev;
    let issueTx: string | undefined;
    try {
      // Re-check now that we hold the label; another request may have won.
      const cur = getName(db, label);
      if (cur && cur.registrant !== registrant) throw new ApiError(409, "label_taken", "label is already taken");
      if (cur && deadline <= BigInt(cur.deadline)) {
        throw new ApiError(409, "stale_claim", "an update needs a later deadline than the stored claim");
      }
      const inviteHash = cur ? undefined : checkInviteForClaim(db, label, inviteCode, deps.now());

      const args = { label, registrant, metaAddress };
      try {
        if (!cur) issueTx = (await deps.nameIssuer.issue(args)).txHash;
        else if (deps.nameIssuer.updateMeta) issueTx = (await deps.nameIssuer.updateMeta(args)).txHash;
      } catch (e) {
        logger.error("names: issuer failed", { label, registrant, error: (e as Error).message?.split("\n")[0] });
        throw new ApiError(502, "issue_failed", "on-chain name issuance failed; nothing was stored");
      }

      const now = deps.now();
      tx(db, () => {
        // Claimed in the same transaction as the insert; throws (and rolls back) if it lost a race.
        if (inviteHash) markInviteClaimed(db, inviteHash, registrant, now);
        if (cur) {
          db.prepare(
            `UPDATE names SET meta_address = ?, meta_bytes = ?, deadline = ?, signature = ?,
               nullifier = COALESCE(?, nullifier), issue_tx_hash = COALESCE(?, issue_tx_hash), updated_at = ?
             WHERE label = ?`,
          ).run(metaAddress, metaBytes, deadline.toString(), signature, nullifier, issueTx ?? null, now, label);
        } else {
          db.prepare(
            `INSERT INTO names (label, registrant, meta_address, meta_bytes, deadline, signature, nullifier, issue_tx_hash, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          ).run(label, registrant, metaAddress, metaBytes, deadline.toString(), signature, nullifier, issueTx ?? null, now, now);
        }
        db.prepare(
          `INSERT INTO name_history (label, registrant, old_meta, new_meta, deadline, nullifier, tx_hash, at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(label, registrant, cur?.meta_address ?? null, metaAddress, deadline.toString(), nullifier, issueTx ?? null, now);
        commit();
        session?.commit();
      });
    } finally {
      release();
      if (labelLocks.get(label) === chained) labelLocks.delete(label);
    }

    if (existing) {
      // Senders pin the meta-address and must alert the employer when it changes; log it loudly.
      logger.warn("names: meta-address updated", {
        label,
        registrant,
        oldMeta: existing.meta_address,
        newMeta: metaAddress,
        signature: redactSig(signature),
      });
    } else {
      logger.info("names: claimed", { label, registrant, signature: redactSig(signature) });
    }
    return c.json(present(getName(db, label)!, config.parentName, db), existing ? 200 : 201);
  });

  r.get("/names/:label", (c) => {
    const label = c.req.param("label").toLowerCase();
    if (!isValidLabel(label)) throw new ApiError(400, "invalid_label", "invalid label");
    const row = getName(db, label);
    if (!row) throw new ApiError(404, "not_found", "name not found");
    return c.json(present(row, config.parentName, db));
  });

  return r;
}
