/**
 * stderr logger (stdout is the MCP channel). Every field passes through `redact`: addresses
 * shrink to their first and last 4 characters, and anything key-sized (32+ bytes of hex) or
 * mnemonic-like is dropped. Keys and mnemonics are never passed here in the first place.
 */
export type Logger = {
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
};

const ADDRESS = /0x[0-9a-fA-F]{40}(?![0-9a-fA-F])/g;
const LONG_HEX = /0x[0-9a-fA-F]{64,}/g;
const SECRET_FIELD = /key|mnemonic|seed|secret|signature|private/i;

export function redactAddress(a: string): string {
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

export function redactString(s: string): string {
  // A run of 12+ lowercase words looks like a mnemonic: drop it.
  if (/^([a-z]+ ){11,}[a-z]+$/.test(s.trim())) return "[redacted]";
  return s.replace(LONG_HEX, "[redacted]").replace(ADDRESS, (a) => redactAddress(a));
}

export function redact(value: unknown, depth = 0): unknown {
  if (depth > 6) return "[…]";
  if (typeof value === "string") return redactString(value);
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = SECRET_FIELD.test(k) ? "[redacted]" : redact(v, depth + 1);
    return out;
  }
  return value;
}

export function stderrLogger(write: (line: string) => void = (l) => process.stderr.write(l + "\n")): Logger {
  const emit = (level: string, msg: string, fields?: Record<string, unknown>) =>
    write(JSON.stringify({ t: new Date().toISOString(), level, msg: redactString(msg), ...(fields ? (redact(fields) as object) : {}) }));
  return {
    info: (m, f) => emit("info", m, f),
    warn: (m, f) => emit("warn", m, f),
    error: (m, f) => emit("error", m, f),
  };
}

export const silentLogger: Logger = { info() {}, warn() {}, error() {} };
