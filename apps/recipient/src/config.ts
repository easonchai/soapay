import { CHAINS, DEFAULT_CHAIN_ID, getChainConfig } from "@soapay/sdk";
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
  /**
   * Ask the Uniswap Trading API for Convert quotes through the Soapay API's proxy (`${apiUrl}/uniswap`),
   * which adds UNISWAP_API_KEY server-side, with a placeholder swapper (never the stealth address; D-27).
   * Only where the API routes (Base mainnet). Off = the SDK's on-chain path. The key is never in the bundle.
   */
  swapViaApi: boolean;
  /** The company (sender) app, for the top bar's "Pay" link (VITE_OTHER_APP_URL). */
  otherAppUrl: string;
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
    l1RpcUrl: str("VITE_L1_RPC_URL"),
    swapViaApi: str("VITE_SWAP_VIA_API") !== "0" && str("VITE_SWAP_VIA_API") !== "false",
    // Dev: the sender's dev server. Build: scripts/build-demo.sh serves the company app (and landing) at /.
    otherAppUrl: str("VITE_OTHER_APP_URL") || (dev ? "http://localhost:5174" : "/"),
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
