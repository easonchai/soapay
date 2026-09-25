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
  SwapRecipientError,
  UNIVERSAL_ROUTER,
  UR_ADDRESS_THIS,
  UR_MSG_SENDER,
  UrCommand,
  V4Action,
  WETH_BASE,
  assertSwapStaysInPlace,
  encodeV3ExactInSwap,
  minOutFor,
  permit2Abi,
  quoteSwapInPlace,
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
// Trading API path (mocked HTTP)
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

function mockApi(over: { quote?: Record<string, unknown>; top?: Record<string, unknown>; swapData?: Hex; swapTo?: Address } = {}) {
  const requests: { url: string; headers: Record<string, string>; body: Record<string, unknown> }[] = [];
  const fetch: SwapFetch = async (url, init) => {
    const body = JSON.parse(init.body) as Record<string, unknown>;
    requests.push({ url, headers: init.headers, body });
    const json = url.endsWith("/quote")
      ? {
          requestId: "r1",
          routing: "CLASSIC",
          permitData: null,
          permitTransaction: { to: PERMIT2_ADDRESS, from: STEALTH, data: "0x", value: "0", chainId: CHAIN_ID },
          quote: {
            chainId: CHAIN_ID,
            swapper: STEALTH,
            input: { token: USDC, amount: String(body.amount) },
            output: { token: WETH_BASE, amount: AMOUNT_OUT.toString(), recipient: STEALTH },
            aggregatedOutputs: [{ token: WETH_BASE, amount: AMOUNT_OUT.toString(), recipient: STEALTH }],
            slippage: 0.5,
            routeString: "[V3] 100.00% = USDC -- 0.05% [0xd0b5...] --> WETH",
            ...over.quote,
          },
          ...over.top,
        }
      : {
          requestId: "r2",
          swap: {
            to: over.swapTo ?? ROUTER,
            from: STEALTH,
            data: over.swapData ?? execute([UrCommand.V3_SWAP_EXACT_IN], [v3Swap(STEALTH)]),
            value: "0",
            chainId: CHAIN_ID,
          },
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
  now: () => 1_900_000_000,
});

describe("quoteSwapInPlace via the Trading API", () => {
  it("asks for an in-place, AMM-only, permit-as-transaction quote and returns the batched calls", async () => {
    const { fetch, requests } = mockApi();
    const q = await quoteSwapInPlace(apiParams(fetch));
    expect(q.source).toBe("trading-api");
    expect(requests.map((r) => r.url)).toEqual(["https://trade-api.gateway.uniswap.org/v1/quote", "https://trade-api.gateway.uniswap.org/v1/swap"]);
    expect(requests[0]!.headers["x-api-key"]).toBe("test-key");
    expect(requests[0]!.headers["x-universal-router-version"]).toBe("2.1.2");
    expect(JSON.parse(requests[0]!.headers["x-agent-info"]!)).toMatchObject({ decision_origin: "human_mediated" });
    expect(requests[0]!.body).toMatchObject({
      type: "EXACT_INPUT",
      amount: "20000000",
      swapper: STEALTH,
      recipient: STEALTH,
      slippageTolerance: 0.5,
      protocols: ["V2", "V3", "V4"],
      generatePermitAsTransaction: true,
      permitAmount: "EXACT",
    });
    expect(q.amountOut).toBe(AMOUNT_OUT);
    expect(q.minOut).toBe(minOutFor(AMOUNT_OUT, 50));

    // [USDC.approve(Permit2, exact), Permit2.approve(UR, exact, deadline), swap, balance guard]
    expect(q.calls.map((c) => getAddress(c.to))).toEqual([getAddress(USDC), PERMIT2_ADDRESS, ROUTER, ROUTER]);
    expect(decodeFunctionData({ abi: erc20Abi, data: q.calls[0]!.data! }).args).toEqual([PERMIT2_ADDRESS, 20_000_000n]);
    expect(decodeFunctionData({ abi: permit2Abi, data: q.calls[1]!.data! }).args).toEqual([getAddress(USDC), ROUTER, 20_000_000n, 1_900_000_000 + 1800]);
    const guard = decodeFunctionData({ abi: universalRouterAbi, data: q.calls[3]!.data! });
    expect(guard.args![0]).toBe("0x0e");
    expect(decodeAbiParameters(tra, (guard.args![1] as Hex[])[0]!)).toEqual([STEALTH, WETH_BASE, WETH_BEFORE + q.minOut]);
    expect(q.calls.every((c) => (c.value ?? 0n) === 0n)).toBe(true);
  });

  it("rejects a quote or calldata that pays anyone but the stealth address", async () => {
    await expect(quoteSwapInPlace(apiParams(mockApi({ quote: { output: { token: WETH_BASE, amount: "1", recipient: MALLORY } } }).fetch))).rejects.toBeInstanceOf(
      SwapRecipientError,
    );
    await expect(
      quoteSwapInPlace(
        apiParams(mockApi({ quote: { aggregatedOutputs: [{ token: WETH_BASE, amount: "1", recipient: STEALTH }, { token: WETH_BASE, amount: "1", recipient: MALLORY, fee: "INTEGRATOR" }] } }).fetch),
      ),
    ).rejects.toBeInstanceOf(SwapRecipientError);
    await expect(quoteSwapInPlace(apiParams(mockApi({ swapData: execute([UrCommand.V3_SWAP_EXACT_IN], [v3Swap(MALLORY)]) }).fetch))).rejects.toBeInstanceOf(
      SwapRecipientError,
    );
    await expect(quoteSwapInPlace(apiParams(mockApi({ swapTo: MALLORY }).fetch))).rejects.toBeInstanceOf(SwapRecipientError);
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
});

describe("minOutFor", () => {
  it("rounds down", () => {
    expect(minOutFor(10_000n, 50)).toBe(9_950n);
    expect(minOutFor(3n, 100)).toBe(2n);
  });
});
