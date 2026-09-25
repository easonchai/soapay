import { Hono } from "hono";
import { INVITE_ORG_MAX_LENGTH, inviteCodeHash, isBytes32, isValidLabel, verifyInvite } from "@soapay/sdk";
import { getAddress, isAddress, type Address, type Hex } from "viem";
import { jsonBody, type AppDeps } from "../app.js";
import { tx, type Db } from "../db.js";
import { ApiError, enforceRateLimits, redactSig, requireHex } from "../util.js";

// Employer invite links that reserve a label (docs/mvp-spec.md §7).

export type InviteRow = {
  code_hash: Hex;
  label: string;
  employer: Address;
  org: string | null;
  expires_at: number;
  signature: string;
  created_at: number;
  claimed_at: number | null;
  claimed_by: string | null;
};

export type InviteStatus = "pending" | "claimed" | "expired";

/** ERC-6492 wraps the inner signature with deployment data; allow room for it. */
const MAX_SIGNATURE_BYTES = 4096;

export function getInvite(db: Db, codeHash: string): InviteRow | undefined {
  return db.prepare("SELECT * FROM invites WHERE code_hash = ?").get(codeHash.toLowerCase()) as InviteRow | undefined;
}

/** The unclaimed, unexpired invite reserving `label`, if any. */
export function activeReservation(db: Db, label: string, now: number): InviteRow | undefined {
  return db
    .prepare("SELECT * FROM invites WHERE label = ? AND claimed_at IS NULL AND expires_at > ? ORDER BY created_at DESC LIMIT 1")
    .get(label, now) as InviteRow | undefined;
}

export function inviteStatus(row: InviteRow, now: number): InviteStatus {
  if (row.claimed_at !== null) return "claimed";
  return row.expires_at <= now ? "expired" : "pending";
}

/** Parses POST /names `inviteCode` (0x-hex 32 bytes) or undefined when absent. */
export function parseInviteCode(v: unknown): Hex | undefined {
  if (v === undefined || v === null) return undefined;
  if (!isBytes32(v)) throw new ApiError(400, "invalid_invite_code", "inviteCode must be 0x-prefixed 32-byte hex");
  return v.toLowerCase() as Hex;
}

/**
 * Decides whether a new label may be claimed, given the optional invite code.
 * Returns the code hash to mark claimed (in the same transaction as the insert), or
 * undefined for an unreserved label claimed without a code. Throws otherwise.
 */
export function checkInviteForClaim(db: Db, label: string, inviteCode: Hex | undefined, now: number): Hex | undefined {
  const reservation = activeReservation(db, label, now);
  if (!inviteCode) {
    if (reservation) throw new ApiError(403, "label_reserved", "label is reserved by an invite; an invite code is required");
    return undefined;
  }
  const codeHash = inviteCodeHash(inviteCode);
  if (reservation) {
    if (reservation.code_hash !== codeHash) {
      throw new ApiError(403, "invalid_invite_code", "invite code does not match the reservation for this label");
    }
    return codeHash;
  }
  const inv = getInvite(db, codeHash);
  if (!inv) throw new ApiError(403, "invalid_invite_code", "unknown invite code");
  if (inv.label !== label) throw new ApiError(403, "invite_label_mismatch", "the invite reserves a different label");
  const status = inviteStatus(inv, now);
  if (status === "claimed") throw new ApiError(409, "invite_claimed", "the invite was already claimed");
  // Expired (or superseded): the label is free again; claim it without the code.
  throw new ApiError(409, "invite_expired", "the invite has expired; pick a label without the code");
}

/** Marks the invite claimed. Call inside the name-insert transaction. */
export function markInviteClaimed(db: Db, codeHash: Hex, registrant: Address, now: number): void {
  const r = db
    .prepare("UPDATE invites SET claimed_at = ?, claimed_by = ? WHERE code_hash = ? AND claimed_at IS NULL AND expires_at > ?")
    .run(now, registrant, codeHash, now);
  if (Number(r.changes) !== 1) throw new ApiError(409, "invite_claimed", "the invite was already claimed or has expired");
}

function present(row: InviteRow, parent: string, now: number) {
  const status = inviteStatus(row, now);
  return {
    codeHash: row.code_hash,
    label: row.label,
    employer: row.employer,
    ...(row.org ? { org: row.org } : {}),
    expiresAt: row.expires_at,
    status,
    ...(status === "claimed" ? { name: `${row.label}.${parent}` } : {}),
  };
}

function parseExpiresAt(v: unknown): number {
  const n = typeof v === "string" && /^\d{1,15}$/.test(v) ? Number(v) : v;
  if (typeof n !== "number" || !Number.isSafeInteger(n) || n < 0) {
    throw new ApiError(400, "invalid_expires_at", "expiresAt must be unix seconds (integer or decimal string)");
  }
  return n;
}

function parseOrg(v: unknown): string | null {
  if (v === undefined || v === null || v === "") return null;
  if (typeof v !== "string") throw new ApiError(400, "invalid_org", "org must be a string");
  const org = v.trim();
  // eslint-disable-next-line no-control-regex
  if (org.length > INVITE_ORG_MAX_LENGTH || /[\u0000-\u001f\u007f]/.test(org)) {
    throw new ApiError(400, "invalid_org", `org must be at most ${INVITE_ORG_MAX_LENGTH} printable characters`);
  }
  return org || null;
}

export function inviteRoutes(deps: AppDeps): Hono {
  const r = new Hono();
  const { db, config, logger } = deps;
  const windowSeconds = config.rateLimit.windowSeconds;

  r.post("/invites", async (c) => {
    const body = await jsonBody(c);
    const label = body.label;
    if (typeof label !== "string" || !isValidLabel(label)) {
      throw new ApiError(400, "invalid_label", "label must be 3-32 of [a-z0-9-], no leading/trailing hyphen, no '--' at 3-4");
    }
    if (typeof body.employer !== "string" || !isAddress(body.employer, { strict: false })) {
      throw new ApiError(400, "invalid_employer", "employer must be an address");
    }
    const employer = getAddress(body.employer);
    if (!isBytes32(body.codeHash)) throw new ApiError(400, "invalid_code_hash", "codeHash must be 0x-prefixed 32-byte hex");
    const codeHash = body.codeHash.toLowerCase() as Hex;
    const expiresAt = parseExpiresAt(body.expiresAt);
    const signature = requireHex(body.signature, "signature", MAX_SIGNATURE_BYTES);
    const org = parseOrg(body.org);
    const now = deps.now();

    // Per-IP before the (possibly RPC-backed) signature check; per-employer only once the
    // employer is proven, so nobody can burn another employer's quota with junk signatures.
    enforceRateLimits(db, [{ bucket: "invites:ip", key: deps.getIp(c), limit: config.rateLimit.invitesPerIp }], windowSeconds, now);

    const v = await verifyInvite(deps.client, {
      label,
      employer,
      codeHash,
      expiresAt: BigInt(expiresAt),
      chainId: config.chainId,
      signature,
      nowSeconds: BigInt(now),
    });
    if (!v.valid) {
      if (v.reason === "bad-signature") throw new ApiError(401, "bad_signature", "Invite signature is not valid for employer");
      throw new ApiError(400, v.reason.replaceAll("-", "_"), "invalid invite: " + v.reason);
    }

    // Identical retry (same code, same signed fields): answer as before, no new quota spent.
    const same = getInvite(db, codeHash);
    if (same && same.label === label && same.employer === employer && same.expires_at === expiresAt) {
      return c.json({ codeHash, expiresAt }, 200);
    }

    enforceRateLimits(
      db,
      [{ bucket: "invites:employer", key: employer, limit: config.rateLimit.invitesPerEmployer }],
      windowSeconds,
      now,
    );

    tx(db, () => {
      if (getInvite(db, codeHash)) throw new ApiError(409, "code_exists", "an invite with this codeHash already exists");
      if (db.prepare("SELECT 1 FROM names WHERE label = ?").get(label)) throw new ApiError(409, "label_taken", "label is already taken");
      if (activeReservation(db, label, now)) {
        throw new ApiError(409, "label_reserved", "label is already reserved by an unexpired invite");
      }
      db.prepare(
        `INSERT INTO invites (code_hash, label, employer, org, expires_at, signature, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run(codeHash, label, employer, org, expiresAt, signature, now);
    });
    logger.info("invites: reserved", { label, employer, expiresAt, signature: redactSig(signature) });
    return c.json({ codeHash, expiresAt }, 201);
  });

  r.get("/invites/:codeHash", (c) => {
    const codeHash = c.req.param("codeHash");
    if (!isBytes32(codeHash)) throw new ApiError(400, "invalid_code_hash", "codeHash must be 0x-prefixed 32-byte hex");
    const row = getInvite(db, codeHash);
    if (!row) throw new ApiError(404, "not_found", "invite not found");
    return c.json(present(row, config.parentName, deps.now()));
  });

  return r;
}
