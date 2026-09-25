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

  it("quotes through the API proxy (no key in the request) when one is configured", async () => {
    const calls: { url: string; headers: Record<string, string> }[] = [];
    const s = createSdkSwapService({
      chainId: CHAIN,
      bundlerUrl: "http://bundler",
      publicClient: {} as never,
      proxyUrl: "https://api.soapay.test/uniswap/",
      fetch: async (url, init) => {
        calls.push({ url, headers: init.headers });
        return { ok: false, status: 503, json: async () => ({}), text: async () => "proxy down" };
      },
    });
    expect(s.route).toMatch(/Trading API/);
    await expect(s.quote({ stealthKey: generatePrivateKey(), tokenOut: NATIVE_ETH, amountIn: 1_000_000n, slippageBps: 50 })).rejects.toThrow();
    expect(calls[0]?.url).toBe("https://api.soapay.test/uniswap/quote");
    expect(calls[0]?.headers["x-api-key"]).toBeUndefined();
  });

  it("falls back to the Universal Router without a proxy", () => {
    const s = createSdkSwapService({ chainId: CHAIN, bundlerUrl: "http://bundler", publicClient: {} as never, proxyUrl: "" });
    expect(s.route).toMatch(/Universal Router/);
  });
});
