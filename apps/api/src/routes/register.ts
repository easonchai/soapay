import { Hono } from "hono";
import { BaseError, getAddress, isAddress, type Address, type Hash, type Hex } from "viem";
import { jsonBody, type AppDeps } from "../app.js";
import { readStealthMetaAddress, sendRegisterKeysOnBehalf } from "../chain.js";
import { tx } from "../db.js";
import { requireHuman } from "../hooks.js";
import { ApiError, enforceRateLimits, parseMetaAddress, redactSig, requireHex, sameBytes } from "../util.js";

type RegistrationRow = { tx_hash: Hash; status: string; block_number: string | null };
type Outcome = { txHash: Hash; status: string; idempotent?: true };

export function registerRoutes(deps: AppDeps): Hono {
  const r = new Hono();
  const { db, config, logger } = deps;
  /** Collapses concurrent identical submissions onto one relayer tx. */
  const inflight = new Map<string, Promise<Outcome>>();
  /** One relayer, one nonce sequence: sends are serialised. */
  let sendQueue: Promise<unknown> = Promise.resolve();

  const findExisting = (registrant: Address, meta: Hex) =>
    db
      .prepare(
        `SELECT tx_hash, status, block_number FROM registrations
         WHERE registrant = ? AND meta_bytes = ? AND status IN ('pending', 'success')
         ORDER BY id DESC LIMIT 1`,
      )
      .get(registrant, meta) as RegistrationRow | undefined;

  r.post("/register", async (c) => {
    if (!deps.relayer?.account) throw new ApiError(503, "relayer_disabled", "Registration relayer is not configured");

    const body = await jsonBody(c);
    if (typeof body.registrant !== "string" || !isAddress(body.registrant, { strict: false })) {
      throw new ApiError(400, "invalid_registrant", "registrant must be an address");
    }
    const registrant = getAddress(body.registrant);
    const meta = parseMetaAddress(body.metaAddress).bytes;
    // ERC-6538 accepts ERC-1271 signatures too, so allow longer than 65 bytes, within reason.
    const signature = requireHex(body.signature, "signature", 1024);
    const key = `${registrant}:${meta}`;

    // Checked and set with no await in between, so concurrent identical requests share one job.
    const pending = inflight.get(key);
    if (pending) {
      const out = await pending;
      return c.json({ ...out, idempotent: true }, out.status === "pending" ? 202 : 200);
    }
    const job = process({ registrant, meta, signature, ip: deps.getIp(c), proof: body.proof });
    inflight.set(key, job);
    try {
      const out = await job;
      return c.json(out, out.status === "pending" ? 202 : 200);
    } finally {
      inflight.delete(key);
    }
  });

  async function process(a: { registrant: Address; meta: Hex; signature: Hex; ip: string; proof: unknown }): Promise<Outcome> {
    const { registrant, meta, signature } = a;

    // Idempotent retry: we already relayed this exact registration.
    const existing = findExisting(registrant, meta);
    if (existing?.status === "pending") {
      const status = await refreshPending(existing.tx_hash);
      if (status !== "reverted") return { txHash: existing.tx_hash, status, idempotent: true };
    } else if (existing?.status === "success") {
      if (sameBytes(await readStealthMetaAddress(deps.client, registrant), meta)) {
        return { txHash: existing.tx_hash, status: "success", idempotent: true };
      }
      // The registrant has since registered something else; this is a fresh request.
      db.prepare("UPDATE registrations SET status = 'superseded', updated_at = ? WHERE tx_hash = ?").run(
        deps.now(),
        existing.tx_hash,
      );
    }

    enforceRateLimits(
      db,
      [
        { bucket: "register:ip", key: a.ip, limit: config.rateLimit.registerPerIp },
        { bucket: "register:registrant", key: registrant, limit: config.rateLimit.registerPerRegistrant },
      ],
      config.rateLimit.windowSeconds,
      deps.now(),
    );

    const onChain = await readStealthMetaAddress(deps.client, registrant);
    if (sameBytes(onChain, meta)) {
      throw new ApiError(409, "already_registered", "The registry already holds this meta-address for the registrant");
    }

    const { nullifier, commit } = await requireHuman(deps.humanVerifier, { action: "register", registrant, proof: a.proof });

    const relayer = deps.relayer!;
    const send = sendQueue.then(() =>
      sendRegisterKeysOnBehalf(deps.client, relayer, { registrant, metaAddress: meta, signature }),
    );
    sendQueue = send.then(
      () => undefined,
      () => undefined,
    );
    let txHash: Hash;
    try {
      txHash = await send;
    } catch (e) {
      const reason = e instanceof BaseError ? e.shortMessage : "simulation failed";
      logger.warn("register: rejected", { registrant, signature: redactSig(signature), reason });
      throw new ApiError(400, "registration_rejected", `Registry rejected the registration: ${reason}`);
    }
    const now = deps.now();
    // The relayer has spent gas: record the tx and consume the human's sponsored registration together.
    tx(db, () => {
      db.prepare(
        `INSERT INTO registrations (registrant, meta_bytes, tx_hash, status, nullifier, created_at, updated_at)
         VALUES (?, ?, ?, 'pending', ?, ?, ?)`,
      ).run(registrant, meta, txHash, nullifier, now, now);
      commit();
    });
    logger.info("register: sent", { registrant, txHash, signature: redactSig(signature) });
    const status = await refreshPending(txHash);
    if (status === "reverted") throw new ApiError(502, "tx_reverted", `Registration tx ${txHash} reverted`);
    return { txHash, status };
  }

  /** Waits for a receipt and records it; returns the stored status ("pending" on timeout). */
  async function refreshPending(txHash: Hash): Promise<string> {
    try {
      const receipt = await deps.client.waitForTransactionReceipt({ hash: txHash, timeout: config.receiptTimeoutMs });
      db.prepare("UPDATE registrations SET status = ?, block_number = ?, updated_at = ? WHERE tx_hash = ?").run(
        receipt.status,
        receipt.blockNumber.toString(),
        deps.now(),
        txHash,
      );
      return receipt.status;
    } catch (e) {
      logger.warn("register: receipt not available yet", { txHash, error: (e as Error).message?.split("\n")[0] });
      return "pending";
    }
  }

  return r;
}
