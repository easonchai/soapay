import { base, baseSepolia, type Chain } from 'viem/chains';
import { ERC5564_StartBlocks } from '@scopelift/stealth-address-sdk';
import { ANNOUNCER_ADDRESS, REGISTRY_ADDRESS, USDC_BASE } from './constants.js';

export type SupportedChainId = 8453 | 84532;

export type ChainConfig = {
  chain: Chain;
  chainId: SupportedChainId;
  rpcUrl: string;
  mainnetRpcUrl: string;
  announcer: `0x${string}`;
  registry: `0x${string}`;
  usdc: `0x${string}`;
  usdcDecimals: 6;
  explorer: string;
  scanStartBlock: bigint;
  scanChunkSize: bigint;
  relayUrl: string;
  stealthDisperse?: `0x${string}`;
};

const PRESETS: Record<
  SupportedChainId,
  { chain: Chain; rpcUrl: string; usdc: `0x${string}`; explorer: string; startBlock: bigint }
> = {
  8453: {
    chain: base,
    rpcUrl: 'https://mainnet.base.org',
    usdc: USDC_BASE,
    explorer: 'https://basescan.org',
    startBlock: BigInt(ERC5564_StartBlocks.BASE),
  },
  84532: {
    chain: baseSepolia,
    rpcUrl: 'https://sepolia.base.org',
    // Circle USDC on Base Sepolia (name "USDC", version "2", 6 decimals; checked on-chain 2026-09-25)
    usdc: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
    explorer: 'https://sepolia.basescan.org',
    startBlock: BigInt(ERC5564_StartBlocks.BASE_SEPOLIA),
  },
};

/** Environment keys the apps map their own prefixed variables onto. */
export type ChainEnv = Partial<
  Record<
    'CHAIN_ID' | 'RPC_URL' | 'MAINNET_RPC_URL' | 'USDC_ADDRESS' | 'SCAN_CHUNK_SIZE' | 'RELAY_URL' | 'STEALTH_DISPERSE_ADDRESS',
    string | undefined
  >
>;

/** Base mainnet unless CHAIN_ID says otherwise. Base Sepolia is the dev target. */
export function getChainConfig(env: ChainEnv = {}): ChainConfig {
  const id = Number(env.CHAIN_ID ?? '8453');
  if (id !== 8453 && id !== 84532) {
    throw new Error(`Unsupported CHAIN_ID=${id}. Use 8453 (Base) or 84532 (Base Sepolia).`);
  }
  const p = PRESETS[id];
  const disperse = env.STEALTH_DISPERSE_ADDRESS as `0x${string}` | undefined;
  const cfg: ChainConfig = {
    chain: p.chain,
    chainId: id,
    rpcUrl: env.RPC_URL ?? p.rpcUrl,
    mainnetRpcUrl: env.MAINNET_RPC_URL ?? 'https://ethereum-rpc.publicnode.com',
    announcer: ANNOUNCER_ADDRESS,
    registry: REGISTRY_ADDRESS,
    usdc: (env.USDC_ADDRESS as `0x${string}` | undefined) ?? p.usdc,
    usdcDecimals: 6,
    explorer: p.explorer,
    scanStartBlock: p.startBlock,
    scanChunkSize: BigInt(env.SCAN_CHUNK_SIZE ?? '2000'),
    relayUrl: env.RELAY_URL ?? 'http://localhost:8787/relay',
  };
  if (disperse && /^0x[0-9a-fA-F]{40}$/.test(disperse)) cfg.stealthDisperse = disperse;
  return cfg;
}
