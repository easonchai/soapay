import type { AnnouncementRecord, ClusterGraphJSON, MetadataHints, ScanMatch } from "@soapay/sdk";
import type { Address, Hex } from "viem";
import { keysFromMnemonic, keysFromSignature, type SoapayKeys } from "@soapay/sdk";
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
  /** Convert via the Soapay API's Uniswap proxy (`${apiUrl}/uniswap`); off = Universal Router fallback. */
  swapViaApi: boolean;
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
  /** Local convert-in-place history (never leaves the device; a public preference could fingerprint). */
  conversions?: ConvertRecord[];
  /** Privacy Pools exits started from this chain (docs/mvp-spec.md §9). Resumed on unlock. */
  exits?: ExitRecord[];
};

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
   * Optional self-service recovery (§5): a World ID Selfie Check session. With it, a key rotation is
   * attested by the API and auto-accepted by the employer; without it, the employer approves by hand.
   * `attachedTo` is the label the API has the session on (set with the name claim or attached later).
   */
  recovery?: {
    kind: "world-id" | "placeholder";
    at: number;
    sessionId?: string;
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
    swapViaApi: ENV.swapViaApi,
  };
}

/** Settings with defaults filled in, so vaults written by older builds keep working. */
export function settingsOf(data: Pick<VaultData, "settings"> | null | undefined): Settings {
  const { uniswapApiKey: _legacy, ...rest } = (data?.settings ?? {}) as Settings & { uniswapApiKey?: string };
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

/** Recovery-phrase vaults can rotate keys (features/rotation/keys.ts); wallet-signature ones can't yet. */
export const hasRecoveryPhrase = (data: Pick<VaultData, "walletKeys">): boolean => !data.walletKeys;

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

/** The Trading API proxy base for the SDK's `apiUrl`, or "" for the Universal Router fallback. */
export function swapProxyUrl(s: Pick<Settings, "apiUrl" | "swapViaApi">): string {
  return s.swapViaApi && s.apiUrl ? `${s.apiUrl.replace(/\/+$/, "")}/uniswap` : "";
}

export function toScanMatch(a: StoredAnnouncement, parse: (m: Hex) => MetadataHints | null): ScanMatch {
  return { announcement: loadAnnouncement(a), hints: parse(a.metadata) };
}
