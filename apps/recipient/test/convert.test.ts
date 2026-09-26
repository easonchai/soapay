import { describe, expect, it } from "vitest";
import { MAX_SLIPPAGE_BPS, NATIVE_ETH, WETH_BASE, getChainConfig, type SwapQuote } from "@soapay/sdk";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { checkQuote, createSdkSwapService, validateConvert } from "../src/features/convert/swap.js";
import { createMockSwapService } from "../src/services/mock.js";

const CHAIN = 84532;
const usdc = getChainConfig(CHAIN).usdc;
const base = { amountIn: 100_000_000n, balance: 500_000_000n, slippageBps: 50, tokenOut: NATIVE_ETH, chainId: CHAIN };

describe("validateConvert", () => {
  it("accepts a sane request", () => {
    expect(validateConvert(base)).toBeNull();
    expect(validateConvert({ ...base, tokenOut: WETH_BASE })).toBeNull();
  });
  it.each([
    [{ amountIn: null }, /above zero/],
    [{ amountIn: 0n }, /above zero/],
    [{ amountIn: 500_000_000n }, /network fee/],
    [{ slippageBps: 0 }, /positive/],
    [{ slippageBps: 12.5 }, /positive/],
    [{ slippageBps: MAX_SLIPPAGE_BPS + 1 }, /exceed/],
    [{ tokenOut: "nope" }, /Pick an asset/],
    [{ tokenOut: usdc }, /already USDC/],
  ])("rejects %o", (patch, msg) => {
    expect(validateConvert({ ...base, ...patch })).toMatch(msg);
  });
});

describe("checkQuote", () => {
  const key = generatePrivateKey();
  const addr = privateKeyToAccount(key).address;
  const good: SwapQuote = {
    source: "trading-api",
    chainId: CHAIN,
    stealthAddress: addr,
    tokenIn: usdc,
    tokenOut: NATIVE_ETH,
    amountIn: 100n,
    amountOut: 1_000n,
    minOut: 995n,
    slippageBps: 50,
    route: "x",
    router: "0x0000000000000000000000000000000000000001",
    deadline: 1n,
    calls: [],
  };
  const req = { stealthAddress: addr, amountIn: 100n, tokenOut: NATIVE_ETH, slippageBps: 50 };
  it("passes a matching quote", () => expect(checkQuote(good, req)).toBeNull());
  it("rejects mismatches", () => {
    expect(checkQuote({ ...good, stealthAddress: "0x0000000000000000000000000000000000000009" }, req)).toMatch(/different address/);
    expect(checkQuote({ ...good, amountIn: 101n }, req)).toMatch(/different amount/);
    expect(checkQuote({ ...good, tokenOut: WETH_BASE }, req)).toMatch(/different asset/);
    expect(checkQuote({ ...good, slippageBps: 100 }, req)).toMatch(/slippage/);
    expect(checkQuote({ ...good, minOut: 2_000n }, req)).toMatch(/output/);
  });

  it("the mock swap service returns quotes that pass the check", async () => {
    const q = await createMockSwapService(CHAIN).quote({ stealthKey: key, tokenOut: NATIVE_ETH, amountIn: 3_000_000_000n, slippageBps: 50 });
    expect(q.amountOut).toBe(10n ** 18n);
    expect(checkQuote(q, { ...req, amountIn: 3_000_000_000n })).toBeNull();
  });
});

describe("createSdkSwapService", () => {
  it("is unavailable without a bundler", () => {
    const s = createSdkSwapService({ chainId: CHAIN, bundlerUrl: "", publicClient: {} as never, proxyUrl: "" });
    expect(s.ready).toBe(false);
  });

  it("on Base mainnet, quotes through the API proxy (no key, no stealth address in the request)", async () => {
    const calls: { url: string; headers: Record<string, string>; body: string }[] = [];
    const s = createSdkSwapService({
      chainId: 8453,
      bundlerUrl: "http://bundler",
      publicClient: {} as never,
      proxyUrl: "https://api.soapay.test/uniswap/",
      fetch: async (url, init) => {
        calls.push({ url, headers: init.headers, body: init.body });
        return { ok: false, status: 503, json: async () => ({}), text: async () => "proxy down" };
      },
    });
    expect(s.route).toMatch(/Trading API/);
    const stealthKey = generatePrivateKey();
    await expect(s.quote({ stealthKey, tokenOut: NATIVE_ETH, amountIn: 1_000_000n, slippageBps: 50 })).rejects.toThrow();
    expect(calls[0]?.url).toBe("https://api.soapay.test/uniswap/quote");
    expect(calls[0]?.headers["x-api-key"]).toBeUndefined();
    expect(calls[0]?.body.toLowerCase()).not.toContain(privateKeyToAccount(stealthKey).address.slice(2).toLowerCase());
  });

  it("on Base Sepolia, never calls the proxy: the quote is on-chain", async () => {
    const calls: string[] = [];
    const s = createSdkSwapService({
      chainId: CHAIN,
      bundlerUrl: "http://bundler",
      publicClient: {} as never,
      proxyUrl: "https://api.soapay.test/uniswap",
      fetch: async (url) => {
        calls.push(url);
        return { ok: false, status: 500, json: async () => ({}), text: async () => "" };
      },
    });
    expect(s.route).toMatch(/on-chain/);
    await expect(s.quote({ stealthKey: generatePrivateKey(), tokenOut: NATIVE_ETH, amountIn: 1_000_000n, slippageBps: 50 })).rejects.toThrow();
    expect(calls).toEqual([]);
  });

  it("falls back to the Universal Router without a proxy", () => {
    const s = createSdkSwapService({ chainId: CHAIN, bundlerUrl: "http://bundler", publicClient: {} as never, proxyUrl: "" });
    expect(s.route).toMatch(/Universal Router/);
  });
});
