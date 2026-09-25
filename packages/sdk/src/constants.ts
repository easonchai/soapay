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

export type SoapayChainConfig = {
  chain: Chain;
  usdc: Address;
  announcerStartBlock: bigint;
  /** StealthDisperse address once deployed; undefined until then. */
  stealthDisperse?: Address;
  /** Chain hosting ENS for *.soapay.eth. */
  ensChain: Chain;
};

export const CHAINS = {
  [base.id]: {
    chain: base,
    usdc: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    announcerStartBlock: ANNOUNCER_START_BLOCKS.base,
    ensChain: mainnet,
  },
  [baseSepolia.id]: {
    chain: baseSepolia,
    usdc: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    announcerStartBlock: ANNOUNCER_START_BLOCKS.baseSepolia,
    ensChain: sepolia,
  },
} as const satisfies Record<number, SoapayChainConfig>;

export type SoapayChainId = keyof typeof CHAINS;

export function getChainConfig(chainId: number): SoapayChainConfig {
  const c = (CHAINS as Record<number, SoapayChainConfig>)[chainId];
  if (!c) throw new Error(`Soapay: unsupported chain ${chainId}`);
  return c;
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
