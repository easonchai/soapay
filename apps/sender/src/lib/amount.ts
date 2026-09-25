// USDC amounts as exact bigint base units. No floats anywhere: a salary typed as
// "1234.56" must become exactly 1_234_560_000n, and anything that cannot be
// represented exactly (7+ decimals, exponents, negatives) is rejected, never rounded.

export const USDC_DECIMALS = 6;
const SCALE = 10n ** BigInt(USDC_DECIMALS);

export class AmountError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AmountError";
  }
}

const PLAIN = /^(\d+)(?:\.(\d*))?$/;
const GROUPED = /^(\d{1,3}(?:,\d{3})+)(?:\.(\d*))?$/;
const LEADING_DOT = /^\.(\d+)$/;

/**
 * Parses a human USDC amount ("1500", "1,500.25", "0.5", "$1,500") into base units.
 * Commas are accepted only as correct thousands separators. Throws AmountError.
 */
export function parseUsdc(input: string): bigint {
  const raw = input.trim().replace(/^\$/, "").replace(/\s*USDC$/i, "").trim();
  if (raw === "") throw new AmountError("Enter an amount");
  if (raw.startsWith("-")) throw new AmountError("Amount can't be negative");

  let whole: string;
  let frac: string;
  const lead = LEADING_DOT.exec(raw);
  const grouped = GROUPED.exec(raw);
  const plain = PLAIN.exec(raw);
  if (lead) {
    whole = "0";
    frac = lead[1] ?? "";
  } else if (grouped) {
    whole = (grouped[1] ?? "").replaceAll(",", "");
    frac = grouped[2] ?? "";
  } else if (plain) {
    whole = plain[1] ?? "";
    frac = plain[2] ?? "";
  } else if (raw.includes(",")) {
    throw new AmountError("Use commas only as thousands separators, e.g. 1,500.25");
  } else {
    throw new AmountError("Use digits and an optional decimal point, e.g. 1500.25");
  }

  if (frac.length > USDC_DECIMALS) {
    throw new AmountError(`USDC has ${USDC_DECIMALS} decimals; ${frac.length} given`);
  }
  return BigInt(whole) * SCALE + BigInt(frac.padEnd(USDC_DECIMALS, "0") || "0");
}

export type ParseResult = { ok: true; value: bigint } | { ok: false; error: string };

export function tryParseUsdc(input: string): ParseResult {
  try {
    return { ok: true, value: parseUsdc(input) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Parses a positive amount (salaries and chunk sizes must be > 0). */
export function parsePositiveUsdc(input: string): bigint {
  const v = parseUsdc(input);
  if (v === 0n) throw new AmountError("Amount must be more than 0");
  return v;
}

/** 1_234_560_000n → "1,234.56". Always at least two decimals, never loses precision. */
export function formatUsdc(value: bigint): string {
  const neg = value < 0n;
  const abs = neg ? -value : value;
  const whole = (abs / SCALE).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  let frac = (abs % SCALE).toString().padStart(USDC_DECIMALS, "0").replace(/0+$/, "");
  if (frac.length < 2) frac = frac.padEnd(2, "0");
  return `${neg ? "-" : ""}${whole}.${frac}`;
}

/** Plain editable form without grouping: 1_234_560_000n → "1234.56". */
export function toInputUsdc(value: bigint): string {
  return formatUsdc(value).replaceAll(",", "");
}
