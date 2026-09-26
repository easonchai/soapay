import { getAddress, isAddress, isHex, type Address, type Hex } from "viem";
import {
  ANNOUNCER_ADDRESS,
  CHAINS,
  DEFAULT_CHAIN_ID,
  PARENT_NAME,
  PERMIT2_ADDRESS,
  STEALTH_DISPERSE_BASE_SEPOLIA,
  UNIVERSAL_ROUTER,
  configurePayToken,
  getChainConfig,
} from "@soapay/sdk";

export type Config = {
  port: number;
  chainId: number;
  rpcUrl: string;
  /** Ethereum (Sepolia) RPC for the ENSv2 NameIssuer; unused by the default no-op issuer. */
  l1RpcUrl: string | undefined;
  relayerPrivateKey: Hex | undefined;
  /** Ethereum Sepolia key holding ROLE_REGISTRAR on the parent's ENSv2 subname registry. */
  issuerPrivateKey: Hex | undefined;
  /** From `pnpm ensv2:setup-parent` (contracts/ENSV2.md); looked up on-chain when unset. */
  ensSubnameRegistry: Address | undefined;
  ensResolverAdmin: Address | undefined;
  dbPath: string;
  parentName: string;
  corsOrigins: string[];
  trustProxy: boolean;
  bodyLimitBytes: number;
  rateLimit: {
    windowSeconds: number;
    registerPerIp: number;
    registerPerRegistrant: number;
    namesPerIp: number;
    /** POST /invites, per employer address and per IP (docs/mvp-spec.md §7). */
    invitesPerEmployer: number;
    invitesPerIp: number;
  };
  indexer: {
    enabled: boolean;
    startBlock: bigint;
    chunkSize: number;
    pollMs: number;
    reorgDepth: number;
  };
  receiptTimeoutMs: number;
  worldId: WorldIdConfig;
  uniswap: {
    /** Trading API key. Server-only: never logged, never returned. Unset: /uniswap/* returns 503. */
    apiKey: string | undefined;
    baseUrl: string;
    perIpPerMinute: number;
    bodyLimitBytes: number;
  };
  /** Signs MetaRotation attestations (docs/mvp-spec.md §2.1). Unset → rotation returns 503. */
  attesterPrivateKey: Hex | undefined;
  /** Ethereum Sepolia key that tops up registrants' gas for the ENSv2 setText. Unset → no top-ups. */
  l1RelayerPrivateKey: Hex | undefined;
  topup: {
    /** Gas the registrant's setText needs, with headroom. */
    gas: bigint;
    /** Hard cap per top-up, in wei. */
    capWei: bigint;
    perRegistrant: number;
    perDay: number;
  };
  /**
   * Testnet pay token override (PAY_TOKEN; D-52). Unset: the SDK default (mock USDC on Base Sepolia).
   * Ignored on mainnet, whose token is fixed.
   */
  payToken: Address | undefined;
  /** POST /paymaster: ERC-7677 sponsorship proxy to Pimlico (testnet only, D-52). */
  paymaster: {
    /** Pimlico API key. Server-only: never logged, never returned. Unset: /paymaster returns 503. */
    pimlicoApiKey: string | undefined;
    /** Upstream base; the key is appended as `?apikey=`. */
    upstreamUrl: string;
    /** Optional Pimlico sponsorship policy; the server sets the context, clients can't. */
    sponsorshipPolicyId: string | undefined;
    /** Call targets a sponsored userOp may touch: pay token, Permit2, Universal Router, StealthDisperse, Announcer (+ PAYMASTER_EXTRA_TARGETS). */
    allowedTargets: Address[];
  };
  /** POST /faucet: the welcome drop for wallets that open the company app (testnet only, D-52). */
  faucet: {
    enabled: boolean;
    /** Mock USDC minted once per address, base units (default 1,000,000 USDC). */
    usdcAmount: bigint;
    /** Top the wallet up to this much ETH when it holds less, wei. 0 = no ETH drip (the default; owner decision pending). */
    ethDripWei: bigint;
    /** No ETH drip while the relayer holds less than this, wei (default 0.02 ETH). */
    minRelayerEthWei: bigint;
  };
};

/** The only chain the faucet and the sponsorship proxy serve (the mock token lives here). */
export const TESTNET_SPONSOR_CHAIN_ID = 84532;

export const WORLD_ENVIRONMENTS = ["production", "staging", "sandbox"] as const;
export type WorldEnvironment = (typeof WORLD_ENVIRONMENTS)[number];

export type WorldIdConfig = {
  /** Dev only: skip World ID (allow-all). Rotation is refused while disabled. */
  disabled: boolean;
  appId: `app_${string}`;
  rpId: string;
  /** RP signing key. Server-only: never logged, never returned. */
  signingKey: Hex | undefined;
  environment: WorldEnvironment;
  /** The World ID 4.0 action every recovery proof is for (D-58). Nullifiers are per (human, RP, action). */
  action: string;
  /**
   * Developer Portal staging verification token, sent as `x-staging-verification-token` when
   * `environment` is staging. Server-only: never logged, never returned.
   */
  stagingVerifyToken: string | undefined;
  verifyBaseUrl: string;
  /** A session attached after enrollment can back a rotation only after this delay (stolen-key window). */
  attachCooldownSeconds: number;
  /** Lifetime of a signed RP context, seconds. */
  rpTtlSeconds: number;
  rpContextPerIp: number;
};

/** Public Developer Portal app id (not a secret). */
export const DEFAULT_WORLD_APP_ID = "app_0cc7167efe114ac2e0ef7d9827098353";
/** Soapay's registered World ID 4.0 RP (public; the signing key is not). */
export const DEFAULT_WORLD_RP_ID = "rp_3ede5fe1cab9af48";
/** The World ID 4.0 action for account recovery (link + rotate), in staging and production (D-58). */
export const DEFAULT_WORLD_ACTION = "soapay-recovery";

export class ConfigError extends Error {
  constructor(message: string) {
    super(`Config: ${message}`);
    this.name = "ConfigError";
  }
}

type Env = Record<string, string | undefined>;

function str(env: Env, key: string): string | undefined {
  const v = env[key]?.trim();
  return v === undefined || v === "" ? undefined : v;
}

function int(env: Env, key: string, fallback: number, min = 0): number {
  const raw = str(env, key);
  if (raw === undefined) return fallback;
  if (!/^\d+$/.test(raw)) throw new ConfigError(`${key} must be a non-negative integer, got "${raw}"`);
  const n = Number(raw);
  if (!Number.isSafeInteger(n) || n < min) throw new ConfigError(`${key} must be an integer >= ${min}, got "${raw}"`);
  return n;
}

function bool(env: Env, key: string, fallback: boolean): boolean {
  const raw = str(env, key);
  if (raw === undefined) return fallback;
  if (/^(1|true|yes|on)$/i.test(raw)) return true;
  if (/^(0|false|no|off)$/i.test(raw)) return false;
  throw new ConfigError(`${key} must be true or false, got "${raw}"`);
}

function privateKey(env: Env, key: string): Hex | undefined {
  const raw = str(env, key);
  if (raw === undefined) return undefined;
  const v = raw.startsWith("0x") ? raw : `0x${raw}`;
  // Never echo the value back in the error.
  if (!isHex(v) || v.length !== 66) throw new ConfigError(`${key} must be a 32-byte hex private key`);
  return v as Hex;
}

function address(env: Env, key: string): Address | undefined {
  const raw = str(env, key);
  if (raw === undefined) return undefined;
  if (!isAddress(raw, { strict: false })) throw new ConfigError(`${key} must be an address, got "${raw}"`);
  return getAddress(raw);
}

function wei(env: Env, key: string, fallback: bigint): bigint {
  const raw = str(env, key);
  if (raw === undefined) return fallback;
  if (!/^\d{1,30}$/.test(raw)) throw new ConfigError(`${key} must be an amount in wei, got "${raw}"`);
  return BigInt(raw);
}

function url(env: Env, key: string, required: boolean): string | undefined {
  const raw = str(env, key);
  if (raw === undefined) {
    if (required) throw new ConfigError(`${key} is required (an HTTP(S) JSON-RPC endpoint)`);
    return undefined;
  }
  try {
    const u = new URL(raw);
    if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error();
  } catch {
    throw new ConfigError(`${key} must be an http(s) URL`);
  }
  return raw;
}

export function loadConfig(env: Env = process.env): Config {
  const chainId = int(env, "CHAIN_ID", DEFAULT_CHAIN_ID, 1);
  const chainCfg = (CHAINS as Record<number, { announcerStartBlock: bigint }>)[chainId];
  if (!chainCfg) {
    throw new ConfigError(`CHAIN_ID ${chainId} is not supported; use one of ${Object.keys(CHAINS).join(", ")}`);
  }

  const parentName = (str(env, "PARENT_NAME") ?? PARENT_NAME).toLowerCase();
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(parentName)) {
    throw new ConfigError(`PARENT_NAME must be a normalised ENS name like soapay.eth, got "${parentName}"`);
  }

  const startRaw = str(env, "INDEXER_START_BLOCK");
  if (startRaw !== undefined && !/^\d+$/.test(startRaw)) {
    throw new ConfigError(`INDEXER_START_BLOCK must be a block number, got "${startRaw}"`);
  }

  const worldDisabled = bool(env, "WORLD_ID_DISABLED", false);
  const appId = str(env, "WORLD_APP_ID") ?? DEFAULT_WORLD_APP_ID;
  if (!/^app_[A-Za-z0-9_]+$/.test(appId)) throw new ConfigError(`WORLD_APP_ID must look like app_…, got "${appId}"`);
  const rpId = str(env, "WORLD_RP_ID") ?? DEFAULT_WORLD_RP_ID;
  if (rpId !== undefined && !/^rp_[A-Za-z0-9_]+$/.test(rpId)) throw new ConfigError("WORLD_RP_ID must look like rp_…");
  const signingKey = privateKey(env, "WORLD_RP_SIGNING_KEY");
  const worldEnv = (str(env, "WORLD_ENV") ?? "staging").toLowerCase();
  if (!(WORLD_ENVIRONMENTS as readonly string[]).includes(worldEnv)) {
    throw new ConfigError(`WORLD_ENV must be production, staging or sandbox, got "${worldEnv}"`);
  }
  const worldAction = str(env, "WORLD_ACTION") ?? DEFAULT_WORLD_ACTION;
  if (!/^[A-Za-z0-9_.:-]{1,64}$/.test(worldAction)) throw new ConfigError(`WORLD_ACTION must be an action id, got "${worldAction}"`);
  // The pay token (PAY_TOKEN, testnets only) must be applied before reading defaults that depend on it.
  const payToken = chainId === TESTNET_SPONSOR_CHAIN_ID ? address(env, "PAY_TOKEN") : undefined;
  configurePayToken(TESTNET_SPONSOR_CHAIN_ID, payToken);
  const extraTargets = (str(env, "PAYMASTER_EXTRA_TARGETS") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((a) => {
      if (!isAddress(a, { strict: false })) throw new ConfigError(`PAYMASTER_EXTRA_TARGETS must be addresses, got "${a}"`);
      return getAddress(a);
    });
  const router = (UNIVERSAL_ROUTER as Record<number, Address>)[chainId];
  // Stealth spends touch the pay token (and Permit2 / the Universal Router for swaps in place); the
  // employer's EIP-5792 batch touches the pay token and the Announcer, or StealthDisperse.
  const stealthDisperse = address(env, "STEALTH_DISPERSE") ?? (chainId === TESTNET_SPONSOR_CHAIN_ID ? STEALTH_DISPERSE_BASE_SEPOLIA : undefined);
  const allowedTargets = [
    getChainConfig(chainId).usdc,
    PERMIT2_ADDRESS,
    ...(router ? [router] : []),
    ...(stealthDisperse ? [stealthDisperse] : []),
    ANNOUNCER_ADDRESS,
    ...extraTargets,
  ].map((a) => getAddress(a));
  const faucetUsdc = str(env, "FAUCET_USDC_AMOUNT") ?? "1000000000000";
  if (!/^\d{1,30}$/.test(faucetUsdc)) throw new ConfigError(`FAUCET_USDC_AMOUNT must be base units, got "${faucetUsdc}"`);

  // WORLD_RP_ID / WORLD_RP_SIGNING_KEY are required by the server entrypoint (src/index.ts)
  // unless WORLD_ID_DISABLED=true; loadConfig stays lenient so tests can build partial configs.

  return {
    port: int(env, "PORT", 8787, 1),
    chainId,
    rpcUrl: url(env, "RPC_URL", true)!,
    l1RpcUrl: url(env, "L1_RPC_URL", false),
    relayerPrivateKey: privateKey(env, "RELAYER_PRIVATE_KEY"),
    issuerPrivateKey: privateKey(env, "ISSUER_PRIVATE_KEY"),
    ensSubnameRegistry: address(env, "ENS_SUBNAME_REGISTRY"),
    ensResolverAdmin: address(env, "ENS_RESOLVER_ADMIN"),
    dbPath: str(env, "DB_PATH") ?? "./data/soapay.db",
    parentName,
    corsOrigins: (str(env, "CORS_ORIGINS") ?? "http://localhost:5173,http://localhost:5174")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    trustProxy: bool(env, "TRUST_PROXY", false),
    bodyLimitBytes: int(env, "BODY_LIMIT_BYTES", 16 * 1024, 256),
    rateLimit: {
      windowSeconds: int(env, "RATE_LIMIT_WINDOW_SECONDS", 3600, 1),
      registerPerIp: int(env, "RATE_LIMIT_REGISTER_PER_IP", 3, 1),
      registerPerRegistrant: int(env, "RATE_LIMIT_REGISTER_PER_REGISTRANT", 3, 1),
      namesPerIp: int(env, "RATE_LIMIT_NAMES_PER_IP", 10, 1),
      invitesPerEmployer: int(env, "RATE_LIMIT_INVITES_PER_EMPLOYER", 50, 1),
      invitesPerIp: int(env, "RATE_LIMIT_INVITES_PER_IP", 20, 1),
    },
    indexer: {
      enabled: bool(env, "INDEXER_ENABLED", true),
      startBlock: startRaw !== undefined ? BigInt(startRaw) : chainCfg.announcerStartBlock,
      chunkSize: int(env, "INDEXER_CHUNK_SIZE", 10_000, 1),
      pollMs: int(env, "INDEXER_POLL_MS", 4_000, 100),
      reorgDepth: int(env, "INDEXER_REORG_DEPTH", 10, 0),
    },
    receiptTimeoutMs: int(env, "RECEIPT_TIMEOUT_MS", 60_000, 1_000),
    worldId: {
      disabled: worldDisabled,
      appId: appId as `app_${string}`,
      rpId,
      signingKey,
      environment: worldEnv as WorldEnvironment,
      action: worldAction,
      stagingVerifyToken: str(env, "WORLD_STAGING_VERIFY_TOKEN"),
      attachCooldownSeconds: int(env, "WORLD_ATTACH_COOLDOWN_SECONDS", 72 * 3600, 0),
      verifyBaseUrl: (url(env, "WORLD_VERIFY_BASE_URL", false) ?? "https://developer.world.org").replace(/\/+$/, ""),
      rpTtlSeconds: int(env, "WORLD_RP_TTL_SECONDS", 300, 30),
      rpContextPerIp: int(env, "RATE_LIMIT_RP_CONTEXT_PER_IP", 60, 1),
    },
    uniswap: {
      apiKey: str(env, "UNISWAP_API_KEY"),
      baseUrl: (url(env, "UNISWAP_API_URL", false) ?? "https://trade-api.gateway.uniswap.org/v1").replace(/\/+$/, ""),
      perIpPerMinute: int(env, "RATE_LIMIT_UNISWAP_PER_IP_PER_MINUTE", 30, 1),
      bodyLimitBytes: int(env, "UNISWAP_BODY_LIMIT_BYTES", 8 * 1024, 256),
    },
    attesterPrivateKey: privateKey(env, "ATTESTER_PRIVATE_KEY"),
    l1RelayerPrivateKey: privateKey(env, "L1_RELAYER_PRIVATE_KEY"),
    topup: {
      gas: BigInt(int(env, "TOPUP_GAS", 150_000, 21_000)),
      capWei: wei(env, "TOPUP_CAP_WEI", 2_000_000_000_000_000n),
      perRegistrant: int(env, "TOPUP_PER_REGISTRANT_PER_DAY", 3, 0),
      perDay: int(env, "TOPUP_PER_DAY", 100, 0),
    },
    payToken,
    paymaster: {
      pimlicoApiKey: str(env, "PIMLICO_API_KEY"),
      upstreamUrl: (url(env, "PIMLICO_PAYMASTER_URL", false) ?? `https://api.pimlico.io/v2/${TESTNET_SPONSOR_CHAIN_ID}/rpc`).replace(/\/+$/, ""),
      sponsorshipPolicyId: str(env, "PIMLICO_SPONSORSHIP_POLICY_ID"),
      allowedTargets: [...new Set(allowedTargets)],
    },
    faucet: {
      enabled: chainId === TESTNET_SPONSOR_CHAIN_ID && bool(env, "FAUCET_ENABLED", true),
      usdcAmount: BigInt(faucetUsdc),
      ethDripWei: wei(env, "FAUCET_ETH_WEI", 0n),
      minRelayerEthWei: wei(env, "FAUCET_MIN_RELAYER_ETH_WEI", 20_000_000_000_000_000n),
    },
  };
}
