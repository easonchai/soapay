import { describe, expect, it } from "vitest";
import { formatUsdc, parseUsdc, tryParseUsdc, toInputUsdc } from "../src/lib/amount.js";

describe("parseUsdc: exact bigint parsing, no floats", () => {
  it.each([
    ["0", 0n],
    ["1", 1_000_000n],
    ["1500", 1_500_000_000n],
    ["1500.25", 1_500_250_000n],
    ["1,500.25", 1_500_250_000n],
    ["1,234,567.891011", 1_234_567_891_011n],
    [".5", 500_000n],
    ["0.000001", 1n],
    ["1.", 1_000_000n],
    ["  42.10  ", 42_100_000n],
    ["$3,000", 3_000_000_000n],
    ["250 USDC", 250_000_000n],
    // A float would lose these; bigint parsing must not.
    ["0.1", 100_000n],
    ["9007199254740993.000001", 9_007_199_254_740_993_000_001n],
  ])("%s → %s", (input, expected) => {
    expect(parseUsdc(input)).toBe(expected);
  });

  it.each([
    ["", /Enter an amount/],
    ["-5", /negative/],
    ["1.0000001", /6 decimals/],
    ["1e6", /digits/],
    ["12,34", /thousands separators/],
    ["1,5000", /thousands separators/],
    ["abc", /digits/],
    ["1.2.3", /digits/],
    ["NaN", /digits/],
    ["Infinity", /digits/],
  ])("rejects %j", (input, msg) => {
    const r = tryParseUsdc(input);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(msg);
  });
});

describe("formatUsdc", () => {
  it.each([
    [0n, "0.00"],
    [1n, "0.000001"],
    [1_500_250_000n, "1,500.25"],
    [1_234_567_891_011n, "1,234,567.891011"],
    [-5_000_000n, "-5.00"],
  ])("%s → %s", (v, s) => expect(formatUsdc(v)).toBe(s));

  it("round-trips with parseUsdc", () => {
    for (const v of [0n, 1n, 10n, 999_999n, 1_000_000n, 123_456_789_012n]) {
      expect(parseUsdc(formatUsdc(v))).toBe(v);
      expect(parseUsdc(toInputUsdc(v))).toBe(v);
    }
  });
});
