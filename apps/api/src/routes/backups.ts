import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { BACKUP_MAX_BYTES, backupMessage, base64DecodedLength, isBackupCiphertext } from "@soapay/sdk";
import { getAddress, isAddress, type Address } from "viem";
import { jsonBody, type AppDeps } from "../app.js";
import { tx } from "../db.js";
import { ApiError, enforceRateLimits, errorBody, redactSig, requireHex } from "../util.js";

// Encrypted app backups (docs/mvp-spec.md §4, D-62). Shared by the company and employee apps.
// The server stores an opaque, client-encrypted envelope per wallet. It never sees plaintext or
// keys; it only checks that the wallet signed the write and that the version moves forward.

/** ERC-6492 wraps the inner signature with deployment data; allow room for it. */
const MAX_SIGNATURE_BYTES = 4096;

/** The route-level JSON body cap: the base64 of BACKUP_MAX_BYTES plus room for the other fields. */
export const BACKUP_BODY_LIMIT_BYTES = Math.ceil(BACKUP_MAX_BYTES / 3) * 4 + 16 * 1024;

type BackupRow = { address: Address; version: number; ciphertext: string; updated_at: number };

function parseAddress(v: string): Address {
  if (!isAddress(v, { strict: false })) throw new ApiError(400, "invalid_address", "address must be an EVM address");
  return getAddress(v);
}

export function backupRoutes(deps: AppDeps): Hono {
  const r = new Hono();
  const { db, config, logger } = deps;
  const rl = config.rateLimit;
  const current = (address: Address) =>
    db.prepare("SELECT * FROM vault_backups WHERE address = ?").get(address) as BackupRow | undefined;

  r.get("/backups/:address", (c) => {
    const address = parseAddress(c.req.param("address"));
    enforceRateLimits(db, [{ bucket: "backups:read:ip", key: deps.getIp(c), limit: rl.backupReadsPerIp }], rl.windowSeconds, deps.now());
    const row = current(address);
    if (!row) throw new ApiError(404, "not_found", "no backup for this address");
    return c.json({ address: row.address, version: row.version, ciphertext: row.ciphertext, updatedAt: row.updated_at });
  });

  r.put(
    "/backups/:address",
    bodyLimit({
      maxSize: BACKUP_BODY_LIMIT_BYTES,
      onError: (c) => c.json(errorBody("too_large", `Backups are at most ${BACKUP_MAX_BYTES} bytes`), 413),
    }),
    async (c) => {
      const address = parseAddress(c.req.param("address"));
      const body = await jsonBody(c);
      const version = body.version;
      if (typeof version !== "number" || !Number.isSafeInteger(version) || version < 1) {
        throw new ApiError(400, "invalid_version", "version must be a positive integer");
      }
      const ciphertext = body.ciphertext;
      if (!isBackupCiphertext(ciphertext)) throw new ApiError(400, "invalid_ciphertext", "ciphertext must be non-empty base64");
      if (base64DecodedLength(ciphertext) > BACKUP_MAX_BYTES) {
        throw new ApiError(413, "too_large", `Backups are at most ${BACKUP_MAX_BYTES} bytes`);
      }
      const signature = requireHex(body.signature, "signature", MAX_SIGNATURE_BYTES);
      const now = deps.now();

      const stale = (row: BackupRow | undefined) =>
        row && version <= row.version
          ? c.json({ ...errorBody("stale_version", `version must be greater than ${row.version}`), version: row.version }, 409)
          : null;
      // Cheap check first: the stored version is public (GET), so this leaks nothing.
      const early = stale(current(address));
      if (early) return early;

      // Per-IP before the (RPC-backed) signature check; per-wallet only once the wallet is proven,
      // so junk signatures can't burn someone else's quota.
      enforceRateLimits(db, [{ bucket: "backups:write:ip", key: deps.getIp(c), limit: rl.backupWritesPerIp }], rl.windowSeconds, now);
      let valid = false;
      try {
        // viem's public-client verifyMessage covers EOAs, ERC-1271 contracts, ERC-6492 counterfactual
        // wallets and 7702-delegated EOAs, on the API's chain.
        valid = await deps.client.verifyMessage({ address, message: backupMessage({ address, version, ciphertext }), signature });
      } catch (e) {
        logger.warn("backups: signature check failed", { address, error: (e as Error).message?.split("\n")[0] });
        valid = false;
      }
      if (!valid) throw new ApiError(401, "bad_signature", "signature is not valid for this address");
      enforceRateLimits(db, [{ bucket: "backups:write:address", key: address, limit: rl.backupWritesPerAddress }], rl.windowSeconds, now);

      const conflict = tx(db, () => {
        const row = current(address);
        if (row && version <= row.version) return row;
        db.prepare(
          `INSERT INTO vault_backups (address, version, ciphertext, updated_at) VALUES (?, ?, ?, ?)
           ON CONFLICT(address) DO UPDATE SET version = excluded.version, ciphertext = excluded.ciphertext, updated_at = excluded.updated_at`,
        ).run(address, version, ciphertext, now);
        return undefined;
      });
      const late = stale(conflict);
      if (late) return late;
      logger.info("backups: stored", { address, version, bytes: base64DecodedLength(ciphertext), signature: redactSig(signature) });
      return c.json({ address, version }, 200);
    },
  );

  return r;
}
