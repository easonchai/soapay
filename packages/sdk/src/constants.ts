import { base, baseSepolia, sepolia, mainnet } from "viem/chains";
import type { Address, Chain } from "viem";
// Plain data only: this module must not import the ScopeLift SDK, so plain
// Node (apps/api) can load it. test/constants.test.ts checks these values
// against ScopeLift's exports.

/** ERC-5564 scheme 1: secp256k1 with view tags. Equals ScopeLift VALID_SCHEME_ID.SCHEME_ID_1. */
export const SCHEME_ID = 1 as const;

/** Canonical singletons, identical on every supported chain. Never forks (PRD: Components). */
export const ANNOUNCER_ADDRESS: Address = "0x55649E01B5Df198D18D95b5cc5051630cfD45564";
export const REGISTRY_ADDRESS: Address = "0x6538E6bf4B0eBd30A8Ea093027Ac2422ce5d6538";

/** Announcer deployment blocks (ScopeLift ERC5564_StartBlocks). */
const ANNOUNCER_START_BLOCKS = { base: 15502414n, baseSepolia: 7552655n } as const;

/** EntryPoint v0.8 (supports EIP-7702 userOps). */
export const ENTRYPOINT_V08 = "0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108" as const;
/** eth-infinitism Simple7702Account: the widely used 7702 delegate (smaller fingerprint). */
export const SIMPLE_7702_ACCOUNT = "0xe6Cae83BdE06E4c305530e199D7217f42808555B" as const;
/** Deterministic CREATE2 deployer used by contracts/script/Deploy.s.sol. */
export const CREATE2_DEPLOYER = "0x4e59b44847b379578588920cA78FbF26c0B4956C" as const;
/** keccak256("soapay.StealthDisperse.v1"), the StealthDisperse CREATE2 salt. */
export const STEALTH_DISPERSE_SALT_LABEL = "soapay.StealthDisperse.v1";

/** Max lines per pay-run transaction (~42k gas/line under the 2^24 per-tx cap). */
export const MAX_LINES_PER_TX = 350;
/** Packed StealthDisperse amounts are uint80. */
export const MAX_LINE_AMOUNT = (1n << 80n) - 1n;

/**
 * Real Circle USDC per chain. The pay token equals it on mainnet; on Base Sepolia the pay token is
 * our mock (D-52), but the Circle paymaster and the CCTP exit still need Circle's token.
 */
export const CIRCLE_USDC = {
  [base.id]: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  [baseSepolia.id]: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
  [sepolia.id]: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
} as const satisfies Record<number, Address>;

/**
 * TESTNET ONLY (D-52): "USD Coin (Soapay test)", 6 decimals, EIP-2612, minted by the API faucet.
 * contracts/src/MockUSDC.sol, deployed 2026-09-26 (docs/testnet-deployment.md).
 */
export const MOCK_USDC_BASE_SEPOLIA: Address = "0x028D969c20b740582428f5043954c380686214Bb";

/**
 * How stealth spends pay gas (spend.ts). "circle-usdc": the Circle paymaster takes it in USDC
 * (mainnet). "sponsored": a sponsorship paymaster pays it (Base Sepolia, through the Soapay API's
 * `/paymaster` proxy; D-52).
 */
export type PaymasterMode = "circle-usdc" | "sponsored";

export type SoapayChainConfig = {
  chain: Chain;
  /** The pay token (the "USDC" the apps show): Circle USDC on mainnet, the mock on Base Sepolia. */
  usdc: Address;
  announcerStartBlock: bigint;
  /** StealthDisperse address once deployed; undefined until then. */
  stealthDisperse?: Address;
  /** Chain hosting ENS for *.soapay.eth. */
  ensChain: Chain;
  /** Default gas mode for stealth spends on this chain. */
  paymaster: PaymasterMode;
};

export const CHAINS = {
  [base.id]: {
    chain: base,
    usdc: CIRCLE_USDC[base.id],
    announcerStartBlock: ANNOUNCER_START_BLOCKS.base,
    ensChain: mainnet,
    paymaster: "circle-usdc",
  },
  [baseSepolia.id]: {
    chain: baseSepolia,
    usdc: MOCK_USDC_BASE_SEPOLIA,
    announcerStartBlock: ANNOUNCER_START_BLOCKS.baseSepolia,
    ensChain: sepolia,
    paymaster: "sponsored",
  },
} as const satisfies Record<number, SoapayChainConfig>;

export type SoapayChainId = keyof typeof CHAINS;

/** Chains whose pay token may be overridden (never mainnet: its token and paths stay fixed). */
const OVERRIDABLE_PAY_TOKEN_CHAINS: readonly number[] = [baseSepolia.id];
const payTokenOverrides = new Map<number, Address>();

/**
 * Overrides the pay token on a testnet (e.g. from `VITE_PAY_TOKEN` / `PAY_TOKEN`). `undefined` or an
 * empty string clears it. Throws for mainnet, whose token is fixed. Apps call this once at startup.
 */
export function setPayTokenOverride(chainId: number, token: string | undefined | null): void {
  if (!token) {
    payTokenOverrides.delete(chainId);
    return;
  }
  if (!OVERRIDABLE_PAY_TOKEN_CHAINS.includes(chainId)) throw new Error(`Soapay: the pay token on chain ${chainId} cannot be overridden`);
  if (!/^0x[0-9a-fA-F]{40}$/.test(token)) throw new Error(`Soapay: pay token override "${token}" is not an address`);
  payTokenOverrides.set(chainId, token as Address);
}

/** The pay token on `chainId`, override included. */
export function payTokenFor(chainId: number): Address {
  return getChainConfig(chainId).usdc;
}

/** Whether the pay token on `chainId` is Circle's USDC (the exit and the Circle paymaster need it). */
export function isCircleUsdcPayToken(chainId: number): boolean {
  const circle = (CIRCLE_USDC as Record<number, Address>)[chainId];
  return !!circle && circle.toLowerCase() === payTokenFor(chainId).toLowerCase();
}

export function getChainConfig(chainId: number): SoapayChainConfig {
  const c = (CHAINS as Record<number, SoapayChainConfig>)[chainId];
  if (!c) throw new Error(`Soapay: unsupported chain ${chainId}`);
  const override = payTokenOverrides.get(chainId);
  return override ? { ...c, usdc: override } : c;
}

/** A chain a stealth address can spend on (userOps via the Circle paymaster) without being a payroll chain. */
export type SpendChainConfig = { chain: Chain; usdc: Address };

/**
 * Exit destination chains (docs/mvp-spec.md §9): stealth addresses spend here after a CCTP bridge, but
 * nothing is paid or scanned here, so they are deliberately NOT in `CHAINS` (apps list CHAINS as
 * payroll chains). USDC checked with eth_getCode on 2026-09-25.
 */
export const SPEND_ONLY_CHAINS = {
  [sepolia.id]: { chain: sepolia, usdc: CIRCLE_USDC[sepolia.id] },
} as const satisfies Record<number, SpendChainConfig>;

/** Chain + pay token for spend clients and paymasters: payroll chains first, then exit destinations. */
export function getSpendChainConfig(chainId: number): SpendChainConfig {
  if ((CHAINS as Record<number, unknown>)[chainId]) return getChainConfig(chainId);
  const c = (SPEND_ONLY_CHAINS as Record<number, SpendChainConfig>)[chainId];
  if (!c) throw new Error(`Soapay: unsupported chain ${chainId}`);
  return c;
}

/** Default spend gas mode: the chain's `paymaster`, and the Circle paymaster on exit destinations. */
export function defaultPaymasterMode(chainId: number): PaymasterMode {
  return (CHAINS as Record<number, SoapayChainConfig>)[chainId]?.paymaster ?? "circle-usdc";
}

/** Circle USDC on `chainId` (Circle paymaster fee token, CCTP). Throws where Circle has none. */
export function circleUsdcFor(chainId: number): Address {
  const a = (CIRCLE_USDC as Record<number, Address>)[chainId];
  if (!a) throw new Error(`Soapay: no Circle USDC known for chain ${chainId}`);
  return a;
}

/** Default MVP chain. */
export const DEFAULT_CHAIN_ID: SoapayChainId = baseSepolia.id;

/** Parent ENS name for platform-issued subnames. */
export const PARENT_NAME = "soapay.eth";
/** ENS text record keys served for subnames. */
export const TEXT_KEY_STEALTH = "stealth";
export const TEXT_KEY_REGISTRANT = "soapay:registrant";

/** Back-compat for code written against the first scaffold. */
export const SOAPAY_CHAIN = base;
export const USDC_BASE = CHAINS[base.id].usdc;
export const ANNOUNCER_START_BLOCK_BASE = CHAINS[base.id].announcerStartBlock;
