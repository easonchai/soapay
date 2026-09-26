// Runtime configuration: build-time env (import.meta.env) with per-browser overrides
// from the Settings screen. Settings hold no secrets (RPC URLs may embed an API key,
// which is the employer's own), so they live in plain localStorage; the roster and
// history do not.
import { getAddress, isAddress, type Address, type Chain } from "viem";
import { base, baseSepolia } from "viem/chains";
import { CHAINS, DEFAULT_CHAIN_ID, isTestnetChain, type SoapayChainConfig } from "@soapay/sdk";

export const SUPPORTED_CHAIN_IDS = [baseSepolia.id, base.id] as const;
export type SupportedChainId = (typeof SUPPORTED_CHAIN_IDS)[number];

export type Settings = {
  chainId: SupportedChainId;
  /** Per chain, so switching chains never pays an address meant for the other one. */
  stealthDisperse: Partial<Record<SupportedChainId, Address>>;
  rpcUrl: Partial<Record<SupportedChainId, string>>;
  ensRpcUrl: Partial<Record<SupportedChainId, string>>;
};

export type AppConfig = {
  chainId: SupportedChainId;
  chain: Chain;
  sdk: SoapayChainConfig;
  usdc: Address;
  ensChain: Chain;
  stealthDisperse: Address | null;
  rpcUrl: string | undefined;
  ensRpcUrl: string | undefined;
  walletConnectProjectId: string | undefined;
  mockEns: boolean;
  /** apps/api base URL (attestations). */
  apiUrl: string | undefined;
  /** PINNED MetaRotation attester (VITE_ATTESTER). Never taken from an API response. */
  attester: Address | undefined;
  /** Recipient app base URL for invite links (VITE_RECIPIENT_URL). */
  recipientUrl: string;
  /** Recipient app link in the top bar ("Receive"): VITE_OTHER_APP_URL, else recipientUrl. */
  otherAppUrl: string;
};

const SETTINGS_KEY = "soapay.sender.settings.v1";

export function isSupportedChainId(id: number): id is SupportedChainId {
  return (SUPPORTED_CHAIN_IDS as readonly number[]).includes(id);
}

function envString(v: string | undefined): string | undefined {
  const t = v?.trim();
  return t ? t : undefined;
}

export function envDefaults(env: ImportMetaEnv = import.meta.env): Settings {
  const envChain = Number(env.VITE_CHAIN_ID ?? DEFAULT_CHAIN_ID);
  const chainId: SupportedChainId = isSupportedChainId(envChain) ? envChain : DEFAULT_CHAIN_ID;
  // CK's name is an alias; ours wins when both are set.
  const disperse = envString(env.VITE_STEALTH_DISPERSE) ?? envString(env.VITE_STEALTH_DISPERSE_ADDRESS);
  const rpc = envString(env.VITE_RPC_URL);
  const ensRpc = envString(env.VITE_ENS_RPC_URL);
  return {
    chainId,
    stealthDisperse: disperse && isAddress(disperse) ? { [chainId]: getAddress(disperse) } : {},
    rpcUrl: rpc ? { [chainId]: rpc } : {},
    ensRpcUrl: ensRpc ? { [chainId]: ensRpc } : {},
  };
}

function safeStorage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

export function loadSettings(): Settings {
  const defaults = envDefaults();
  const raw = safeStorage()?.getItem(SETTINGS_KEY);
  if (!raw) return defaults;
  try {
    const s = JSON.parse(raw) as Partial<Settings>;
    return {
      chainId: s.chainId && isSupportedChainId(s.chainId) ? s.chainId : defaults.chainId,
      stealthDisperse: { ...defaults.stealthDisperse, ...(s.stealthDisperse ?? {}) },
      rpcUrl: { ...defaults.rpcUrl, ...(s.rpcUrl ?? {}) },
      ensRpcUrl: { ...defaults.ensRpcUrl, ...(s.ensRpcUrl ?? {}) },
    };
  } catch {
    return defaults;
  }
}

export function saveSettings(s: Settings): void {
  safeStorage()?.setItem(SETTINGS_KEY, JSON.stringify(s));
}

export function resetSettings(): void {
  safeStorage()?.removeItem(SETTINGS_KEY);
}

export function isMockEns(env: ImportMetaEnv = import.meta.env): boolean {
  // Never in a production build, whatever the env says.
  return import.meta.env.DEV === true && env.VITE_MOCK_ENS === "1";
}

export function pinnedAttester(env: ImportMetaEnv = import.meta.env): Address | undefined {
  const a = envString(env.VITE_ATTESTER);
  return a && isAddress(a) ? getAddress(a) : undefined;
}

export function recipientAppUrls(env: ImportMetaEnv = import.meta.env): { recipientUrl: string; otherAppUrl: string } {
  const recipientUrl = envString(env.VITE_RECIPIENT_URL) ?? "http://localhost:5173";
  return { recipientUrl, otherAppUrl: envString(env.VITE_OTHER_APP_URL) ?? recipientUrl };
}

// Company name in the top bar (CK's setting). Not a secret: plain localStorage.
const ORG_KEY = "soapay:org";

export function getOrgName(): string {
  return safeStorage()?.getItem(ORG_KEY) ?? "";
}

export function setOrgName(v: string): void {
  const s = safeStorage();
  if (!s) return;
  if (v.trim()) s.setItem(ORG_KEY, v.trim());
  else s.removeItem(ORG_KEY);
}

// Company-wide chunk size for denominated payouts (D-31): one size for every employee, so every full
// line in a batch is identical. Not a secret: plain localStorage, like the company name.
const CHUNK_KEY = "soapay:chunk";
/** Mainnet default chunk size. */
export const DEFAULT_CHUNK_USDC = "500";
/** Testnet default (D-47): faucet USDC is scarce (20 per address per 2 hours), so chunks are small. */
export const TESTNET_CHUNK_USDC = "5";

/** The default chunk for a chain: 5 USDC on a testnet, 500 USDC elsewhere. */
export function defaultChunkUsdc(chainId: number = loadSettings().chainId): string {
  return isTestnetChain(chainId) ? TESTNET_CHUNK_USDC : DEFAULT_CHUNK_USDC;
}

/**
 * The company's chunk size: a value it saved, else the chain's default. Only a value that differs
 * from the default is ever stored, so a saved value is always a real choice and is never overridden.
 */
export function getChunkSize(chainId: number = loadSettings().chainId): string {
  return safeStorage()?.getItem(CHUNK_KEY) || defaultChunkUsdc(chainId);
}

export function setChunkSize(v: string, chainId: number = loadSettings().chainId): void {
  const s = safeStorage();
  if (!s) return;
  const t = v.trim();
  if (t && t !== defaultChunkUsdc(chainId)) s.setItem(CHUNK_KEY, t);
  else s.removeItem(CHUNK_KEY);
}

export function resolveConfig(settings: Settings = loadSettings()): AppConfig {
  const sdk = CHAINS[settings.chainId] as SoapayChainConfig;
  const disperse = settings.stealthDisperse[settings.chainId] ?? sdk.stealthDisperse ?? null;
  return {
    chainId: settings.chainId,
    chain: sdk.chain,
    sdk,
    usdc: sdk.usdc,
    ensChain: sdk.ensChain,
    stealthDisperse: disperse,
    rpcUrl: settings.rpcUrl[settings.chainId],
    ensRpcUrl: settings.ensRpcUrl[settings.chainId],
    walletConnectProjectId: envString(import.meta.env.VITE_WALLETCONNECT_PROJECT_ID),
    mockEns: isMockEns(),
    apiUrl: envString(import.meta.env.VITE_API_URL),
    attester: pinnedAttester(),
    ...recipientAppUrls(),
  };
}

export function explorerBase(chainId: number): string {
  return chainId === base.id ? "https://basescan.org" : "https://sepolia.basescan.org";
}

export function txUrl(chainId: number, hash: string): string {
  return `${explorerBase(chainId)}/tx/${hash}`;
}

export function addressUrl(chainId: number, address: string): string {
  return `${explorerBase(chainId)}/address/${address}`;
}
