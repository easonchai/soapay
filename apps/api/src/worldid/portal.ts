import type { WorldIdConfig } from "../config.js";
import { ApiError, type Logger } from "../util.js";

export type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

export type PortalSuccess = {
  success: true;
  action?: string;
  nullifier?: string;
  environment?: string;
  session_id?: string;
  results?: { identifier?: string; success?: boolean; nullifier?: string; code?: string; detail?: string }[];
};

/**
 * POST {verifyBaseUrl}/api/v4/verify/{rp_id} with the IDKit result forwarded as-is.
 * Throws ApiError: 403 for a rejected proof, 503 when the portal is unreachable.
 * Checks the response's `environment` against WORLD_ENV (staging = the simulator).
 * Staging verification needs `x-staging-verification-token` (WORLD_STAGING_VERIFY_TOKEN);
 * production doesn't. The token is never logged.
 */
export async function portalVerify(
  cfg: WorldIdConfig,
  fetchFn: Fetch,
  logger: Logger,
  result: unknown,
): Promise<PortalSuccess> {
  const url = `${cfg.verifyBaseUrl}/api/v4/verify/${cfg.rpId}`;
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (cfg.environment === "staging" && cfg.stagingVerifyToken) headers["x-staging-verification-token"] = cfg.stagingVerifyToken;
  let res: Response;
  try {
    res = await fetchFn(url, {
      method: "POST",
      headers,
      body: JSON.stringify(result),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (e) {
    logger.error("worldid: portal unreachable", { error: (e as Error).message?.split("\n")[0] });
    throw new ApiError(503, "worldid_unavailable", "World ID verification service is unreachable; try again");
  }
  let body: any = null;
  try {
    body = await res.json();
  } catch {
    // fall through with body = null
  }
  if (res.status >= 500 || res.status === 429) {
    logger.error("worldid: portal error", { status: res.status });
    throw new ApiError(503, "worldid_unavailable", "World ID verification service failed; try again");
  }
  if (!res.ok || !body || body.success !== true) {
    const code = typeof body?.code === "string" ? body.code : `http_${res.status}`;
    logger.warn("worldid: proof rejected", { status: res.status, code, detail: body?.detail });
    throw new ApiError(403, "proof_invalid", `World ID rejected the proof (${code})`);
  }
  const env = body.environment ?? "production"; // the API defaults environment to production
  if (env !== cfg.environment) {
    throw new ApiError(
      403,
      "environment_mismatch",
      `proof is from the ${env} environment, this server expects ${cfg.environment}`,
    );
  }
  // 200 means "at least one proof verified"; every response item must have.
  if (Array.isArray(body.results) && body.results.some((r: any) => r?.success === false)) {
    throw new ApiError(403, "proof_invalid", "World ID rejected part of the proof");
  }
  return body as PortalSuccess;
}
