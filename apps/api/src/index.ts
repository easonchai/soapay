import { serve } from "@hono/node-server";
import { getConnInfo } from "@hono/node-server/conninfo";
import type { Context } from "hono";
import { createPublicClient, createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { getChainConfig } from "@soapay/sdk";
import { buildApp } from "./app.js";
import type { ReadClient, WriteClient } from "./chain.js";
import { ConfigError, loadConfig } from "./config.js";
import { openDb } from "./db.js";
import { Indexer } from "./indexer.js";
import { allowAllVerifier, NoopNameIssuer } from "./hooks.js";
import { consoleLogger as logger, pruneRateLimits } from "./util.js";

function main() {
  let config;
  try {
    config = loadConfig(process.env);
  } catch (e) {
    if (e instanceof ConfigError) {
      console.error(e.message);
      process.exit(1);
    }
    throw e;
  }

  const { chain } = getChainConfig(config.chainId);
  const transport = http(config.rpcUrl, { retryCount: 2, timeout: 30_000 });
  const publicClient = createPublicClient({ chain, transport });
  const relayer = config.relayerPrivateKey
    ? createWalletClient({ chain, transport, account: privateKeyToAccount(config.relayerPrivateKey) })
    : undefined;
  if (!relayer) logger.warn("RELAYER_PRIVATE_KEY not set: POST /register is disabled");

  const db = openDb(config.dbPath);
  const client = publicClient as unknown as ReadClient;
  const indexer = new Indexer({
    db,
    client,
    startBlock: config.indexer.startBlock,
    chunkSize: config.indexer.chunkSize,
    pollMs: config.indexer.pollMs,
    reorgDepth: config.indexer.reorgDepth,
    logger,
  });

  const getIp = (c: Context): string => {
    if (config.trustProxy) {
      const fwd = c.req.header("x-forwarded-for")?.split(",")[0]?.trim();
      if (fwd) return fwd;
    }
    try {
      return getConnInfo(c).remote.address ?? "unknown";
    } catch {
      return "unknown";
    }
  };

  const app = buildApp({
    config,
    db,
    client,
    relayer: relayer as unknown as WriteClient | undefined,
    indexer,
    logger,
    now: () => Math.floor(Date.now() / 1000),
    getIp,
    // ENSv2 issuer and World ID verifier plug in here; defaults are store-only and allow-all.
    nameIssuer: new NoopNameIssuer(),
    humanVerifier: allowAllVerifier,
  });

  if (config.indexer.enabled) indexer.start();
  const pruner = setInterval(
    () => pruneRateLimits(db, Math.floor(Date.now() / 1000), config.rateLimit.windowSeconds),
    10 * 60_000,
  );
  pruner.unref();

  const server = serve({ fetch: app.fetch, port: config.port });
  logger.info("api listening", {
    port: config.port,
    chainId: config.chainId,
    relayer: relayer?.account.address ?? null,
  });

  const shutdown = (sig: string) => {
    logger.info("shutting down", { sig });
    indexer.stop();
    server.close(() => {
      db.close();
      process.exit(0);
    });
    setTimeout(() => process.exit(0), 5_000).unref();
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main();
