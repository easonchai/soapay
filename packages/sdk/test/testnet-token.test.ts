import { afterEach, describe, expect, it } from "vitest";
import {
  CHAINS,
  CIRCLE_USDC,
  EXIT_TESTNET_DISABLED_MESSAGE,
  MOCK_USDC_BASE_SEPOLIA,
  circleUsdcFor,
  configurePayToken,
  defaultPaymasterMode,
  exitAvailability,
  getChainConfig,
  getSpendChainConfig,
  isCircleUsdcPayToken,
  payTokenFor,
  resolveAsset,
  setPayTokenOverride,
} from "../src/index.js";

// D-52: on Base Sepolia the pay token is our mock USDC and spends are sponsored; Base mainnet is unchanged.
const BASE = 8453;
const BASE_SEPOLIA = 84532;
const SEPOLIA = 11155111;

afterEach(() => configurePayToken(BASE_SEPOLIA, undefined));

describe("pay token per chain", () => {
  it("Base mainnet keeps Circle USDC and the Circle paymaster", () => {
    expect(CHAINS[BASE].usdc).toBe("0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913");
    expect(payTokenFor(BASE)).toBe(CIRCLE_USDC[BASE]);
    expect(defaultPaymasterMode(BASE)).toBe("circle-usdc");
    expect(isCircleUsdcPayToken(BASE)).toBe(true);
  });

  it("Base Sepolia pays in the mock token with sponsored gas", () => {
    expect(payTokenFor(BASE_SEPOLIA)).toBe(MOCK_USDC_BASE_SEPOLIA);
    expect(getSpendChainConfig(BASE_SEPOLIA).usdc).toBe(MOCK_USDC_BASE_SEPOLIA);
    expect(defaultPaymasterMode(BASE_SEPOLIA)).toBe("sponsored");
    expect(isCircleUsdcPayToken(BASE_SEPOLIA)).toBe(false);
    // Circle's token is still known (Circle paymaster, CCTP).
    expect(circleUsdcFor(BASE_SEPOLIA)).toBe("0x036CbD53842c5426634e7929541eC2318f3dCF7e");
  });

  it("exit destinations keep Circle USDC and the Circle paymaster", () => {
    expect(getSpendChainConfig(SEPOLIA).usdc).toBe(CIRCLE_USDC[SEPOLIA]);
    expect(defaultPaymasterMode(SEPOLIA)).toBe("circle-usdc");
  });

  it("the testnet pay token is overridable (VITE_PAY_TOKEN / PAY_TOKEN) and clears back to the mock", () => {
    const other = "0x1111111111111111111111111111111111111111";
    configurePayToken(BASE_SEPOLIA, other);
    expect(getChainConfig(BASE_SEPOLIA).usdc).toBe(other);
    expect(getSpendChainConfig(BASE_SEPOLIA).usdc).toBe(other);
    expect(resolveAsset(BASE_SEPOLIA, "USDC")).toMatchObject({ kind: "erc20", address: other });
    configurePayToken(BASE_SEPOLIA, "");
    expect(getChainConfig(BASE_SEPOLIA).usdc).toBe(MOCK_USDC_BASE_SEPOLIA);
    expect(resolveAsset(BASE_SEPOLIA, "USDC")).toMatchObject({ address: MOCK_USDC_BASE_SEPOLIA });
  });

  it("mainnet's pay token cannot be overridden, and junk is rejected", () => {
    expect(() => setPayTokenOverride(BASE, "0x1111111111111111111111111111111111111111")).toThrow(/cannot be overridden/);
    expect(() => setPayTokenOverride(BASE_SEPOLIA, "usdc")).toThrow(/not an address/);
    expect(payTokenFor(BASE)).toBe(CIRCLE_USDC[BASE]);
  });

  it("the default registry asset USDC on Base Sepolia is the mock", () => {
    expect(resolveAsset(BASE_SEPOLIA, "usdc")).toMatchObject({ kind: "erc20", address: MOCK_USDC_BASE_SEPOLIA, decimals: 6 });
  });
});

describe("exit availability", () => {
  it("is off on Base Sepolia with the mock token, with the owner's message", () => {
    expect(exitAvailability(BASE_SEPOLIA)).toEqual({ available: false, reason: EXIT_TESTNET_DISABLED_MESSAGE });
    expect(EXIT_TESTNET_DISABLED_MESSAGE).toBe("The compliant exit needs real Circle USDC; it's off on this testnet demo.");
  });

  it("comes back when the pay token is Circle USDC again", () => {
    configurePayToken(BASE_SEPOLIA, CIRCLE_USDC[BASE_SEPOLIA]);
    expect(exitAvailability(BASE_SEPOLIA, SEPOLIA)).toEqual({ available: true });
  });

  it("has no route from other chains", () => {
    expect(exitAvailability(BASE).available).toBe(false);
  });
});
