import { serve } from "@hono/node-server";
import { getConnInfo } from "@hono/node-server/conninfo";
import type { Context } from "hono";
import { createPublicClient, createWalletClient, http } from "viem";
import { nonceManager, privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import { WORLD_ID_CREDENTIAL, getChainConfig } from "@soapay/sdk";
import { buildApp } from "./app.js";
import type { ReadClient, WriteClient } from "./chain.js";
import { ConfigError, loadConfig, type Config } from "./config.js";
import { openDb } from "./db.js";
import { Indexer } from "./indexer.js";
import { allowAllVerifier } from "./hooks.js";
import { makeNameIssuer } from "./issuer.js";
import type { L1Funder } from "./topup.js";
import { mockUsdcMintAbi, type FaucetWallet } from "./faucet.js";
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
  // One account (and nonce manager) for registrations and the faucet, so their txs never collide.
  const relayerAccount = config.relayerPrivateKey ? privateKeyToAccount(config.relayerPrivateKey, { nonceManager }) : undefined;
  const relayer = relayerAccount ? createWalletClient({ chain, transport, account: relayerAccount }) : undefined;
  if (!relayer) logger.warn("RELAYER_PRIVATE_KEY not set: POST /register is disabled");
  const faucetWallet: FaucetWallet | undefined =
    relayer && relayerAccount && config.faucet.enabled
      ? {
          address: relayerAccount.address,
          getBalance: (a) => publicClient.getBalance(a),
          mint: ({ token, to, amount }) =>
            relayer.writeContract({ address: token, abi: mockUsdcMintAbi, functionName: "mint", args: [to, amount], chain, account: relayerAccount }),
          sendEth: ({ to, value }) => relayer.sendTransaction({ to, value, chain, account: relayerAccount }),
          waitForReceipt: (hash) => publicClient.waitForTransactionReceipt({ hash, timeout: config.receiptTimeoutMs }),
        }
      : undefined;
  if (config.faucet.enabled && !faucetWallet) logger.warn("RELAYER_PRIVATE_KEY not set: POST /faucet is disabled");
  if (config.chainId === 84532 && !config.paymaster.pimlicoApiKey)
    logger.warn("PIMLICO_API_KEY not set: POST /paymaster answers 503 sponsorship_disabled (testnet spends can't be sent)");

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
    logger.warn(
      "WORLD_ID_DISABLED=true: no World ID sessions, so no rotation can be attested; " +
        "every meta-address change needs the employer's manual approval",
    );
  } else {
    const missing = [
      !w.appId && "WORLD_APP_ID",
      !w.rpId && "WORLD_RP_ID",
      !w.signingKey && "WORLD_RP_SIGNING_KEY",
    ].filter(Boolean);
    if (missing.length > 0) {
      console.error(
        `Config: ${missing.join(", ")} required (the World ID 4.0 app, RP and RP signer from the Developer Portal). ` +
          "Set WORLD_ID_DISABLED=true to run without World ID.",
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
    // ENSv2 subnames when ISSUER_PRIVATE_KEY + L1_RPC_URL are set; otherwise store only.
    nameIssuer: makeNameIssuer(config, logger),
    // No enrollment gate (docs/mvp-spec.md §5); World ID backs rotations only.
    humanVerifier: allowAllVerifier,
    worldId,
    attester,
    l1Funder: makeL1Funder(config),
    faucetWallet,
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
    worldId: worldId ? { environment: w.environment, rpId: w.rpId, credential: WORLD_ID_CREDENTIAL } : "DISABLED",
    uniswapProxy: config.uniswap.apiKey ? "enabled" : "disabled (UNISWAP_API_KEY unset)",
    paymaster: config.paymaster.pimlicoApiKey ? "enabled" : "disabled (PIMLICO_API_KEY unset)",
    faucet: faucetWallet ? { usdc: config.faucet.usdcAmount.toString(), ethWei: config.faucet.ethDripWei.toString() } : "disabled",
    payToken: getChainConfig(config.chainId).usdc,
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
