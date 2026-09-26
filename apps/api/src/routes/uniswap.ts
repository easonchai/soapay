import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { AppDeps } from "../app.js";
import { ApiError, enforceRateLimits, errorBody } from "../util.js";

/**
 * The only Trading API endpoint the SDK uses (packages/sdk/src/swap.ts). `/swap` and
 * `/check_approval` are closed: their bodies would name the paying address (D-27).
 */
const ENDPOINTS = new Set(["quote"]);
/** Request headers passed upstream; everything else (cookies, origin, x-api-key…) is dropped. */
const FORWARD_HEADERS = ["x-universal-router-version", "x-agent-info", "x-permit2-disabled"];
const UPSTREAM_TIMEOUT_MS = 15_000;

/**
 * Uniswap Trading API proxy: POST /uniswap/quote → {UNISWAP_API_URL}/quote with
 * `x-api-key: UNISWAP_API_KEY`. The key never ships in a client bundle, and the browser avoids the
 * Trading API's CORS rules. The SDK uses it as `apiUrl: "<api>/uniswap"`.
 *
 * The SDK quotes for a random placeholder swapper and refuses to send the stealth address
 * (`assertNoStealthAddress`), so this proxy never sees one. Bodies are still never logged.
 * Without a key it answers 503 `uniswap_disabled`, and the SDK falls back to the on-chain path.
 */
export function uniswapRoutes(deps: AppDeps): Hono {
  const r = new Hono();
  const { config, db, logger } = deps;
  const cfg = config.uniswap;

  r.post(
    "/uniswap/:endpoint",
    bodyLimit({
      maxSize: cfg.bodyLimitBytes,
      onError: (c) => c.json(errorBody("payload_too_large", `Body exceeds ${cfg.bodyLimitBytes} bytes`), 413),
    }),
    async (c) => {
      const endpoint = c.req.param("endpoint");
      if (!ENDPOINTS.has(endpoint)) throw new ApiError(404, "not_found", "unknown Trading API endpoint");
      if (!cfg.apiKey) {
        return c.json({ code: "uniswap_disabled", ...errorBody("uniswap_disabled", "UNISWAP_API_KEY is not configured") }, 503);
      }
      enforceRateLimits(db, [{ bucket: "uniswap:ip", key: deps.getIp(c), limit: cfg.perIpPerMinute }], 60, deps.now());

      const body = await c.req.text();
      try {
        JSON.parse(body);
      } catch {
        throw new ApiError(400, "invalid_json", "Body must be JSON");
      }
      const headers: Record<string, string> = {
        "content-type": "application/json",
        accept: "application/json",
        "x-api-key": cfg.apiKey,
      };
      for (const h of FORWARD_HEADERS) {
        const v = c.req.header(h);
        if (v !== undefined && v.length <= 1024) headers[h] = v;
      }

      let res: Response;
      try {
        res = await deps.uniswapFetch(`${cfg.baseUrl}/${endpoint}`, {
          method: "POST",
          headers,
          body,
          signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
        });
      } catch (e) {
        const timeout = (e as Error).name === "TimeoutError";
        logger.warn("uniswap: upstream unreachable", { endpoint, timeout });
        throw new ApiError(timeout ? 504 : 502, "uniswap_unreachable", "Uniswap Trading API is unreachable");
      }
      // Status only: never the request or response body.
      if (!res.ok) logger.warn("uniswap: upstream error", { endpoint, status: res.status });
      const text = await res.text();
      return c.body(text, res.status as ContentfulStatusCode, {
        "content-type": res.headers.get("content-type") ?? "application/json",
        "cache-control": "no-store",
      });
    },
  );

  return r;
}
