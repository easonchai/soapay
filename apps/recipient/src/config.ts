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
  /** Optional Uniswap Trading API key (VITE_UNISWAP_API_KEY). */
  uniswapApiKey: string;
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
  return {
    apiUrl: str("VITE_API_URL") || "http://localhost:8787",
    chainId: SUPPORTED_CHAIN_IDS.includes(chainId) ? chainId : DEFAULT_CHAIN_ID,
    bundlerUrl: str("VITE_BUNDLER_URL"),
    rpcUrl: str("VITE_RPC_URL"),
    stealthDisperse: parseAddressList(str("VITE_STEALTH_DISPERSE")),
    mockApi: str("VITE_MOCK_API") === "1" || str("VITE_MOCK_API") === "true",
    l1RpcUrl: str("VITE_L1_RPC_URL"),
    uniswapApiKey: str("VITE_UNISWAP_API_KEY"),
  };
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
