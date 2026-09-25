import { isHex, type Hex } from "viem";
import { CHAINS, DEFAULT_CHAIN_ID, PARENT_NAME } from "@soapay/sdk";

export type Config = {
  port: number;
  chainId: number;
  rpcUrl: string;
  /** Ethereum (Sepolia) RPC for the ENSv2 NameIssuer; unused by the default no-op issuer. */
  l1RpcUrl: string | undefined;
  relayerPrivateKey: Hex | undefined;
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
  };
  indexer: {
    enabled: boolean;
    startBlock: bigint;
    chunkSize: number;
    pollMs: number;
    reorgDepth: number;
  };
  receiptTimeoutMs: number;
};

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

  return {
    port: int(env, "PORT", 8787, 1),
    chainId,
    rpcUrl: url(env, "RPC_URL", true)!,
    l1RpcUrl: url(env, "L1_RPC_URL", false),
    relayerPrivateKey: privateKey(env, "RELAYER_PRIVATE_KEY"),
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
    },
    indexer: {
      enabled: bool(env, "INDEXER_ENABLED", true),
      startBlock: startRaw !== undefined ? BigInt(startRaw) : chainCfg.announcerStartBlock,
      chunkSize: int(env, "INDEXER_CHUNK_SIZE", 10_000, 1),
      pollMs: int(env, "INDEXER_POLL_MS", 4_000, 100),
      reorgDepth: int(env, "INDEXER_REORG_DEPTH", 10, 0),
    },
    receiptTimeoutMs: int(env, "RECEIPT_TIMEOUT_MS", 60_000, 1_000),
  };
}
