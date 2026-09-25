import type { AnnouncementRecord, ClusterGraphJSON, MetadataHints, ScanMatch } from "@soapay/sdk";
import type { Address, Hex } from "viem";
import { ENV } from "../config.js";

/** App settings. Stored inside the encrypted vault (the bundler URL may embed an API key). */
export type Settings = {
  chainId: number;
  apiUrl: string;
  bundlerUrl: string;
  rpcUrl: string;
  /** Read announcements with getLogs over RPC instead of the Soapay API. */
  useRpcAnnouncements: boolean;
  /** Extra StealthDisperse deployments to trust for the metadata payer (besides VITE_STEALTH_DISPERSE). */
  stealthDisperse: Address[];
  /** Employer addresses the user recognises. Anything else is flagged "unknown payer". */
  knownPayers: { address: Address; name: string }[];
  /** Ethereum Sepolia JSON-RPC for the ENSv2 `stealth` record write during rotation. Empty = public RPC. */
  l1RpcUrl: string;
  /** Uniswap Trading API key. Optional: without it, swaps route through the Universal Router fallback. */
  uniswapApiKey: string;
};

export type StoredAnnouncement = Omit<AnnouncementRecord, "blockNumber"> & { blockNumber: string };
export type StoredBalance = { stealthAddress: Address; token: Address; balance: string | null };

export type ChainState = {
  /** Highest block fully scanned (decimal string), or null before the first scan. */
  lastScannedBlock: string | null;
  /** Announcements that recompute to our keys. Everything else is discarded. */
  matches: StoredAnnouncement[];
  balances: StoredBalance[];
  balancesAt: number | null;
  /** Consolidation guard state (clusters + labels). */
  graph: ClusterGraphJSON | null;
  /** Local spend history (never leaves the device). Optional for vaults created before it existed. */
  spends?: SpendRecord[];
};

export type SpendRecord = {
  at: number;
  to: Address;
  /** One entry per source that actually sent. */
  parts: { from: Address; amount: string; txHash?: Hex; userOpHash: Hex }[];
  /** Set when the run stopped early (SpendManyError). */
  failed?: { from: Address; message: string };
  override: boolean;
};

export type Profile = {
  registration?: { txHash: Hex; status: string; chainId: number; at: number };
  name?: { label: string; name: string; at: number };
  /** World ID enrollment. `placeholder` until IDKit is wired. `sessionId` is needed to rotate keys (§2.1). */
  human?: { kind: "world-id" | "placeholder"; at: number; sessionId?: string };
  /** Which derived key set the name currently points at: 0 = the original keys (see features/rotation/keys.ts). */
  keyGeneration?: number;
  /** Completed meta-address rotations, oldest first. */
  rotations?: RotationRecord[];
  /** A rotation the API accepted whose on-chain `setText` has not landed yet. Resume it from Name settings. */
  pendingRotation?: PendingRotation;
  /** Set once the user has confirmed the seed backup. The seed is never shown again. */
  backupConfirmedAt?: number;
  /** The user chose to share the raw meta-address instead of claiming a name. */
  nameSkipped?: boolean;
  onboardedAt?: number;
};

export type RotationRecord = {
  generation: number;
  oldMeta: string;
  newMeta: string;
  at: number;
  setTextTx?: Hex;
  /** MetaRotation attestation from the API, when it returned one. */
  attestation?: unknown;
};

export type PendingRotation = Omit<RotationRecord, "at" | "setTextTx"> & { postedAt: number };

export type VaultData = {
  version: 1;
  /** SECRET. The one thing the user backs up; every key is derived from it on unlock. */
  mnemonic: string;
  createdAt: number;
  settings: Settings;
  profile: Profile;
  chains: Record<string, ChainState>;
};

export function defaultSettings(): Settings {
  return {
    chainId: ENV.chainId,
    apiUrl: ENV.apiUrl,
    bundlerUrl: ENV.bundlerUrl,
    rpcUrl: ENV.rpcUrl,
    useRpcAnnouncements: false,
    stealthDisperse: [],
    knownPayers: [],
    l1RpcUrl: ENV.l1RpcUrl,
    uniswapApiKey: ENV.uniswapApiKey,
  };
}

/** Settings with defaults filled in, so vaults written by older builds keep working. */
export function settingsOf(data: Pick<VaultData, "settings"> | null | undefined): Settings {
  return { ...defaultSettings(), ...(data?.settings ?? {}) };
}

export function emptyChainState(): ChainState {
  return { lastScannedBlock: null, matches: [], balances: [], balancesAt: null, graph: null };
}

export function newVaultData(mnemonic: string): VaultData {
  return {
    version: 1,
    mnemonic,
    createdAt: Date.now(),
    settings: defaultSettings(),
    profile: {},
    chains: {},
  };
}

export function chainState(data: VaultData, chainId = data.settings.chainId): ChainState {
  return data.chains[String(chainId)] ?? emptyChainState();
}

export const storeAnnouncement = (a: AnnouncementRecord): StoredAnnouncement => ({
  ...a,
  blockNumber: a.blockNumber.toString(),
});

export const loadAnnouncement = (a: StoredAnnouncement): AnnouncementRecord => ({
  ...a,
  blockNumber: BigInt(a.blockNumber),
});

export function annKey(a: Pick<AnnouncementRecord, "txHash" | "logIndex">): string {
  return `${a.txHash.toLowerCase()}:${a.logIndex}`;
}

export function toScanMatch(a: StoredAnnouncement, parse: (m: Hex) => MetadataHints | null): ScanMatch {
  return { announcement: loadAnnouncement(a), hints: parse(a.metadata) };
}
