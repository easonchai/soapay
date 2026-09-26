import { formatUnits } from 'viem';
import type { ChainConfig } from './chains.js';

export const short = (hex: string, n = 6) =>
  hex.length > 2 * n + 2 ? `${hex.slice(0, n + 2)}…${hex.slice(-n)}` : hex;
export const fmtUnits = (v: bigint | string, decimals: number) =>
  formatUnits(typeof v === 'string' ? BigInt(v) : v, decimals);
export const explorerTx = (cfg: ChainConfig, hash: string) => `${cfg.explorer}/tx/${hash}`;
export const explorerAddr = (cfg: ChainConfig, addr: string) => `${cfg.explorer}/address/${addr}`;

/** 4,200.00 style: two decimals, thousands separators. */
export function fmtAmount(v: bigint | string, decimals: number): string {
  const n = Number(formatUnits(typeof v === 'string' ? BigInt(v) : v, decimals));
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** 24 Sep 2026 */
export function fmtDate(ms: number): string {
  const d = new Date(ms);
  const m = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getUTCMonth()];
  return `${d.getUTCDate()} ${m} ${d.getUTCFullYear()}`;
}
