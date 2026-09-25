import { Hono } from "hono";
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
      rp_id: cfg.rpId ?? null,
      environment: cfg.environment,
      actions: { enroll: cfg.enrollAction },
      attester: deps.attester?.address ?? null,
    }),
  );

  /**
   * Signs a fresh RP context (`signRequest` from @worldcoin/idkit-server) for one IDKit request.
   * Body: {kind: "uniqueness" | "session", action?}. Uniqueness requests are signed with the
   * enroll action; sessions without one.
   */
  r.post("/worldid/rp-context", async (c) => {
    if (!deps.worldId) throw new ApiError(503, "worldid_disabled", "World ID is disabled on this server");
    const body = await jsonBody(c);
    const kind = body.kind;
    if (kind !== "uniqueness" && kind !== "session") {
      throw new ApiError(400, "invalid_kind", 'kind must be "uniqueness" or "session"');
    }
    if (body.action !== undefined && typeof body.action !== "string") {
      throw new ApiError(400, "invalid_action", "action must be a string");
    }
    enforceRateLimits(
      db,
      [{ bucket: "rp-context:ip", key: deps.getIp(c), limit: cfg.rpContextPerIp }],
      config.rateLimit.windowSeconds,
      deps.now(),
    );
    return c.json(deps.worldId.issueRpContext(kind, body.action as string | undefined));
  });

  return r;
}
