import { CHAINS, DEFAULT_CHAIN_ID, configurePayToken, exitAvailability, getChainConfig } from "@soapay/sdk";
import { getAddress, isAddress, type Address } from "viem";

/** Build-time defaults from `import.meta.env`. Every value can be overridden in Settings. */
export type EnvConfig = {
  apiUrl: string;
  chainId: number;
  bundlerUrl: string;
  rpcUrl: string;
  stealthDisperse: Address[];
  mockApi: boolean;
  /** Ethereum Sepolia RPC, for the ENSv2 record write on rotation. */
  l1RpcUrl: string;
  /** Testnet pay-token override (VITE_PAY_TOKEN; D-52). Empty = the SDK default (mock USDC on Base Sepolia). */
  payToken: string;
  /** The company (sender) app, for the top bar's "Pay" link (VITE_OTHER_APP_URL). */
  otherAppUrl: string;
  /** Reown (WalletConnect) project id for "Connect to a dApp" (D-61). Empty = the feature is off. */
  walletConnectProjectId: string;
};

export const SUPPORTED_CHAIN_IDS = Object.keys(CHAINS).map(Number);

function parseAddressList(raw: string | undefined): Address[] {
  return (raw ?? "")
    .split(/[\s,]+/)
    .filter((s) => s.length > 0 && isAddress(s, { strict: false }))
    .map((s) => getAddress(s));
}

export function readEnv(env: Record<string, string | boolean | undefined> = import.meta.env): EnvConfig {
  const str = (k: string) => {
    const v = env[k];
    return typeof v === "string" ? v.trim() : "";
  };
  const chainId = Number(str("VITE_CHAIN_ID") || DEFAULT_CHAIN_ID);
  const dev = env.DEV === true || env.DEV === "true";
  return {
    // CK's VITE_RELAY_URL (`…/relay` on the API) is accepted when VITE_API_URL is unset: its origin is the API.
    apiUrl: str("VITE_API_URL") || apiFromRelayUrl(str("VITE_RELAY_URL")) || "http://localhost:8787",
    chainId: SUPPORTED_CHAIN_IDS.includes(chainId) ? chainId : DEFAULT_CHAIN_ID,
    bundlerUrl: str("VITE_BUNDLER_URL"),
    rpcUrl: str("VITE_RPC_URL"),
    // Ours wins; CK's VITE_STEALTH_DISPERSE_ADDRESS is the fallback name.
    stealthDisperse: parseAddressList(str("VITE_STEALTH_DISPERSE") || str("VITE_STEALTH_DISPERSE_ADDRESS")),
    mockApi: str("VITE_MOCK_API") === "1" || str("VITE_MOCK_API") === "true",
    // The company app's VITE_ENS_RPC_URL (set in the web Dockerfile) is accepted too.
    l1RpcUrl: str("VITE_L1_RPC_URL") || str("VITE_ENS_RPC_URL"),
    payToken: str("VITE_PAY_TOKEN"),
    // Dev: the sender's dev server. Build: scripts/build-demo.sh serves the company app (and landing) at /.
    otherAppUrl: str("VITE_OTHER_APP_URL") || (dev ? "http://localhost:5174" : "/"),
    walletConnectProjectId: str("VITE_WALLETCONNECT_PROJECT_ID"),
  };
}

/** `https://api.example/relay` → `https://api.example` (a path prefix before `/relay` is kept). */
export function apiFromRelayUrl(relayUrl: string): string {
  if (!relayUrl) return "";
  try {
    const u = new URL(relayUrl);
    const path = u.pathname.replace(/\/+$/, "").replace(/\/relay$/, "");
    return `${u.origin}${path}`;
  } catch {
    return "";
  }
}

export const ENV: EnvConfig = readEnv();

/** Applies VITE_PAY_TOKEN to the SDK (Base Sepolia only; mainnet's token is fixed). Returns the error, if any. */
export function applyPayToken(env: Pick<EnvConfig, "payToken"> = ENV): string | null {
  try {
    configurePayToken(84532, env.payToken || undefined);
    return null;
  } catch (e) {
    return (e as Error).message;
  }
}
applyPayToken();

/**
 * Whether the compliant exit is offered on `chainId`: it needs a route and Circle USDC as the pay
 * token (CCTP). On the Base Sepolia demo the pay token is the mock, so Exit is hidden (D-52).
 */
export function exitOffered(chainId: number): boolean {
  return exitAvailability(chainId).available;
}

export function chainName(chainId: number): string {
  try {
    return getChainConfig(chainId).chain.name;
  } catch {
    return `Chain ${chainId}`;
  }
}

export function explorerTxUrl(chainId: number, txHash: string): string | undefined {
  const url = getChainConfig(chainId).chain.blockExplorers?.default.url;
  return url ? `${url}/tx/${txHash}` : undefined;
}

export function explorerAddressUrl(chainId: number, address: string): string | undefined {
  const url = getChainConfig(chainId).chain.blockExplorers?.default.url;
  return url ? `${url}/address/${address}` : undefined;
}
