/**
 * Chain and asset registry (D-29). Any EVM chain can be registered at runtime; Base and Base Sepolia
 * come pre-registered from `CHAINS`. The ERC-5564 Announcer and ERC-6538 Registry are CREATE2
 * singletons at the same address on every chain, so a registration only needs the viem `Chain` unless
 * a chain has a non-canonical deployment.
 *
 * Assets are typed for ERC-20, native, ERC-721 and ERC-1155. What the SDK supports today is ERC-20
 * only (StealthDisperse pulls with `transferFrom`, scanning reads `balanceOf`); the other kinds are
 * reported as unsupported with a clear error instead of failing somewhere deep in encoding.
 *
 * Plain data plus viem only (no ScopeLift import), so plain Node can load it.
 */
import { getAddress, isAddress, type Address, type Chain } from "viem";
import { base, baseSepolia } from "viem/chains";
import { ANNOUNCER_ADDRESS, CHAINS, REGISTRY_ADDRESS, payTokenFor, setPayTokenOverride } from "./constants.js";

// ---------------------------------------------------------------------------------------------
// Assets

export type AssetKind = "erc20" | "native" | "erc721" | "erc1155";

export type Erc20Asset = { kind: "erc20"; address: Address; symbol?: string; decimals?: number };
export type NativeAsset = { kind: "native"; symbol?: string; decimals?: number };
export type Erc721Asset = { kind: "erc721"; address: Address; symbol?: string };
export type Erc1155Asset = { kind: "erc1155"; address: Address; tokenId: bigint; symbol?: string };

/** Anything a distribution could pay out. Only `erc20` is distributable today; see `assetCapabilities`. */
export type Asset = Erc20Asset | NativeAsset | Erc721Asset | Erc1155Asset;

/** What the SDK can do with an asset kind today. */
export type AssetCapabilities = {
  /** Plan and encode a distribution (StealthDisperse or an EIP-5792 batch). */
  distribute: boolean;
  /** Recognise the asset in announcement metadata and read balances while scanning. */
  scan: boolean;
  /** Spend from a stealth address (userOp through a paymaster). */
  spend: boolean;
  /** Split one recipient's amount into identical denominations. */
  denominate: boolean;
  /** Why the kind is (partly) unsupported; undefined when fully supported. */
  reason?: string;
};

const CAPABILITIES: Record<AssetKind, AssetCapabilities> = {
  erc20: { distribute: true, scan: true, spend: true, denominate: true },
  native: {
    distribute: false,
    scan: false,
    spend: false,
    denominate: false,
    reason:
      "native coin payouts are not supported yet: StealthDisperse pulls ERC-20s with transferFrom and the scanner reads balanceOf. Wrap to WETH (an ERC-20) instead.",
  },
  erc721: {
    distribute: false,
    scan: false,
    spend: false,
    denominate: false,
    reason: "ERC-721 payouts are not supported yet: each token is unique, so it cannot be denominated and needs its own announcement metadata.",
  },
  erc1155: {
    distribute: false,
    scan: false,
    spend: false,
    denominate: false,
    reason: "ERC-1155 payouts are not supported yet: StealthDisperse and the scanner handle ERC-20 transfers only.",
  },
};

export function assetCapabilities(asset: Asset | AssetKind): AssetCapabilities {
  const kind = typeof asset === "string" ? asset : asset.kind;
  const caps = CAPABILITIES[kind];
  if (!caps) throw new UnsupportedAssetError(kind as AssetKind, "distribute", `unknown asset kind "${String(kind)}"`);
  return { ...caps };
}

export type AssetCapability = Exclude<keyof AssetCapabilities, "reason">;

export class UnsupportedAssetError extends Error {
  readonly kind: AssetKind;
  readonly capability: AssetCapability;
  constructor(kind: AssetKind, capability: AssetCapability, reason: string) {
    super(`Soapay: cannot ${capability} ${kind}: ${reason}`);
    this.name = "UnsupportedAssetError";
    this.kind = kind;
    this.capability = capability;
  }
}

/** Throws UnsupportedAssetError unless the SDK supports `capability` for this asset. */
export function assertAssetSupports(asset: Asset, capability: AssetCapability): void {
  const caps = assetCapabilities(asset);
  if (!caps[capability]) throw new UnsupportedAssetError(asset.kind, capability, caps.reason ?? "unsupported");
}

/** Narrows to the one kind distributions support today (ERC-20), with a clear error otherwise. */
export function assertDistributable(asset: Asset): asserts asset is Erc20Asset {
  assertAssetSupports(asset, "distribute");
  if (asset.kind === "erc20" && !isAddress(asset.address, { strict: false })) {
    throw new Error("Soapay: ERC-20 asset needs a valid token address");
  }
}

/** Builds an ERC-20 asset (checksums the address). */
export function erc20Asset(address: string, opts: { symbol?: string; decimals?: number } = {}): Erc20Asset {
  if (!isAddress(address, { strict: false })) throw new Error(`Soapay: bad token address ${address}`);
  return { kind: "erc20", address: getAddress(address), ...opts };
}

export function nativeAsset(opts: { symbol?: string; decimals?: number } = {}): NativeAsset {
  return { kind: "native", decimals: 18, ...opts };
}

/** The token address a distribution transfers, or throws for unsupported kinds. */
export function assetAddress(asset: Asset): Address {
  assertDistributable(asset);
  return asset.address;
}

// ---------------------------------------------------------------------------------------------
// Compliance hook

/**
 * Receive-side check for allowlisted assets (security tokens). This is the extension point for
 * ERC-3643-style stock: an implementation would ask the token's identity registry / compliance
 * module whether `address` may hold `asset` before a line is paid.
 *
 * Caveat, and why only the interface ships: stealth addresses are fresh per payment, so a permissioned
 * token would need each stealth address registered with the issuer's identity registry first, which
 * links it to the holder's identity for the issuer (acceptable when the issuer is the trusted payer,
 * as with the employer in payroll). Nothing in the SDK does that registration today.
 */
export type ComplianceDecision = { allowed: true } | { allowed: false; reason: string };

export type ComplianceHook = {
  canReceive(address: Address, asset: Asset): Promise<ComplianceDecision> | ComplianceDecision;
};

/** Allows everything: the default for plain ERC-20s such as USDC. */
export const noopComplianceHook: ComplianceHook = {
  canReceive: () => ({ allowed: true }),
};

export class ComplianceError extends Error {
  readonly refused: { address: Address; reason: string }[];
  constructor(refused: { address: Address; reason: string }[]) {
    super(`Soapay: compliance hook refused ${refused.length} address(es): ${refused.map((r) => `${r.address} (${r.reason})`).join(", ")}`);
    this.name = "ComplianceError";
    this.refused = refused;
  }
}

/** Runs `hook` over every address; throws ComplianceError listing all refusals. */
export async function assertCompliant(hook: ComplianceHook, addresses: readonly Address[], asset: Asset): Promise<void> {
  const refused: { address: Address; reason: string }[] = [];
  for (const address of addresses) {
    const d = await hook.canReceive(address, asset);
    if (!d.allowed) refused.push({ address, reason: d.reason });
  }
  if (refused.length > 0) throw new ComplianceError(refused);
}

// ---------------------------------------------------------------------------------------------
// Chains

export type ChainRegistration = {
  chain: Chain;
  /** Defaults to the canonical ERC-5564 Announcer (same address everywhere). */
  announcer?: Address;
  /** Defaults to the canonical ERC-6538 Registry (same address everywhere). */
  registry?: Address;
  /** First block worth scanning (the Announcer deployment). Defaults to 0n. */
  announcerStartBlock?: bigint;
  /** StealthDisperse deployment, if any. Without it only the EIP-5792 batch path is available. */
  stealthDisperse?: Address;
  /** Chain hosting ENS for name resolution, if names are used. */
  ensChain?: Chain;
  /** Known assets by symbol (upper-case keys are conventional, lookups ignore case). */
  assets?: Record<string, Asset>;
};

export type RegisteredChain = {
  id: number;
  chain: Chain;
  announcer: Address;
  registry: Address;
  announcerStartBlock: bigint;
  stealthDisperse?: Address;
  ensChain?: Chain;
  assets: Record<string, Asset>;
};

export class UnknownChainError extends Error {
  readonly chainId: number;
  constructor(chainId: number) {
    super(`Soapay: chain ${chainId} is not registered; call registerChain({ chain }) first`);
    this.name = "UnknownChainError";
    this.chainId = chainId;
  }
}

const chainRegistry = new Map<number, RegisteredChain>();

function normalize(config: ChainRegistration): RegisteredChain {
  const assets: Record<string, Asset> = {};
  for (const [symbol, asset] of Object.entries(config.assets ?? {})) assets[symbol.toUpperCase()] = asset;
  const out: RegisteredChain = {
    id: config.chain.id,
    chain: config.chain,
    announcer: getAddress(config.announcer ?? ANNOUNCER_ADDRESS),
    registry: getAddress(config.registry ?? REGISTRY_ADDRESS),
    announcerStartBlock: config.announcerStartBlock ?? 0n,
    assets,
  };
  if (config.stealthDisperse) out.stealthDisperse = getAddress(config.stealthDisperse);
  if (config.ensChain) out.ensChain = config.ensChain;
  return out;
}

/**
 * Registers (or replaces) a chain. Returns the normalised entry. Registration is process-global,
 * like viem's chain objects; libraries should register once at startup.
 */
export function registerChain(config: ChainRegistration): RegisteredChain {
  const entry = normalize(config);
  chainRegistry.set(entry.id, entry);
  return entry;
}

/** The registered chain, or throws UnknownChainError. */
export function getChain(chainId: number): RegisteredChain {
  const c = chainRegistry.get(chainId);
  if (!c) throw new UnknownChainError(chainId);
  return c;
}

export function tryGetChain(chainId: number): RegisteredChain | undefined {
  return chainRegistry.get(chainId);
}

export function listChains(): RegisteredChain[] {
  return [...chainRegistry.values()];
}

/** Testnets Soapay knows without a registration (Base Sepolia, Ethereum Sepolia). */
export const KNOWN_TESTNET_CHAIN_IDS: readonly number[] = [84532, 11155111];

/**
 * True on a testnet: a registered chain whose viem `Chain` says `testnet: true`, or one of
 * KNOWN_TESTNET_CHAIN_IDS. Apps use it for testnet-sized default amounts (faucet USDC is scarce).
 */
export function isTestnetChain(chainId: number): boolean {
  const c = chainRegistry.get(chainId);
  if (c?.chain.testnet !== undefined) return c.chain.testnet === true;
  return KNOWN_TESTNET_CHAIN_IDS.includes(chainId);
}

/** Removes a registration (tests, or apps that restrict chains). Returns true if one existed. */
export function unregisterChain(chainId: number): boolean {
  return chainRegistry.delete(chainId);
}

/**
 * Resolves `--asset`-style input on a chain: a registered symbol (case-insensitive) or a token address.
 * Unknown symbols throw.
 */
export function resolveAsset(chainId: number, symbolOrAddress: string): Asset {
  if (isAddress(symbolOrAddress, { strict: false })) {
    const addr = getAddress(symbolOrAddress);
    const known = Object.values(getChain(chainId).assets).find((a) => a.kind === "erc20" && a.address === addr);
    return known ?? erc20Asset(addr);
  }
  const asset = getChain(chainId).assets[symbolOrAddress.toUpperCase()];
  if (!asset) throw new Error(`Soapay: no asset "${symbolOrAddress}" registered on chain ${chainId}`);
  return asset;
}

/** StealthDisperse on Base Sepolia (docs/testnet-deployment.md, CREATE2 salt `soapay.StealthDisperse.v1`). */
export const STEALTH_DISPERSE_BASE_SEPOLIA: Address = "0x6B7a1cC570Af2DDd427DA694351438F0FE8039CA";

function registerDefaults(): void {
  registerChain({
    chain: base,
    announcerStartBlock: CHAINS[base.id].announcerStartBlock,
    ensChain: CHAINS[base.id].ensChain,
    assets: { USDC: erc20Asset(CHAINS[base.id].usdc, { symbol: "USDC", decimals: 6 }) },
  });
  registerChain({
    chain: baseSepolia,
    announcerStartBlock: CHAINS[baseSepolia.id].announcerStartBlock,
    ensChain: CHAINS[baseSepolia.id].ensChain,
    stealthDisperse: STEALTH_DISPERSE_BASE_SEPOLIA,
    // The pay token: the mock on Base Sepolia (D-52) unless `configurePayToken` overrides it.
    assets: { USDC: erc20Asset(payTokenFor(baseSepolia.id), { symbol: "USDC", decimals: 6 }) },
  });
}

registerDefaults();

/**
 * Sets (or clears, with an empty value) the testnet pay-token override (`setPayTokenOverride`) and
 * points the registered "USDC" asset at it. Apps call this once at startup with `VITE_PAY_TOKEN` /
 * `PAY_TOKEN`. Throws for mainnet, whose token is fixed.
 */
export function configurePayToken(chainId: number, token: string | undefined | null): void {
  setPayTokenOverride(chainId, token);
  const entry = chainRegistry.get(chainId);
  if (entry) entry.assets.USDC = erc20Asset(getAddress(payTokenFor(chainId)), { symbol: "USDC", decimals: 6 });
}

/** Restores the registry to the pre-registered defaults (Base, Base Sepolia). For tests. */
export function resetChainRegistry(): void {
  chainRegistry.clear();
  registerDefaults();
}
