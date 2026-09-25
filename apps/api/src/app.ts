import { Hono, type Context } from "hono";
import { cors } from "hono/cors";
import { bodyLimit } from "hono/body-limit";
import type { Config } from "./config.js";
import type { Db } from "./db.js";
import type { ReadClient, WriteClient } from "./chain.js";
import type { Indexer } from "./indexer.js";
import { ApiError, errorBody, type Logger } from "./util.js";
import { allowAllVerifier, NoopNameIssuer, type HumanVerifier, type NameIssuer } from "./hooks.js";
import { healthRoutes } from "./routes/health.js";
import { registerRoutes } from "./routes/register.js";
import { nameRoutes } from "./routes/names.js";
import { announcementRoutes } from "./routes/announcements.js";
import { worldIdRoutes } from "./routes/worldid.js";
import { rotationRoutes } from "./routes/rotation.js";
import type { WorldId } from "./worldid/verifier.js";
import type { L1Funder } from "./topup.js";
import type { LocalAccount } from "viem";

export type AppDeps = {
  config: Config;
  db: Db;
  /** Target-chain (Base) reads: registry, simulation, receipts, logs. */
  client: ReadClient;
  /** Relayer wallet; undefined disables POST /register (503). */
  relayer: WriteClient | undefined;
  indexer: Indexer | undefined;
  logger: Logger;
  /** Unix seconds; injectable for tests. */
  now: () => number;
  /** Client IP for rate limiting. */
  getIp: (c: Context) => string;
  /** On-chain subname issuance (ENSv2). Default: NoopNameIssuer (store only). */
  nameIssuer: NameIssuer;
  /** Proof-of-personhood gate for /register and /names. Default: allow all. */
  humanVerifier: HumanVerifier;
  /** World ID (IDKit 4). Undefined = disabled: /worldid/rp-context and rotation return 503. */
  worldId: WorldId | undefined;
  /** Signs MetaRotation attestations. Undefined → rotation returns 503. */
  attester: LocalAccount | undefined;
  /** Ethereum Sepolia gas sponsor for the registrant's setText. Undefined → no top-ups. */
  l1Funder: L1Funder | undefined;
};

type Optional = "nameIssuer" | "humanVerifier" | "worldId" | "attester" | "l1Funder";
export type BuildAppDeps = Omit<AppDeps, Optional> & { [K in Optional]?: AppDeps[K] | undefined };

export function buildApp(input: BuildAppDeps): Hono {
  const deps: AppDeps = {
    ...input,
    nameIssuer: input.nameIssuer ?? new NoopNameIssuer(),
    // With World ID configured, its verifier gates /register and /names unless overridden.
    humanVerifier: input.humanVerifier ?? input.worldId?.humanVerifier ?? allowAllVerifier,
    worldId: input.worldId,
    attester: input.attester,
    l1Funder: input.l1Funder,
  };
  const { config, logger } = deps;
  const app = new Hono();

  app.use("*", cors({ origin: config.corsOrigins, allowMethods: ["GET", "POST", "OPTIONS"], maxAge: 600 }));
  app.use(
    "*",
    bodyLimit({
      maxSize: config.bodyLimitBytes,
      onError: (c) => c.json(errorBody("payload_too_large", `Body exceeds ${config.bodyLimitBytes} bytes`), 413),
    }),
  );

  app.route("/", healthRoutes(deps));
  app.route("/", registerRoutes(deps));
  app.route("/", nameRoutes(deps));
  app.route("/", rotationRoutes(deps));
  app.route("/", worldIdRoutes(deps));
  app.route("/", announcementRoutes(deps));

  app.notFound((c) => c.json(errorBody("not_found", "Route not found"), 404));
  app.onError((err, c) => {
    if (err instanceof ApiError) {
      for (const [k, v] of Object.entries(err.headers)) c.header(k, v);
      return c.json(errorBody(err.code, err.message), err.status);
    }
    logger.error("unhandled error", { path: c.req.path, error: err.message?.split("\n")[0] });
    return c.json(errorBody("internal", "Internal server error"), 500);
  });
  return app;
}

/** Parses a JSON object body or throws a 400. */
export async function jsonBody(c: Context): Promise<Record<string, unknown>> {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    throw new ApiError(400, "invalid_json", "Body must be JSON");
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new ApiError(400, "invalid_json", "Body must be a JSON object");
  }
  return body as Record<string, unknown>;
}
