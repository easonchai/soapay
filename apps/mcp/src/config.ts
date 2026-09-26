import { getAddress, isAddress, isHex, type Address, type Hex } from "viem";
import { validateMnemonic } from "@soapay/sdk";
import { parseUsdc } from "./util.js";

export const DEFAULT_STEALTH_DISPERSE: Address = "0x6B7a1cC570Af2DDd427DA694351438F0FE8039CA";
export const DEFAULT_BUNDLER_URL = "https://public.pimlico.io/v2/84532/rpc";

/** Public settings. Safe to show; secrets live in `Secrets` and never leave this process. */
export type McpConfig = {
  apiUrl: string;
  chainId: number;
  rpcUrl: string | undefined;
  ensRpcUrl: string | undefined;
  bundlerUrl: string;
  stealthDisperse: Address;
  stateDir: string;
  /** Base units. */
  maxPerCallUsdc: bigint;
  maxPerDayUsdc: bigint;
  /** Normalised names; null = no allowlist. */
  payeeAllowlist: string[] | null;
  /** Extra payers whose announcements count as known in the ledger. */
  knownPayers: Address[];
  /** Addresses the consolidation guard treats as the agent's identifiable main wallet. */
  identifiableAddresses: Address[];
  /** Plans expire after this many seconds. */
  planTtlSeconds: number;
};

export type Secrets = {
  mnemonic: string | undefined;
  payerKey: Hex | undefined;
};

export class ConfigError extends Error {
  override name = "ConfigError";
}

function addressList(v: string | undefined, what: string): Address[] {
  if (!v?.trim()) return [];
  return v.split(",").map((s) => {
    const a = s.trim();
    if (!isAddress(a, { strict: false })) throw new ConfigError(`${what}: "${a}" is not an address`);
    return getAddress(a);
  });
}

export function loadConfig(env: Record<string, string | undefined>): { config: McpConfig; secrets: Secrets } {
  const chainId = Number(env.CHAIN_ID ?? "84532");
  if (!Number.isInteger(chainId) || chainId <= 0) throw new ConfigError("CHAIN_ID must be a chain id");
  const sd = env.STEALTH_DISPERSE ?? DEFAULT_STEALTH_DISPERSE;
  if (!isAddress(sd, { strict: false })) throw new ConfigError("STEALTH_DISPERSE must be an address");

  const cap = (name: string, dflt: string) => {
    try {
      return parseUsdc(env[name] ?? dflt);
    } catch {
      throw new ConfigError(`${name} must be a positive USDC amount`);
    }
  };
  const maxPerCallUsdc = cap("MAX_PER_CALL_USDC", "5");
  const maxPerDayUsdc = cap("MAX_PER_DAY_USDC", "20");
  if (maxPerCallUsdc > maxPerDayUsdc) throw new ConfigError("MAX_PER_CALL_USDC exceeds MAX_PER_DAY_USDC");

  const allow = env.PAYEE_ALLOWLIST?.trim();
  const payeeAllowlist = allow
    ? allow
        .split(",")
        .map((n) => n.trim().toLowerCase())
        .filter(Boolean)
    : null;

  const mnemonic = env.AGENT_MNEMONIC?.trim().replace(/\s+/g, " ") || undefined;
  if (mnemonic && !validateMnemonic(mnemonic)) throw new ConfigError("AGENT_MNEMONIC is not a valid BIP-39 mnemonic");
  const rawKey = env.AGENT_PAYER_PRIVATE_KEY?.trim() || undefined;
  const payerKey = rawKey ? ((rawKey.startsWith("0x") ? rawKey : `0x${rawKey}`) as Hex) : undefined;
  if (payerKey && (!isHex(payerKey) || payerKey.length !== 66)) throw new ConfigError("AGENT_PAYER_PRIVATE_KEY must be 32 bytes of hex");

  const ttl = Number(env.PLAN_TTL_SECONDS ?? "600");
  return {
    config: {
      apiUrl: (env.API_URL ?? "http://localhost:8787").replace(/\/+$/, ""),
      chainId,
      rpcUrl: env.RPC_URL || undefined,
      ensRpcUrl: env.ENS_RPC_URL || undefined,
      bundlerUrl: env.BUNDLER_URL || DEFAULT_BUNDLER_URL,
      stealthDisperse: getAddress(sd),
      stateDir: (env.STATE_DIR || "~/.soapay-mcp").replace(/^~(?=\/|$)/, env.HOME ?? "."),
      maxPerCallUsdc,
      maxPerDayUsdc,
      payeeAllowlist,
      knownPayers: addressList(env.KNOWN_PAYERS, "KNOWN_PAYERS"),
      identifiableAddresses: addressList(env.IDENTIFIABLE_ADDRESSES, "IDENTIFIABLE_ADDRESSES"),
      planTtlSeconds: Number.isFinite(ttl) && ttl > 0 && ttl <= 600 ? ttl : 600,
    },
    secrets: { mnemonic, payerKey },
  };
}
