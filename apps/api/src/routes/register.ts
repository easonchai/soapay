import { Hono, type Context } from "hono";
import { getAddress, isAddress, type Address, type Hash, type Hex } from "viem";
import { jsonBody, type AppDeps } from "../app.js";
import { requireHuman } from "../hooks.js";
import type { RegistrationRelay } from "../relay.js";
import { ApiError, enforceRateLimits, parseMetaAddress, requireHex } from "../util.js";

type Outcome = { txHash: Hash; status: string; idempotent?: true };

export function registerRoutes(deps: AppDeps, relay: RegistrationRelay): Hono {
  const r = new Hono();
  const { db, config } = deps;
  /** Collapses concurrent identical submissions onto one relayer tx. */
  const inflight = new Map<string, Promise<Outcome>>();

  r.post("/register", async (c) => {
    const body = await jsonBody(c);
    const out = await submit(c, body.registrant, parseMetaAddress(body.metaAddress).bytes, body.signature, body.proof);
    return c.json(out, out.status === "pending" ? 202 : 200);
  });

  /**
   * CK's M1 relayer shape (was apps/gateway): {registrant, schemeId: 1, stealthMetaAddress (66 bytes hex),
   * signature} -> {txHash} | {error}. Same path as /register: one relayer key and nonce sequence, the same
   * rate limits, idempotency and stored receipts. Errors keep their HTTP status but use CK's flat body.
   */
  r.post("/relay", async (c) => {
    try {
      const body = await jsonBody(c);
      if (body.schemeId !== 1) throw new ApiError(400, "invalid_scheme", "schemeId must be 1");
      if (typeof body.stealthMetaAddress !== "string" || !/^0x[0-9a-fA-F]{132}$/.test(body.stealthMetaAddress)) {
        throw new ApiError(400, "invalid_meta_address", "stealthMetaAddress must be 66 bytes of hex");
      }
      const meta = parseMetaAddress(body.stealthMetaAddress).bytes;
      const out = await submit(c, body.registrant, meta, body.signature, undefined);
      return c.json({ txHash: out.txHash }, 200);
    } catch (e) {
      if (e instanceof ApiError) {
        for (const [k, v] of Object.entries(e.headers)) c.header(k, v);
        return c.json({ error: e.message }, e.status);
      }
      throw e;
    }
  });

  async function submit(c: Context, rawRegistrant: unknown, meta: Hex, rawSignature: unknown, proof: unknown): Promise<Outcome> {
    if (!relay.enabled) throw new ApiError(503, "relayer_disabled", "Registration relayer is not configured");
    if (typeof rawRegistrant !== "string" || !isAddress(rawRegistrant, { strict: false })) {
      throw new ApiError(400, "invalid_registrant", "registrant must be an address");
    }
    const registrant = getAddress(rawRegistrant);
    // ERC-6538 accepts ERC-1271 signatures too, so allow longer than 65 bytes, within reason.
    const signature = requireHex(rawSignature, "signature", 1024);
    const key = `${registrant}:${meta}`;

    // Checked and set with no await in between, so concurrent identical requests share one job.
    const pending = inflight.get(key);
    if (pending) return { ...(await pending), idempotent: true };
    const job = process({ registrant, meta, signature, ip: deps.getIp(c), proof });
    inflight.set(key, job);
    try {
      return await job;
    } finally {
      inflight.delete(key);
    }
  }

  async function process(a: { registrant: Address; meta: Hex; signature: Hex; ip: string; proof: unknown }): Promise<Outcome> {
    const { registrant, meta, signature } = a;

    // Idempotent retry: we already relayed this exact registration.
    const existing = relay.findExisting(registrant, meta);
    if (existing?.status === "pending") {
      const status = await relay.refresh(existing.tx_hash);
      if (status !== "reverted") return { txHash: existing.tx_hash, status, idempotent: true };
    } else if (existing?.status === "success") {
      if (await relay.onChainMatches(registrant, meta)) {
        return { txHash: existing.tx_hash, status: "success", idempotent: true };
      }
      // The registrant has since registered something else; this is a fresh request.
      relay.supersede(existing.tx_hash);
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

    if (await relay.onChainMatches(registrant, meta)) {
      throw new ApiError(409, "already_registered", "The registry already holds this meta-address for the registrant");
    }

    const { nullifier, commit } = await requireHuman(deps.humanVerifier, { action: "register", registrant, proof: a.proof });

    const prepared = await relay.prepare({ registrant, meta, signature });
    // The relayer has spent gas: record the tx and consume the human's sponsored registration together.
    const txHash = await relay.send(prepared, nullifier, commit);
    const status = await relay.refresh(txHash);
    if (status === "reverted") throw new ApiError(502, "tx_reverted", `Registration tx ${txHash} reverted`);
    return { txHash, status };
  }

  return r;
}
