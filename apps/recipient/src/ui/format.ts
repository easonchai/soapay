import { formatUnits, parseUnits } from "viem";

export const USDC_DECIMALS = 6;

const usdFmt = new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const preciseFmt = new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 6 });

/** 1234567n → "1.23" (2 dp) or "1.234567" when `precise`. */
export function formatUsdc(v: bigint | null | undefined, opts: { precise?: boolean } = {}): string {
  if (v === null || v === undefined) return "—";
  const n = Number(formatUnits(v, USDC_DECIMALS));
  return (opts.precise ? preciseFmt : usdFmt).format(n);
}

/** Parses a user-entered USDC amount. Returns null for anything that isn't a positive decimal with ≤ 6 dp. */
export function parseUsdc(input: string): bigint | null {
  const s = input.trim().replace(/,/g, "");
  if (!/^\d+(\.\d{0,6})?$/.test(s) && !/^\.\d{1,6}$/.test(s)) return null;
  try {
    const v = parseUnits(s.startsWith(".") ? `0${s}` : s, USDC_DECIMALS);
    return v > 0n ? v : null;
  } catch {
    return null;
  }
}

export function shortAddr(a: string, chars = 4): string {
  return a.length <= 2 + chars * 2 ? a : `${a.slice(0, 2 + chars)}…${a.slice(-chars)}`;
}

/** A future queue window: "now", "in 40 min", or "in 5 h · Sat 14:30". */
export function windowTime(ts: number, now = Date.now()): string {
  const m = Math.round((ts - now) / 60_000);
  if (m <= 0) return "now";
  if (m < 60) return `in ${m} min`;
  const clock = new Date(ts).toLocaleString([], { weekday: "short", hour: "2-digit", minute: "2-digit" });
  return `in ${Math.round(m / 60)} h · ${clock}`;
}

export function relativeTime(ts: number, now = Date.now()): string {
  const s = Math.round((now - ts) / 1000);
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  return new Date(ts).toLocaleDateString();
}
