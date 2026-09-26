import type { AnnouncementRecord, ClusterGraphJSON, MetadataHints, ScanMatch, SpendQueue } from "@soapay/sdk";
import type { Address, Hex } from "viem";
import { keysFromMnemonic, keysFromSignature, validateMnemonic, type SoapayKeys } from "@soapay/sdk";
import { ENV } from "../config.js";
import type { ExitRecord } from "../features/exit/types.js";

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
  /** Timing queue (D-28): at most one stealth address spent per random window of [min, max] hours. */
  queueWindowHours: [number, number];
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
  /**
   * Legacy convert-in-place history from builds that had Convert (removed from the app, D-52). Read
   * only, for the Payments history and "last spend" links.
   */
  conversions?: ConvertRecord[];
  /** Privacy Pools exits started from this chain (docs/mvp-spec.md §9). Resumed on unlock. */
  exits?: ExitRecord[];
  /** Timing queue (D-28): spends and exit deposits waiting for their window. Never leaves the device. */
  queue?: SpendQueue<QueueMeta>;
};

/** App data on a queue item: which exit leg it starts, or whether a spend was a guard override. */
export type QueueMeta = { exitId?: string; legId?: string; override?: "1" };

export type ConvertRecord = {
  at: number;
  /** The stealth address that swapped (and still holds the output). */
  address: Address;
  amountIn: string;
  tokenOut: Address;
  symbol: string;
  /** Quoted output; the on-chain floor was `minOut`. */
  amountOut: string;
  minOut: string;
  userOpHash: Hex;
  txHash?: Hex;
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
  /**
   * Optional self-service recovery (§5): a World ID Proof of Human session (D-59). With it, a key rotation is
   * attested by the API and auto-accepted by the employer; without it, the employer approves by hand.
   * `attachedTo` is the label the API has the session on (set with the name claim or attached later).
   */
  recovery?: {
    kind: "world-id" | "placeholder";
    at: number;
    /** The World ID session id (`session_<hex>`) saved for rotation (D-59). */
    sessionId?: string;
    /**
     * @deprecated D-58 stored a Proof of Human nullifier here. Production allows one such proof per
     * person, so it can't back a rotation; a profile with only a nullifier counts as unlinked (link
     * World ID again from Name settings).
     */
    nullifier?: string;
    attachedTo?: string;
    /** Unix seconds. Set for a session attached after the claim: the API's cooldown (72 h by default). */
    rotationAllowedFrom?: number;
  };
  /** The user chose not to set up recovery during onboarding. */
  recoverySkipped?: boolean;
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
  /** Next Privacy Pools deposit index. Pool secrets derive from the seed and this index, so it must never repeat. */
  nextExitPoolIndex?: number;
  onboardedAt?: number;
};

export type RotationRecord = {
  generation: number;
  /** Whether the API attested it (World ID) or the employer has to approve it by hand. */
  path?: "attested" | "manual";
  oldMeta: string;
  newMeta: string;
  at: number;
  setTextTx?: Hex;
  /** MetaRotation attestation from the API, when it returned one. */
  attestation?: unknown;
};

export type PendingRotation = Omit<RotationRecord, "at" | "setTextTx"> & {
  postedAt: number;
  /** "attested": the API accepted a World ID rotation (and relays the registry update itself).
   *  "manual": no session; the employer must approve, and we relay the registry update via /register. */
  path: "attested" | "manual";
  /** Manual path: the ERC-6538 re-registration went through. */
  registered?: boolean;
};

/**
 * SECRET. The wallet-signature key option (plain EOAs only, SDK `keysFromWalletSignature`): the
 * signature over SDK `SIGN_MESSAGE` IS the key material, so it is stored here, encrypted like the seed.
 * Recovery on another device = sign the same message with the same wallet again.
 */
export type WalletKeySecret = { kind: "wallet-signature"; signature: Hex; wallet: Address };

/** What the vault derives keys from: a recovery phrase (default) or a wallet signature. */
export type KeySecret = string | WalletKeySecret;

export type VaultData = {
  version: 1;
  /**
   * SECRET. The one thing the user backs up; every key is derived from it on unlock.
   * "" when the keys come from a wallet signature (`walletKeys`).
   */
  mnemonic: string;
  /** Set instead of `mnemonic` for wallet-signature keys. */
  walletKeys?: WalletKeySecret;
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
    queueWindowHours: [2, 12],
  };
}

/** Settings with defaults filled in, so vaults written by older builds keep working. */
export function settingsOf(data: Pick<VaultData, "settings"> | null | undefined): Settings {
  const { uniswapApiKey: _legacy, swapViaApi: _convert, ...rest } = (data?.settings ?? {}) as Settings & { uniswapApiKey?: string; swapViaApi?: boolean };
  return { ...defaultSettings(), ...rest };
}

export function emptyChainState(): ChainState {
  return { lastScannedBlock: null, matches: [], balances: [], balancesAt: null, graph: null };
}

export function newVaultData(secret: KeySecret): VaultData {
  return {
    version: 1,
    ...(typeof secret === "string" ? { mnemonic: secret } : { mnemonic: "", walletKeys: secret }),
    createdAt: Date.now(),
    settings: defaultSettings(),
    profile: {},
    chains: {},
  };
}

/** Generation-0 keys from whatever the vault holds (recovery phrase, or a wallet signature). */
export function vaultKeys(data: Pick<VaultData, "mnemonic" | "walletKeys">): SoapayKeys {
  return data.walletKeys ? keysFromSignature(data.walletKeys.signature) : keysFromMnemonic(data.mnemonic);
}

/**
 * True when the vault holds a recovery phrase and so can derive new key generations (rotation).
 * Wallet-signature accounts get one by moving to a phrase account (`adoptRecoveryPhrase`).
 */
export const hasRecoveryPhrase = (data: Pick<VaultData, "mnemonic">): boolean => data.mnemonic !== "";

/** 1 when generation 0 is wallet-signature keys and later generations come from a phrase (rotation/keys.ts). */
export const phraseOffsetOf = (data: Pick<VaultData, "walletKeys">): number => (data.walletKeys ? 1 : 0);

/**
 * Move a wallet-signature account to a recovery phrase (owner decision 2026-09-26). The wallet keys
 * stay as generation 0, so old payments are still scanned and spendable and their registrant still
 * controls the name; the phrase supplies generation 1 onward, which the normal rotation route (World ID
 * session, or the employer's re-approval) then points the name at.
 */
export function adoptRecoveryPhrase(data: VaultData, mnemonic: string): VaultData {
  if (!data.walletKeys) throw new Error("This account already uses a recovery phrase.");
  if (data.mnemonic !== "") throw new Error("A recovery phrase is already set up for this account.");
  if (!validateMnemonic(mnemonic)) throw new Error("That isn't a valid recovery phrase.");
  return { ...data, mnemonic: mnemonic.trim().toLowerCase().split(/\s+/).join(" ") };
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

/** The Soapay API's ERC-7677 sponsorship endpoint (testnet spends, D-52), or "" without an API URL. */
export function paymasterUrl(s: Pick<Settings, "apiUrl">): string {
  return s.apiUrl ? `${s.apiUrl.replace(/\/+$/, "")}/paymaster` : "";
}

export function toScanMatch(a: StoredAnnouncement, parse: (m: Hex) => MetadataHints | null): ScanMatch {
  return { announcement: loadAnnouncement(a), hints: parse(a.metadata) };
}
