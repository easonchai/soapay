import type { ContentfulStatusCode } from "hono/utils/http-status";
import { isHex, type Hex } from "viem";
import { formatMetaAddressURI, parseMetaAddress as sdkParseMetaAddress } from "@soapay/sdk";
import type { Db } from "./db.js";

/** Consistent JSON error: `{ error: { code, message } }`. */
export class ApiError extends Error {
  constructor(
    readonly status: ContentfulStatusCode,
    readonly code: string,
    message: string,
    readonly headers: Record<string, string> = {},
  ) {
    super(message);
  }
}

export function errorBody(code: string, message: string) {
  return { error: { code, message } };
}

export type Logger = {
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
};

export const consoleLogger: Logger = {
  info: (msg, f) => console.log(JSON.stringify({ level: "info", msg, ...f, t: new Date().toISOString() })),
  warn: (msg, f) => console.warn(JSON.stringify({ level: "warn", msg, ...f, t: new Date().toISOString() })),
  error: (msg, f) => console.error(JSON.stringify({ level: "error", msg, ...f, t: new Date().toISOString() })),
};

export const silentLogger: Logger = { info() {}, warn() {}, error() {} };

/** Short, non-replayable fingerprint of a signature for logs. Never log signatures in full. */
export function redactSig(sig: string): string {
  return sig.length <= 14 ? "0x…" : `${sig.slice(0, 10)}…(${(sig.length - 2) / 2}B)`;
}

// ---------------------------------------------------------------------------
// Stealth meta-addresses: "st:<chain>:0x<66 bytes>" URI or raw 0x hex.

export type ParsedMeta = {
  /** 66 registry bytes (spending pubkey || viewing pubkey), lowercase. */
  bytes: Hex;
  /** Canonical URI, the form NameClaims are signed over: st:eth:0x<lowercase>. */
  uri: string;
};

/**
 * Parses a meta-address URI (any st:<chain>: prefix) or raw hex. Both keys must be
 * valid compressed secp256k1 points (checked by @soapay/sdk parseMetaAddress).
 */
export function parseMetaAddress(input: unknown): ParsedMeta {
  if (typeof input !== "string" || input.length > 256) {
    throw new ApiError(400, "invalid_meta_address", "metaAddress must be a string");
  }
  const stripped = input.trim().replace(/^st:[a-z0-9]+:/i, "");
  try {
    const bytes = sdkParseMetaAddress(stripped);
    return { bytes, uri: formatMetaAddressURI(bytes) };
  } catch (e) {
    throw new ApiError(400, "invalid_meta_address", (e as Error).message.replace(/^Soapay: /, ""));
  }
}

export function sameBytes(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

export function requireHex(v: unknown, field: string, maxBytes: number): Hex {
  if (typeof v !== "string" || !isHex(v, { strict: true }) || v.length % 2 !== 0) {
    throw new ApiError(400, `invalid_${field}`, `${field} must be 0x-prefixed hex`);
  }
  if ((v.length - 2) / 2 > maxBytes) throw new ApiError(400, `invalid_${field}`, `${field} is too long`);
  return v.toLowerCase() as Hex;
}

// ---------------------------------------------------------------------------
// Fixed-window rate limiter backed by SQLite.

export type RateResult = { allowed: boolean; retryAfter: number };

export function hitRateLimit(
  db: Db,
  bucket: string,
  key: string,
  limit: number,
  windowSeconds: number,
  nowSeconds: number,
): RateResult {
  const windowStart = nowSeconds - (nowSeconds % windowSeconds);
  const row = db
    .prepare("SELECT window_start, count FROM rate_limits WHERE bucket = ? AND key = ?")
    .get(bucket, key) as { window_start: number; count: number } | undefined;
  const count = row && row.window_start === windowStart ? row.count : 0;
  const retryAfter = windowStart + windowSeconds - nowSeconds;
  if (count >= limit) return { allowed: false, retryAfter };
  db.prepare(
    `INSERT INTO rate_limits (bucket, key, window_start, count) VALUES (?, ?, ?, ?)
     ON CONFLICT(bucket, key) DO UPDATE SET window_start = excluded.window_start, count = excluded.count`,
  ).run(bucket, key, windowStart, count + 1);
  return { allowed: true, retryAfter };
}

/** Checks every limit first, then records a hit in each, so one rejection doesn't burn the others. */
export function enforceRateLimits(
  db: Db,
  checks: { bucket: string; key: string; limit: number }[],
  windowSeconds: number,
  nowSeconds: number,
): void {
  const windowStart = nowSeconds - (nowSeconds % windowSeconds);
  for (const c of checks) {
    const row = db
      .prepare("SELECT window_start, count FROM rate_limits WHERE bucket = ? AND key = ?")
      .get(c.bucket, c.key) as { window_start: number; count: number } | undefined;
    if (row && row.window_start === windowStart && row.count >= c.limit) {
      const retryAfter = windowStart + windowSeconds - nowSeconds;
      throw new ApiError(429, "rate_limited", `Too many requests (${c.bucket}); retry in ${retryAfter}s`, {
        "Retry-After": String(retryAfter),
      });
    }
  }
  for (const c of checks) hitRateLimit(db, c.bucket, c.key, Number.MAX_SAFE_INTEGER, windowSeconds, nowSeconds);
}

export function pruneRateLimits(db: Db, nowSeconds: number, maxWindowSeconds: number): void {
  db.prepare("DELETE FROM rate_limits WHERE window_start < ?").run(nowSeconds - maxWindowSeconds * 2);
}
