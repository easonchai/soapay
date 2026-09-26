// Runtime configuration: build-time env (import.meta.env) with per-browser overrides
// from the Settings screen. Settings hold no secrets (RPC URLs may embed an API key,
// which is the employer's own), so they live in plain localStorage; the roster and
// history do not.
import { getAddress, isAddress, type Address, type Chain } from "viem";
import { base, baseSepolia } from "viem/chains";
import { DEFAULT_CHAIN_ID, configurePayToken, getChainConfig, isTestnetChain, type SoapayChainConfig } from "@soapay/sdk";

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
  /**
   * Demo mode (`?demo=1`, VITE_DEMO=1, or the session flag): sample data, mock names, a demo wallet
   * and an in-memory chain. Nothing is sent on-chain and the API is never called. Not DEV-gated:
   * a deployed preview can run it.
   */
  demo: boolean;
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

// Demo mode (docs: README "Demo mode"). `?demo=1` turns it on for this tab, `?demo=0` (or "Exit demo")
// turns it off; the choice is kept in sessionStorage so hash navigation and reloads keep it. With no
// URL param and no session choice, VITE_DEMO=1 makes a build default to demo.
export const DEMO_SESSION_KEY = "soapay:demo";
/** Placeholder StealthDisperse for demo mode: never deployed anywhere, never called (demoChain.ts fakes every call). */
export const DEMO_STEALTH_DISPERSE: Address = "0x00000000000000000000000000000000d15be45e";

function sessionStore(): Storage | null {
  try {
    return typeof sessionStorage === "undefined" ? null : sessionStorage;
  } catch {
    return null;
  }
}

export function readDemoFlag(env: ImportMetaEnv = import.meta.env, search: string = typeof location === "undefined" ? "" : location.search): boolean {
  const q = new URLSearchParams(search).get("demo");
  const s = sessionStore();
  if (q === "1" || q === "0") {
    s?.setItem(DEMO_SESSION_KEY, q);
    return q === "1";
  }
  const saved = s?.getItem(DEMO_SESSION_KEY);
  if (saved === "1" || saved === "0") return saved === "1";
  const fromEnv = env.VITE_DEMO === "1";
  // Remember the resolved value so synchronous readers (isDemoSession) agree with resolveConfig.
  if (fromEnv) s?.setItem(DEMO_SESSION_KEY, "1");
  return fromEnv;
}

/** The session's demo choice, without consulting the URL or env (for readers outside resolveConfig). */
export function isDemoSession(): boolean {
  return sessionStore()?.getItem(DEMO_SESSION_KEY) === "1";
}

/** "Exit demo": remembers the choice for this tab (it also overrides VITE_DEMO). */
export function setDemoFlag(on: boolean): void {
  sessionStore()?.setItem(DEMO_SESSION_KEY, on ? "1" : "0");
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
/** Testnet default (D-47): small chunks keep demo runs readable (test USDC is no longer scarce, D-52). */
export const TESTNET_CHUNK_USDC = "5";

/** The default chunk for a chain: 5 USDC on a testnet, 500 USDC elsewhere (and in demo mode, whose salaries are mainnet-sized). */
export function defaultChunkUsdc(chainId: number = loadSettings().chainId, demo: boolean = isDemoSession()): string {
  return isTestnetChain(chainId) && !demo ? TESTNET_CHUNK_USDC : DEFAULT_CHUNK_USDC;
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

/**
 * Applies VITE_PAY_TOKEN (Base Sepolia only, D-52): the token the company pays in. Empty = the SDK
 * default, Soapay's mock USDC. Base mainnet's Circle USDC can't be overridden. Returns the error, if any.
 */
export function applyPayToken(env: Pick<ImportMetaEnv, "VITE_PAY_TOKEN"> = import.meta.env): string | null {
  try {
    configurePayToken(baseSepolia.id, envString(env.VITE_PAY_TOKEN));
    return null;
  } catch (e) {
    return (e as Error).message;
  }
}
applyPayToken();

export function resolveConfig(settings: Settings = loadSettings(), env: ImportMetaEnv = import.meta.env): AppConfig {
  // getChainConfig applies the pay-token override (the mock USDC on Base Sepolia by default).
  const sdk: SoapayChainConfig = getChainConfig(settings.chainId);
  const demo = readDemoFlag(env);
  // Demo pays through a fake StealthDisperse (off-chain sample data), even where a real one is deployed.
  const disperse = demo ? DEMO_STEALTH_DISPERSE : (settings.stealthDisperse[settings.chainId] ?? sdk.stealthDisperse ?? null);
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
    demo,
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
