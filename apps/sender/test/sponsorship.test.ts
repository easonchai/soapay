import { afterEach, describe, expect, it, vi } from "vitest";
import { MOCK_USDC_BASE_SEPOLIA, configurePayToken } from "@soapay/sdk";
import type { Address } from "viem";
import { applyPayToken, resolveConfig } from "../src/config.js";
import { checkFunding } from "../src/hooks/usePayRun.js";
import {
  absoluteApiUrl,
  paymasterServiceUrl,
  requestWelcomeDrop,
  sendCallsCapabilities,
  walletSupportsPaymaster,
  welcomeDropEnabled,
  welcomeMessage,
} from "../src/lib/sponsorship.js";
import type { RunPlan } from "../src/lib/run.js";

const WALLET = "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd" as Address;
const settings = (chainId: 84532 | 8453) => ({ chainId, stealthDisperse: {}, rpcUrl: {}, ensRpcUrl: {} });

afterEach(() => configurePayToken(84532, undefined));

describe("pay token (D-52)", () => {
  it("Base Sepolia pays in the mock USDC; Base mainnet in Circle USDC", () => {
    expect(resolveConfig(settings(84532)).usdc).toBe(MOCK_USDC_BASE_SEPOLIA);
    expect(resolveConfig(settings(8453)).usdc).toBe("0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913");
  });

  it("VITE_PAY_TOKEN overrides the testnet token only", () => {
    const other = "0x1111111111111111111111111111111111111111";
    expect(applyPayToken({ VITE_PAY_TOKEN: other })).toBeNull();
    expect(resolveConfig(settings(84532)).usdc).toBe(other);
    expect(resolveConfig(settings(8453)).usdc).toBe("0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913");
    expect(applyPayToken({ VITE_PAY_TOKEN: "nope" })).toMatch(/not an address/);
    expect(applyPayToken({})).toBeNull();
    expect(resolveConfig(settings(84532)).usdc).toBe(MOCK_USDC_BASE_SEPOLIA);
  });
});

describe("smart-wallet gas sponsorship (EIP-5792 paymasterService)", () => {
  it("points the wallet at the API's /paymaster on Base Sepolia only, as an absolute URL", () => {
    expect(paymasterServiceUrl({ chainId: 84532, apiUrl: "/api" }, "https://soapay.up.railway.app")).toBe("https://soapay.up.railway.app/api/paymaster");
    expect(paymasterServiceUrl({ chainId: 84532, apiUrl: "http://localhost:8787/" }, "http://localhost:5174")).toBe("http://localhost:8787/paymaster");
    expect(paymasterServiceUrl({ chainId: 8453, apiUrl: "https://api.example" })).toBeNull();
    expect(paymasterServiceUrl({ chainId: 84532, apiUrl: undefined })).toBeNull();
    expect(absoluteApiUrl("/api", "not a url")).toBeNull();
  });

  it("the capability is optional, so a wallet without it still sends (and pays its own gas)", () => {
    expect(sendCallsCapabilities({ chainId: 84532, apiUrl: "https://api.example" })).toEqual({
      paymasterService: { url: "https://api.example/paymaster", optional: true },
    });
    expect(sendCallsCapabilities({ chainId: 8453, apiUrl: "https://api.example" })).toBeUndefined();
  });

  it("reads paymasterService support from either capabilities shape", () => {
    expect(walletSupportsPaymaster({ paymasterService: { supported: true }, atomic: { status: "supported" } }, 84532)).toBe(true);
    expect(walletSupportsPaymaster({ "0x14a34": { paymasterService: { supported: true } } }, 84532)).toBe(true);
    expect(walletSupportsPaymaster({ 84532: { paymasterService: { supported: false } } }, 84532)).toBe(false);
    expect(walletSupportsPaymaster(undefined, 84532)).toBe(false);
  });

  it("a sponsored batch run doesn't warn about the employer's ETH", () => {
    const plan = { total: 10_000_000n, estimate: { totalGas: 1_000_000n } } as unknown as RunPlan;
    const funding = { usdcBalance: 10_000_000n, allowance: null, ethBalance: 0n, gasPrice: 10n };
    expect(checkFunding(plan, funding).problems).toEqual(["ETH balance may not cover gas for every transaction"]);
    expect(checkFunding(plan, funding, { gasSponsored: true }).problems).toEqual([]);
  });
});

describe("welcome drop", () => {
  it("only on Base Sepolia with a real API", () => {
    expect(welcomeDropEnabled({ chainId: 84532, apiUrl: "/api", mockEns: false })).toBe(true);
    expect(welcomeDropEnabled({ chainId: 8453, apiUrl: "/api", mockEns: false })).toBe(false);
    expect(welcomeDropEnabled({ chainId: 84532, apiUrl: undefined, mockEns: false })).toBe(false);
    expect(welcomeDropEnabled({ chainId: 84532, apiUrl: "/api", mockEns: true })).toBe(false);
  });

  it("posts the address once and reads sent / already_claimed; failures are silent", async () => {
    const sent = { status: "sent", address: WALLET, usdc: { amount: "1000000000000", txHash: `0x${"1".repeat(64)}` }, eth: null };
    const f = vi.fn(async (_u: string | URL | Request, _i?: RequestInit) => Response.json(sent));
    const d = await requestWelcomeDrop("https://api.example/", WALLET, f as unknown as typeof fetch);
    expect(d).toEqual(sent);
    expect(f.mock.calls[0]![0]).toBe("https://api.example/faucet");
    expect(JSON.parse(String(f.mock.calls[0]![1]!.body))).toEqual({ address: WALLET });
    expect(welcomeMessage(d as never)).toBe("Welcome: 1,000,000 test USDC sent to your wallet");

    const claimed = vi.fn(async () => Response.json({ status: "already_claimed", address: WALLET }));
    expect(await requestWelcomeDrop("https://api.example", WALLET, claimed as unknown as typeof fetch)).toEqual({ status: "already_claimed", address: WALLET });
    const capped = vi.fn(async () => Response.json({ error: { code: "faucet_failed" } }, { status: 502 }));
    expect(await requestWelcomeDrop("https://api.example", WALLET, capped as unknown as typeof fetch)).toBeNull();
    const down = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    expect(await requestWelcomeDrop("https://api.example", WALLET, down as unknown as typeof fetch)).toBeNull();
  });
});
