/**
 * Display formatters shared by both apps (ported from CK's M1 `format.ts`, keyed by chain id
 * instead of his env-derived ChainConfig). Pure; no locale state beyond `en-US` grouping.
 */
import { formatUnits } from "viem";
import { getSpendChainConfig } from "./constants.js";

/** `0x1234ab…cdef56`: keeps `n` hex chars after `0x` and `n` at the end. */
export const short = (hex: string, n = 6): string => (hex.length > 2 * n + 2 ? `${hex.slice(0, n + 2)}…${hex.slice(-n)}` : hex);

/** Exact decimal string (no grouping, no rounding). */
export const fmtUnits = (v: bigint | string, decimals: number): string => formatUnits(typeof v === "string" ? BigInt(v) : v, decimals);

/** `4,200.00`: two decimals, thousands separators. Display only; round-trips through a float. */
export function fmtAmount(v: bigint | string, decimals: number): string {
  const n = Number(formatUnits(typeof v === "string" ? BigInt(v) : v, decimals));
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

/** `24 Sep 2026` (UTC). */
export function fmtDate(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

function explorerBase(chainId: number): string | undefined {
  try {
    return getSpendChainConfig(chainId).chain.blockExplorers?.default.url;
  } catch {
    return undefined;
  }
}

/** Block-explorer link for a transaction, or undefined for a chain without one. */
export function explorerTx(chainId: number, hash: string): string | undefined {
  const b = explorerBase(chainId);
  return b ? `${b}/tx/${hash}` : undefined;
}

/** Block-explorer link for an address, or undefined for a chain without one. */
export function explorerAddress(chainId: number, address: string): string | undefined {
  const b = explorerBase(chainId);
  return b ? `${b}/address/${address}` : undefined;
}

/** What a paid wallet's live balance says about it (CK's company view). */
export type SpendStatus = "unspent" | "partly spent" | "withdrawn" | "unknown";

/** `liveBalance` undefined = not read yet (or the read failed). */
export function spendStatus(amountPaid: bigint, liveBalance: bigint | null | undefined): SpendStatus {
  if (liveBalance === undefined || liveBalance === null) return "unknown";
  if (liveBalance === 0n) return "withdrawn";
  if (liveBalance < amountPaid) return "partly spent";
  return "unspent";
}

/**
 * Headline total from live balances only (metadata amounts are announcer-controlled and never
 * summed). Unread (`undefined`/`null`) balances count as zero.
 */
export function sumLiveBalances(balances: Iterable<bigint | null | undefined>): bigint {
  let total = 0n;
  for (const b of balances) if (typeof b === "bigint") total += b;
  return total;
}
