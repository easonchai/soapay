import { serve } from "@hono/node-server";
import { getConnInfo } from "@hono/node-server/conninfo";
import type { Context } from "hono";
import { createPublicClient, createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import { getChainConfig } from "@soapay/sdk";
import { buildApp } from "./app.js";
import type { ReadClient, WriteClient } from "./chain.js";
import { ConfigError, loadConfig, type Config } from "./config.js";
import { openDb } from "./db.js";
import { Indexer } from "./indexer.js";
import { allowAllVerifier, NoopNameIssuer } from "./hooks.js";
import type { L1Funder } from "./topup.js";
import { consoleLogger as logger, pruneRateLimits } from "./util.js";
import { pruneWorldIdRequests, WorldId } from "./worldid/verifier.js";

function makeL1Funder(config: Config): L1Funder | undefined {
  if (!config.l1RelayerPrivateKey || !config.l1RpcUrl) {
    logger.warn("L1_RELAYER_PRIVATE_KEY or L1_RPC_URL not set: rotations won't sponsor the registrant's Sepolia gas");
    return undefined;
  }
  const transport = http(config.l1RpcUrl, { retryCount: 2, timeout: 30_000 });
  const account = privateKeyToAccount(config.l1RelayerPrivateKey);
  const pub = createPublicClient({ chain: sepolia, transport });
  const wallet = createWalletClient({ chain: sepolia, transport, account });
  return {
    address: account.address,
    getBalance: (a) => pub.getBalance(a),
    estimateFeesPerGas: () => pub.estimateFeesPerGas(),
    sendTransaction: (a) => wallet.sendTransaction(a),
  };
}

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

  const now = () => Math.floor(Date.now() / 1000);
  const w = config.worldId;
  let worldId: WorldId | undefined;
  if (w.disabled) {
    const banner = "!".repeat(78);
    logger.error(
      `${banner}\nWORLD_ID_DISABLED=true: /register and /names accept ANYONE and rotations cannot be attested.\n` +
        `Local development only. Never run this in a shared or production environment.\n${banner}`,
    );
  } else {
    if (!w.rpId || !w.signingKey) {
      console.error(
        "Config: WORLD_RP_ID and WORLD_RP_SIGNING_KEY are required (Developer Portal, World ID 4.0). " +
          "Set WORLD_ID_DISABLED=true for local development only.",
      );
      process.exit(1);
    }
    worldId = new WorldId({ config, db, fetch: (u, i) => fetch(u, i), logger, now });
  }
  const attester = config.attesterPrivateKey ? privateKeyToAccount(config.attesterPrivateKey) : undefined;
  if (!attester) logger.warn("ATTESTER_PRIVATE_KEY not set: POST /names/:label/rotation is disabled");

  const app = buildApp({
    config,
    db,
    client,
    relayer: relayer as unknown as WriteClient | undefined,
    indexer,
    logger,
    now,
    getIp,
    // The ENSv2 issuer plugs in here; the default only stores.
    nameIssuer: new NoopNameIssuer(),
    // World ID gates /register and /names; allow-all only when explicitly disabled (dev).
    humanVerifier: worldId?.humanVerifier ?? allowAllVerifier,
    worldId,
    attester,
    l1Funder: makeL1Funder(config),
  });

  if (config.indexer.enabled) indexer.start();
  const pruner = setInterval(() => {
    pruneRateLimits(db, now(), Math.max(config.rateLimit.windowSeconds, 86_400));
    pruneWorldIdRequests(db, now());
  }, 10 * 60_000);
  pruner.unref();

  const server = serve({ fetch: app.fetch, port: config.port });
  logger.info("api listening", {
    port: config.port,
    chainId: config.chainId,
    relayer: relayer?.account.address ?? null,
    worldId: worldId ? { environment: w.environment, rpId: w.rpId, enrollAction: w.enrollAction } : "DISABLED",
    attester: attester?.address ?? null,
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
