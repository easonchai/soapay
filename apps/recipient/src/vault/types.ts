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
};

export type Profile = {
  registration?: { txHash: Hex; status: string; chainId: number; at: number };
  name?: { label: string; name: string; at: number };
  /** World ID enrollment. `placeholder` until IDKit is wired. */
  human?: { kind: "world-id" | "placeholder"; at: number };
  /** Set once the user has confirmed the seed backup. The seed is never shown again. */
  backupConfirmedAt?: number;
  /** The user chose to share the raw meta-address instead of claiming a name. */
  nameSkipped?: boolean;
  onboardedAt?: number;
};

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
  };
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
