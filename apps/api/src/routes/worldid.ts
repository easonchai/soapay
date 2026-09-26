import { Hono } from "hono";
import { WORLD_ID_CREDENTIAL } from "@soapay/sdk";
import { jsonBody, type AppDeps } from "../app.js";
import { ApiError, enforceRateLimits } from "../util.js";

export function worldIdRoutes(deps: AppDeps): Hono {
  const r = new Hono();
  const { config, db } = deps;
  const cfg = config.worldId;

  /** Public parameters the clients need. Never includes the signing key. */
  r.get("/worldid/config", (c) =>
    c.json({
      enabled: !cfg.disabled && !!deps.worldId,
      app_id: cfg.appId,
      rp_id: cfg.rpId,
      environment: cfg.environment,
      credential: WORLD_ID_CREDENTIAL,
      attach_cooldown_seconds: cfg.attachCooldownSeconds,
      attester: deps.attester?.address ?? null,
    }),
  );

  /**
   * Signs a fresh RP context (`signRequest` from @worldcoin/idkit-server) for one IDKit
   * session request: creating a session or proving an existing one. Body: `{}` or
   * `{kind: "session"}`. Sessions take no action, and Soapay has no uniqueness requests.
   */
  r.post("/worldid/rp-context", async (c) => {
    if (!deps.worldId) throw new ApiError(503, "worldid_disabled", "World ID is disabled on this server");
    const body = await jsonBody(c);
    if (body.kind !== undefined && body.kind !== "session") {
      throw new ApiError(400, "invalid_kind", 'kind must be "session" (Soapay only uses World ID sessions)');
    }
    enforceRateLimits(
      db,
      [{ bucket: "rp-context:ip", key: deps.getIp(c), limit: cfg.rpContextPerIp }],
      config.rateLimit.windowSeconds,
      deps.now(),
    );
    if (body.bind !== undefined && (typeof body.bind !== "string" || body.bind.length === 0 || body.bind.length > 512)) {
      throw new ApiError(400, "invalid_bind", "bind must be the Soapay signal string for this request");
    }
    return c.json(deps.worldId.issueRpContext(body.bind as string | undefined));
  });

  return r;
}
