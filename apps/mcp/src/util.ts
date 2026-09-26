import { formatUnits, parseUnits } from "viem";

export const USDC_DECIMALS = 6;

/** A tool failure the model should read: stable `code`, human `message`, optional details. */
export class ToolError extends Error {
  override name = "ToolError";
  constructor(
    readonly code: string,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

/** "2", "2.5", 2.5 → base units. At most 6 decimals, strictly positive. */
export function parseUsdc(v: string | number): bigint {
  const s = typeof v === "number" ? String(v) : v.trim();
  if (!/^\d+(\.\d{1,6})?$/.test(s)) throw new ToolError("invalid_amount", `"${s}" is not a USDC amount (up to 6 decimals)`);
  const out = parseUnits(s, USDC_DECIMALS);
  if (out <= 0n) throw new ToolError("invalid_amount", "amount must be greater than 0");
  return out;
}

export function formatUsdc(v: bigint): string {
  return formatUnits(v, USDC_DECIMALS);
}

/** JSON with bigints as decimal strings. */
export function toJson(value: unknown): string {
  return JSON.stringify(value, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 2);
}

/** Deep copy with bigints as strings (for structuredContent). */
export function plain<T>(value: T): unknown {
  return JSON.parse(toJson(value));
}

export function errorMessage(e: unknown): string {
  const err = e as { shortMessage?: string; message?: string };
  return String(err?.shortMessage ?? err?.message ?? e).split("\n")[0] ?? "unknown error";
}
