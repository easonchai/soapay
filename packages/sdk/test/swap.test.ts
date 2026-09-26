import { describe, expect, it } from "vitest";
import {
  createPublicClient,
  custom,
  decodeAbiParameters,
  decodeFunctionData,
  encodeAbiParameters,
  encodeFunctionData,
  encodeFunctionResult,
  encodePacked,
  erc20Abi,
  getAddress,
  parseAbiParameters,
  type Address,
  type Hex,
} from "viem";
import { base } from "viem/chains";
import { CHAINS } from "../src/constants.js";
import {
  MAX_SLIPPAGE_BPS,
  NATIVE_ETH,
  PERMIT2_ADDRESS,
  SwapError,
  SwapPrivacyError,
  SwapRecipientError,
  SwapProxyDisabledError,
  SwapRouteUnsupportedError,
  SwapUpstreamError,
  UNIVERSAL_ROUTER,
  UR_ADDRESS_THIS,
  UR_MSG_SENDER,
  UrCommand,
  V4Action,
  WETH_BASE,
  assertNoStealthAddress,
  assertSwapStaysInPlace,
  defaultSwapSource,
  encodeV3ExactInSwap,
  minOutFor,
  permit2Abi,
  quoteSwapInPlace,
  randomPlaceholderSwapper,
  universalRouterAbi,
  type SwapFetch,
} from "../src/swap.js";

const CHAIN_ID = base.id;
const USDC = CHAINS[CHAIN_ID].usdc;
const ROUTER = UNIVERSAL_ROUTER[CHAIN_ID];
const STEALTH = getAddress("0x00000000000000000000000000000000000057ea");
const MALLORY = getAddress("0x000000000000000000000000000000000000bad0");
const DEADLINE = 2_000_000_000n;

const v3In = parseAbiParameters("address, uint256, uint256, bytes, bool, uint256[]");
const tra = parseAbiParameters("address, address, uint256");
const ra = parseAbiParameters("address, uint256");

function execute(commands: number[], inputs: Hex[]): Hex {
  return encodeFunctionData({
    abi: universalRouterAbi,
    functionName: "execute",
    args: [encodePacked(commands.map(() => "uint8" as const), commands), inputs, DEADLINE],
  });
}
const v3Swap = (recipient: Address, out: Address = WETH_BASE) =>
  encodeAbiParameters(v3In, [recipient, 1_000_000n, 1n, encodePacked(["address", "uint24", "address"], [USDC, 500, out]), true, []]);
const v4Swap = (actions: number[], params: Hex[]) =>
  encodeAbiParameters(parseAbiParameters("bytes, bytes[]"), [encodePacked(actions.map(() => "uint8" as const), actions), params]);
const check = (data: Hex, to: Address = ROUTER) => assertSwapStaysInPlace({ chainId: CHAIN_ID, stealthAddress: STEALTH, tx: { to, data } });

describe("encodeV3ExactInSwap", () => {
  it("ERC-20 out: one V3_SWAP_EXACT_IN (UR 2.1.x layout) paying the stealth address with the floor", () => {
    const data = encodeV3ExactInSwap({ tokenIn: USDC, tokenOut: WETH_BASE, weth: WETH_BASE, feeTier: 500, amountIn: 5n, minOut: 4n, recipient: STEALTH, deadline: DEADLINE });
    const { args } = decodeFunctionData({ abi: universalRouterAbi, data });
    expect(args![0]).toBe("0x00");
    const [recipient, amountIn, minOut, path, payerIsUser, minHop] = decodeAbiParameters(v3In, (args![1] as Hex[])[0]!);
    expect([recipient, amountIn, minOut, payerIsUser, minHop]).toEqual([STEALTH, 5n, 4n, true, []]);
    expect(path.toLowerCase()).toBe(`${USDC.toLowerCase()}0001f4${WETH_BASE.slice(2).toLowerCase()}`);
    expect(args![2]).toBe(DEADLINE);
    expect(check(data).recipients).toEqual([STEALTH]);
  });

  it("native ETH out: swap to the router, then UNWRAP_WETH to the stealth address with the floor", () => {
    const data = encodeV3ExactInSwap({ tokenIn: USDC, tokenOut: NATIVE_ETH, weth: WETH_BASE, feeTier: 500, amountIn: 5n, minOut: 4n, recipient: STEALTH, deadline: DEADLINE });
    const { args } = decodeFunctionData({ abi: universalRouterAbi, data });
    expect(args![0]).toBe("0x000c");
    const inputs = args![1] as Hex[];
    expect(decodeAbiParameters(v3In, inputs[0]!)[0]).toBe(UR_ADDRESS_THIS);
    expect(decodeAbiParameters(ra, inputs[1]!)).toEqual([STEALTH, 4n]);
    expect(check(data).recipients).toEqual([UR_ADDRESS_THIS, STEALTH]);
  });
});

describe("assertSwapStaysInPlace", () => {
  it("accepts the stealth address, MSG_SENDER, and router-held hops that are swept back", () => {
    expect(() => check(execute([UrCommand.V3_SWAP_EXACT_IN], [v3Swap(UR_MSG_SENDER)]))).not.toThrow();
    expect(() =>
      check(execute([UrCommand.V3_SWAP_EXACT_IN, UrCommand.SWEEP], [v3Swap(UR_ADDRESS_THIS), encodeAbiParameters(tra, [WETH_BASE, STEALTH, 1n])])),
    ).not.toThrow();
    const v4 = v4Swap([V4Action.SWAP_EXACT_IN_SINGLE, V4Action.SETTLE_ALL, V4Action.TAKE_ALL], ["0x", "0x", "0x"]);
    expect(() => check(execute([UrCommand.V4_SWAP], [v4]))).not.toThrow();
  });

  it("rejects any output to another address", () => {
    expect(() => check(execute([UrCommand.V3_SWAP_EXACT_IN], [v3Swap(MALLORY)]))).toThrow(SwapRecipientError);
    expect(() =>
      check(execute([UrCommand.V3_SWAP_EXACT_IN, UrCommand.SWEEP], [v3Swap(UR_ADDRESS_THIS), encodeAbiParameters(tra, [WETH_BASE, MALLORY, 1n])])),
    ).toThrow(SwapRecipientError);
    expect(() =>
      check(execute([UrCommand.V3_SWAP_EXACT_IN, UrCommand.UNWRAP_WETH], [v3Swap(UR_ADDRESS_THIS), encodeAbiParameters(ra, [MALLORY, 1n])])),
    ).toThrow(SwapRecipientError);
    const take = v4Swap([V4Action.SWAP_EXACT_IN_SINGLE, V4Action.SETTLE_ALL, V4Action.TAKE], ["0x", "0x", encodeAbiParameters(tra, [WETH_BASE, MALLORY, 0n])]);
    expect(() => check(execute([UrCommand.V4_SWAP], [take]))).toThrow(SwapRecipientError);
  });

  it("rejects fee portions, transfers, Permit2 commands, unknown v4 actions and allow-revert flags", () => {
    const portion = encodeAbiParameters(tra, [WETH_BASE, MALLORY, 25n]);
    expect(() => check(execute([UrCommand.V3_SWAP_EXACT_IN, UrCommand.PAY_PORTION], [v3Swap(STEALTH), portion]))).toThrow(/not allowed/);
    expect(() => check(execute([UrCommand.V3_SWAP_EXACT_IN, UrCommand.TRANSFER], [v3Swap(STEALTH), portion]))).toThrow(/not allowed/);
    expect(() => check(execute([UrCommand.PERMIT2_PERMIT, UrCommand.V3_SWAP_EXACT_IN], ["0x", v3Swap(STEALTH)]))).toThrow(/not allowed/);
    expect(() => check(execute([UrCommand.V4_SWAP], [v4Swap([0x02], ["0x"])]))).toThrow(/v4 action/);
    expect(() => check(execute([UrCommand.V3_SWAP_EXACT_IN | 0x80], [v3Swap(STEALTH)]))).toThrow(/allow-revert/);
  });

  it("rejects output stranded in the router, unknown routers and ETH value", () => {
    expect(() => check(execute([UrCommand.V3_SWAP_EXACT_IN], [v3Swap(UR_ADDRESS_THIS)]))).toThrow(/left in the router/);
    expect(() => check(execute([UrCommand.V3_SWAP_EXACT_IN], [v3Swap(STEALTH)]), MALLORY)).toThrow(/not a known Universal Router/);
    expect(() =>
      assertSwapStaysInPlace({ chainId: CHAIN_ID, stealthAddress: STEALTH, tx: { to: ROUTER, data: execute([0x00], [v3Swap(STEALTH)]), value: 1n } }),
    ).toThrow(/ETH value/);
    expect(() => check("0xdeadbeef")).toThrow(/not UniversalRouter.execute/);
  });
});

// ---------------------------------------------------------------------------------------------
// Trading API path (mocked HTTP). D-27: the stealth address never reaches the quote service.
// ---------------------------------------------------------------------------------------------

const AMOUNT_OUT = 7_000_000_000_000_000n;
const WETH_BEFORE = 123n;

function chainClient() {
  return createPublicClient({
    chain: base,
    transport: custom({
      async request({ method, params }: { method: string; params?: unknown }) {
        if (method === "eth_chainId") return "0x2105";
        if (method === "eth_call") {
          const { to, data } = (params as [{ to: Address; data: Hex }])[0];
          const { functionName } = decodeFunctionData({ abi: erc20Abi, data });
          if (functionName === "balanceOf" && getAddress(to) === getAddress(WETH_BASE))
            return encodeFunctionResult({ abi: erc20Abi, functionName: "balanceOf", result: WETH_BEFORE });
        }
        throw new Error(`unexpected ${method}`);
      },
    }),
  });
}

const PLACEHOLDER = getAddress("0x00000000000000000000000000000000000f1a7e");
const v2In = parseAbiParameters("address, uint256, uint256, address[], bool, uint256[]");
const DAI = getAddress("0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb");
const tok = (address: Address) => ({ address, chainId: CHAIN_ID, symbol: "T", decimals: "18" });
const pool = (type: string, tokenIn: Address, tokenOut: Address, fee: string | undefined, amountIn?: bigint, amountOut?: bigint) => ({
  type,
  address: MALLORY, // ignored: the router derives pool addresses itself
  tokenIn: tok(tokenIn),
  tokenOut: tok(tokenOut),
  ...(fee !== undefined ? { fee } : {}),
  ...(amountIn !== undefined ? { amountIn: amountIn.toString() } : {}),
  ...(amountOut !== undefined ? { amountOut: amountOut.toString() } : {}),
});
const ONE_V3_SPLIT = [[pool("v3-pool", USDC, WETH_BASE, "100", 20_000_000n, AMOUNT_OUT)]];

function mockApi(over: { quote?: Record<string, unknown>; top?: Record<string, unknown> } = {}) {
  const requests: { url: string; headers: Record<string, string>; body: Record<string, unknown>; raw: string }[] = [];
  const fetch: SwapFetch = async (url, init) => {
    const body = JSON.parse(init.body) as Record<string, unknown>;
    requests.push({ url, headers: init.headers, body, raw: init.body });
    if (!url.endsWith("/quote")) throw new Error(`the SDK must only call /quote, got ${url}`);
    const json = {
      requestId: "r1",
      routing: "CLASSIC",
      permitData: null,
      permitTransaction: { to: PERMIT2_ADDRESS, from: body.swapper, data: "0x", value: "0", chainId: CHAIN_ID },
      quote: {
        chainId: CHAIN_ID,
        swapper: body.swapper,
        input: { token: USDC, amount: String(body.amount) },
        output: { token: String(body.tokenOut), amount: AMOUNT_OUT.toString(), recipient: body.swapper },
        aggregatedOutputs: [{ token: String(body.tokenOut), amount: AMOUNT_OUT.toString(), recipient: body.swapper, bps: 10000 }],
        route: ONE_V3_SPLIT,
        slippage: 0.5,
        routeString: "[V3] 100.00% = USDC -- 0.01% [0xb4CB...] --> WETH",
        ...over.quote,
      },
      ...over.top,
    };
    return { ok: true, status: 200, json: async () => json, text: async () => JSON.stringify(json) };
  };
  return { fetch, requests };
}

const apiParams = (fetch: SwapFetch) => ({
  chainId: CHAIN_ID,
  stealthAddress: STEALTH,
  tokenOut: WETH_BASE,
  amountIn: 20_000_000n,
  slippageBps: 50,
  apiKey: "test-key",
  fetch,
  publicClient: chainClient() as never,
  placeholderSwapper: () => PLACEHOLDER,
  now: () => 1_900_000_000,
});

const decodeSwap = (data: Hex) => {
  const { args } = decodeFunctionData({ abi: universalRouterAbi, data });
  return { commands: args![0] as Hex, inputs: args![1] as Hex[] };
};

describe("quoteSwapInPlace via the Trading API (placeholder swapper, route re-encoded locally)", () => {
  it("quotes with the placeholder swapper, never calls /swap, and builds the swap to the stealth address", async () => {
    const { fetch, requests } = mockApi();
    const q = await quoteSwapInPlace(apiParams(fetch));
    expect(q.source).toBe("trading-api");
    expect(requests.map((r) => r.url)).toEqual(["https://trade-api.gateway.uniswap.org/v1/quote"]);
    expect(requests[0]!.headers["x-api-key"]).toBe("test-key");
    expect(requests[0]!.headers["x-universal-router-version"]).toBe("2.1.2");
    expect(JSON.parse(requests[0]!.headers["x-agent-info"]!)).toMatchObject({ decision_origin: "human_mediated" });
    expect(requests[0]!.body).toMatchObject({
      type: "EXACT_INPUT",
      amount: "20000000",
      swapper: PLACEHOLDER,
      slippageTolerance: 0.5,
      protocols: ["V2", "V3"],
      generatePermitAsTransaction: true,
      permitAmount: "EXACT",
    });
    expect(requests[0]!.body).not.toHaveProperty("recipient");
    expect(requests[0]!.raw.toLowerCase()).not.toContain(STEALTH.slice(2).toLowerCase());
    expect(q.amountOut).toBe(AMOUNT_OUT);
    expect(q.minOut).toBe(minOutFor(AMOUNT_OUT, 50));

    // [USDC.approve(Permit2, exact), Permit2.approve(UR, exact, deadline), swap, balance guard]
    expect(q.calls.map((c) => getAddress(c.to))).toEqual([getAddress(USDC), PERMIT2_ADDRESS, ROUTER, ROUTER]);
    expect(decodeFunctionData({ abi: erc20Abi, data: q.calls[0]!.data! }).args).toEqual([PERMIT2_ADDRESS, 20_000_000n]);
    expect(decodeFunctionData({ abi: permit2Abi, data: q.calls[1]!.data! }).args).toEqual([getAddress(USDC), ROUTER, 20_000_000n, 1_900_000_000 + 1800]);
    const swap = decodeSwap(q.calls[2]!.data!);
    expect(swap.commands).toBe("0x00");
    const [recipient, amountIn, minOut, path, payerIsUser] = decodeAbiParameters(v3In, swap.inputs[0]!);
    expect([recipient, amountIn, minOut, payerIsUser]).toEqual([STEALTH, 20_000_000n, q.minOut, true]);
    expect(path.toLowerCase()).toBe(`${USDC.toLowerCase()}000064${WETH_BASE.slice(2).toLowerCase()}`);
    const guard = decodeFunctionData({ abi: universalRouterAbi, data: q.calls[3]!.data! });
    expect(guard.args![0]).toBe("0x0e");
    expect(decodeAbiParameters(tra, (guard.args![1] as Hex[])[0]!)).toEqual([STEALTH, WETH_BASE, WETH_BEFORE + q.minOut]);
    expect(q.calls.every((c) => (c.value ?? 0n) === 0n)).toBe(true);
  });

  it("uses a fresh random placeholder swapper for every quote, never the stealth address", async () => {
    const { fetch, requests } = mockApi();
    const { placeholderSwapper: _unused, ...params } = apiParams(fetch);
    await quoteSwapInPlace(params);
    await quoteSwapInPlace(params);
    const swappers = requests.map((r) => getAddress(String(r.body.swapper)));
    expect(new Set(swappers).size).toBe(2);
    for (const s of swappers) expect(s).not.toBe(STEALTH);
    expect(randomPlaceholderSwapper()).not.toBe(randomPlaceholderSwapper());
  });

  it("the privacy guard: a request that would carry the stealth address is refused before any fetch", async () => {
    const lower = STEALTH.toLowerCase();
    expect(() => assertNoStealthAddress(STEALTH, `{"swapper":"${lower}"}`)).toThrow(SwapPrivacyError);
    expect(() => assertNoStealthAddress(STEALTH, `{"x":"${STEALTH.slice(2).toUpperCase()}"}`)).toThrow(SwapPrivacyError);
    expect(() => assertNoStealthAddress(STEALTH, `https://api/q?to=${lower}`)).toThrow(SwapPrivacyError);
    expect(() => assertNoStealthAddress(STEALTH, `{"swapper":"${PLACEHOLDER}"}`)).not.toThrow();

    const { fetch, requests } = mockApi();
    // A placeholder that equals the stealth address.
    await expect(quoteSwapInPlace({ ...apiParams(fetch), placeholderSwapper: () => STEALTH })).rejects.toBeInstanceOf(SwapPrivacyError);
    // The stealth address smuggled into the body another way (here as the output token).
    await expect(quoteSwapInPlace({ ...apiParams(fetch), tokenOut: STEALTH })).rejects.toBeInstanceOf(SwapPrivacyError);
    // ...and a proxy URL that names it. The guard is never swallowed by the fallback.
    const { apiKey: _k, ...noKey } = apiParams(fetch);
    await expect(quoteSwapInPlace({ ...noKey, apiUrl: `https://api.soapay.test/${lower}` })).rejects.toBeInstanceOf(SwapPrivacyError);
    expect(requests).toHaveLength(0);
  });

  it("ignores where the quote says output goes: the calldata always pays the stealth address", async () => {
    const { fetch } = mockApi({ quote: { output: { token: WETH_BASE, amount: AMOUNT_OUT.toString(), recipient: MALLORY } } });
    const q = await quoteSwapInPlace(apiParams(fetch));
    expect(assertSwapStaysInPlace({ chainId: CHAIN_ID, stealthAddress: STEALTH, tx: { to: q.calls[2]!.to, data: q.calls[2]!.data! } }).recipients).toEqual([STEALTH]);
  });

  it("re-encodes split, multi-hop V3 and V2 routes, and native ETH out via UNWRAP_WETH", async () => {
    const route = [
      [pool("v3-pool", USDC, DAI, "100", 12_000_000n), pool("v3-pool", DAI, WETH_BASE, "3000", undefined, 4_000n)],
      [pool("v2-pool", USDC, WETH_BASE, undefined, 8_000_000n, 3_000n)],
    ];
    const { fetch } = mockApi({ quote: { route, output: { token: NATIVE_ETH, amount: "7000" } } });
    const q = await quoteSwapInPlace({ ...apiParams(fetch), tokenOut: NATIVE_ETH });
    expect(q.calls).toHaveLength(3); // no ERC-20 balance guard for native out
    const swap = decodeSwap(q.calls[2]!.data!);
    expect(swap.commands).toBe("0x00080c");
    const v3 = decodeAbiParameters(v3In, swap.inputs[0]!);
    expect([v3[0], v3[1], v3[2]]).toEqual([UR_ADDRESS_THIS, 12_000_000n, minOutFor(4_000n, 50)]);
    expect(v3[3].toLowerCase()).toBe(`${USDC.toLowerCase()}000064${DAI.slice(2).toLowerCase()}000bb8${WETH_BASE.slice(2).toLowerCase()}`);
    const v2 = decodeAbiParameters(v2In, swap.inputs[1]!);
    expect([v2[0], v2[1], v2[2], v2[3]]).toEqual([UR_ADDRESS_THIS, 8_000_000n, minOutFor(3_000n, 50), [getAddress(USDC), WETH_BASE]]);
    expect(decodeAbiParameters(ra, swap.inputs[2]!)).toEqual([STEALTH, minOutFor(7_000n, 50)]);
  });

  it("a route it can't rebuild exactly falls back to the on-chain path, or throws when the source is forced", async () => {
    const bad = [
      [[pool("v4-pool", USDC, WETH_BASE, "500", 20_000_000n, 1n)]],
      [[pool("v3-pool", USDC, WETH_BASE, "500", 19_000_000n, 1n)]], // doesn't add up
      [[pool("v3-pool", USDC, DAI, "500", 20_000_000n), pool("v2-pool", DAI, WETH_BASE, undefined, undefined, 1n)]], // mixed
      [[pool("v3-pool", DAI, WETH_BASE, "500", 20_000_000n, 1n)]], // wrong start
      [],
    ];
    for (const route of bad) {
      const { fetch } = mockApi({ quote: { route } });
      await expect(quoteSwapInPlace({ ...apiParams(fetch), source: "trading-api" })).rejects.toBeInstanceOf(SwapRouteUnsupportedError);
      // Default source: falls through to QuoterV2, which this mock chain doesn't have.
      const err = await quoteSwapInPlace(apiParams(fetch)).catch((e: unknown) => e);
      expect(err).not.toBeInstanceOf(SwapRouteUnsupportedError);
    }
  });

  it("defaults to the on-chain path on Base Sepolia, where the Trading API doesn't route", async () => {
    expect(defaultSwapSource({ chainId: 84532, apiUrl: "https://api.soapay.test/uniswap" })).toBe("universal-router");
    expect(defaultSwapSource({ chainId: CHAIN_ID, apiUrl: "https://api.soapay.test/uniswap" })).toBe("trading-api");
    expect(defaultSwapSource({ chainId: CHAIN_ID })).toBe("universal-router");
    const { fetch, requests } = mockApi();
    const { publicClient: _p, ...noClient } = apiParams(fetch);
    await quoteSwapInPlace({ ...noClient, chainId: 84532 }).catch(() => undefined);
    expect(requests).toHaveLength(0);
  });

  it("rejects UniswapX routing, Permit2 signature requests and a different input amount", async () => {
    await expect(quoteSwapInPlace(apiParams(mockApi({ top: { routing: "DUTCH_V2" } }).fetch))).rejects.toThrow(/routing/);
    await expect(quoteSwapInPlace(apiParams(mockApi({ top: { permitData: { domain: {}, values: {}, types: {} } } }).fetch))).rejects.toThrow(/Permit2 signature/);
    await expect(quoteSwapInPlace(apiParams(mockApi({ quote: { input: { token: USDC, amount: "1" } } }).fetch))).rejects.toThrow(/input amount/);
  });

  it("caps slippage and validates inputs before any network call", async () => {
    const { fetch, requests } = mockApi();
    await expect(quoteSwapInPlace({ ...apiParams(fetch), slippageBps: MAX_SLIPPAGE_BPS + 1 })).rejects.toThrow(/exceeds cap/);
    await expect(quoteSwapInPlace({ ...apiParams(fetch), slippageBps: 1.5 })).rejects.toBeInstanceOf(SwapError);
    await expect(quoteSwapInPlace({ ...apiParams(fetch), amountIn: 0n })).rejects.toThrow(/positive/);
    await expect(quoteSwapInPlace({ ...apiParams(fetch), tokenOut: USDC })).rejects.toThrow(/tokenIn equals tokenOut/);
    await expect(quoteSwapInPlace({ ...apiParams(fetch), chainId: 1 })).rejects.toThrow(/unsupported chain/);
    expect(requests).toHaveLength(0);
  });

  it("surfaces HTTP errors (e.g. a missing API key) with the status", async () => {
    const fetch: SwapFetch = async () => ({ ok: false, status: 401, json: async () => ({}), text: async () => '{"errorCode":"Unauthorized"}' });
    await expect(quoteSwapInPlace(apiParams(fetch))).rejects.toThrow(/401/);
  });

  it("goes through a key-adding proxy: apiUrl alone selects the Trading API and sends no x-api-key", async () => {
    const { fetch, requests } = mockApi();
    const { apiKey: _unused, ...noKey } = apiParams(fetch);
    const q = await quoteSwapInPlace({ ...noKey, apiUrl: "https://api.soapay.test/uniswap" });
    expect(q.source).toBe("trading-api");
    expect(requests.map((r) => r.url)).toEqual(["https://api.soapay.test/uniswap/quote"]);
    for (const r of requests) expect(r.headers).not.toHaveProperty("x-api-key");
  });

  it("a proxy without a key (503 uniswap_disabled) or an upstream 5xx falls back unless the source is forced", async () => {
    const cases: [number, string][] = [
      [503, JSON.stringify({ code: "uniswap_disabled", error: { code: "uniswap_disabled", message: "off" } })],
      [504, '{"errorCode":"UpstreamTimeoutError"}'],
    ];
    for (const [status, text] of cases) {
      const calls: string[] = [];
      const fetch: SwapFetch = async (url) => {
        calls.push(url);
        return { ok: false, status, json: async () => JSON.parse(text), text: async () => text };
      };
      const { apiKey: _unused, ...noKey } = apiParams(fetch);
      const proxied = { ...noKey, apiUrl: "https://api.soapay.test/uniswap" };
      await expect(quoteSwapInPlace({ ...proxied, source: "trading-api" })).rejects.toBeInstanceOf(status === 503 ? SwapProxyDisabledError : SwapUpstreamError);
      // Default source: the fallback runs (this mock chain has no QuoterV2, so it fails there instead).
      const err = await quoteSwapInPlace(proxied).catch((e: unknown) => e);
      expect(err).not.toBeInstanceOf(SwapProxyDisabledError);
      expect(err).not.toBeInstanceOf(SwapUpstreamError);
      expect(calls).toEqual(["https://api.soapay.test/uniswap/quote", "https://api.soapay.test/uniswap/quote"]);
    }
  });
});

describe("minOutFor", () => {
  it("rounds down", () => {
    expect(minOutFor(10_000n, 50)).toBe(9_950n);
    expect(minOutFor(3n, 100)).toBe(2n);
  });
});
