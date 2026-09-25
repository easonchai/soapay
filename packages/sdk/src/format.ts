import { formatUnits } from 'viem';
import type { ChainConfig } from './chains.js';

export const short = (hex: string, n = 6) =>
  hex.length > 2 * n + 2 ? `${hex.slice(0, n + 2)}…${hex.slice(-n)}` : hex;
export const fmtUnits = (v: bigint | string, decimals: number) =>
  formatUnits(typeof v === 'string' ? BigInt(v) : v, decimals);
export const explorerTx = (cfg: ChainConfig, hash: string) => `${cfg.explorer}/tx/${hash}`;
export const explorerAddr = (cfg: ChainConfig, addr: string) => `${cfg.explorer}/address/${addr}`;
