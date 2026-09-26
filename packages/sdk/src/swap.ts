/**
 * Convert salary in place (docs/mvp-spec.md §6): swap part of a stealth address's USDC into another
 * asset INSIDE the same stealth address, in one EIP-7702 userOp with gas paid in USDC.
 *
 *   executeBatch([
 *     USDC.approve(Permit2, amountIn),                       // exact, never max
 *     Permit2.approve(USDC, UniversalRouter, amountIn, exp),  // on-chain Permit2 allowance, no signature
 *     UniversalRouter.execute(<swap>),                        // Trading API calldata, or our own V3 encoding
 *     UniversalRouter.execute(BALANCE_CHECK_ERC20)            // ERC-20 outputs: minOut enforced by us, not the quote
 *   ])
 *
 * Every output must land at the stealth address itself. A quote that pays anyone else (a different
 * recipient, a fee portion, a transfer) is rejected before signing, because moving value to another
 * address would link it to this one. Tokens never leave the address, so no clusters merge.
 *
 * Two quote sources, and neither lets the Trading API or the Soapay platform see the stealth address
 * (D-27, docs/privacy-model.md):
 * - "trading-api": Uniswap Trading API `/quote` only (API key, usually added by our proxy), asked
 *   with a fresh random PLACEHOLDER swapper. We never call `/swap`: the quoted V2/V3 route is
 *   re-encoded here as Universal Router commands with the stealth address as recipient. Every
 *   request body passes `assertNoStealthAddress` first. Default on Base mainnet.
 * - "universal-router": QuoterV2 over the public client + our own V3 exact-input encoding. No API at
 *   all. Default on Base Sepolia, where the Trading API times out, and the fallback everywhere.
 */
import {
  decodeAbiParameters,
  bytesToHex,
  decodeFunctionData,
  encodeAbiParameters,
  encodeFunctionData,
  encodePacked,
  erc20Abi,
  getAddress,
  hexToBytes,
  isAddress,
  isAddressEqual,
  parseAbi,
  parseAbiParameters,
  slice,
  zeroAddress,
  type Address,
  type Chain,
  type Hex,
  type PublicClient,
  type Transport,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { getChainConfig } from "./constants.js";
import { executeFromStealth, type ExecuteResult, type SpendClient, type SpendOptions, type StealthCall } from "./spend.js";

// ---------------------------------------------------------------------------------------------
// Addresses (all checked with eth_getCode on Base and Base Sepolia, 2026-09-25)
// ---------------------------------------------------------------------------------------------

/** Canonical Permit2, same address on every chain. */
export const PERMIT2_ADDRESS = "0x000000000022D473030F116dDEE9F6B43aC78BA3" as const;
/** Native ETH as the Trading API spells it. */
export const NATIVE_ETH = zeroAddress;
/** OP-stack WETH predeploy (Base and Base Sepolia). */
export const WETH_BASE = "0x4200000000000000000000000000000000000006" as const;

/** Universal Router 2.1.2, the Trading API default (Uniswap sdks universal-router-sdk constants.ts). */
export const UNIVERSAL_ROUTER_VERSION = "2.1.2" as const;
export const UNIVERSAL_ROUTER = {
  8453: "0xd6145b2D3F379919E8CdEda7B97e37c4b2Ca9c40",
  84532: "0x8702463e73f74d0b6765aBceb314Ef07aCb92650",
} as const satisfies Record<number, Address>;

/** Uniswap v3 QuoterV2, for the no-API-key fallback. */
export const UNISWAP_V3_QUOTER_V2 = {
  8453: "0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a",
  84532: "0xC5290058841028F1614F3A6F0F5816cAd0df5E27",
} as const satisfies Record<number, Address>;

export const TRADING_API_URL = "https://trade-api.gateway.uniswap.org/v1";
/**
 * Optional `x-agent-info` attribution (analytics only, never changes the response). No address,
 * key or user id goes in it. `human_mediated`: the recipient confirms every swap in the app.
 */
export const TRADING_API_AGENT_INFO = JSON.stringify({ decision_origin: "human_mediated", integration_name: "soapay-sdk", version: "0.0.0" });

/** Hard slippage ceiling. Anything looser is refused rather than silently clamped. */
export const MAX_SLIPPAGE_BPS = 500;
/** Permit2 allowance lifetime and swap deadline. The userOp either lands soon or not at all. */
export const DEFAULT_SWAP_DEADLINE_SECONDS = 30 * 60;
/** USDC/WETH 0.05% is the deepest Base pool. */
export const DEFAULT_V3_FEE_TIER = 500;

/** Universal Router recipient sentinels (ActionConstants). */
export const UR_MSG_SENDER = "0x0000000000000000000000000000000000000001" as const;
export const UR_ADDRESS_THIS = "0x0000000000000000000000000000000000000002" as const;

export const UrCommand = {
  V3_SWAP_EXACT_IN: 0x00,
  V3_SWAP_EXACT_OUT: 0x01,
  PERMIT2_TRANSFER_FROM: 0x02,
  PERMIT2_PERMIT_BATCH: 0x03,
  SWEEP: 0x04,
  TRANSFER: 0x05,
  PAY_PORTION: 0x06,
  PAY_PORTION_FULL_PRECISION: 0x07,
  V2_SWAP_EXACT_IN: 0x08,
  V2_SWAP_EXACT_OUT: 0x09,
  PERMIT2_PERMIT: 0x0a,
  WRAP_ETH: 0x0b,
  UNWRAP_WETH: 0x0c,
  BALANCE_CHECK_ERC20: 0x0e,
  V4_SWAP: 0x10,
} as const;

/** v4-periphery Actions.sol codes that can appear inside V4_SWAP. */
export const V4Action = {
  SWAP_EXACT_IN_SINGLE: 0x06,
  SWAP_EXACT_IN: 0x07,
  SWAP_EXACT_OUT_SINGLE: 0x08,
  SWAP_EXACT_OUT: 0x09,
  SETTLE: 0x0b,
  SETTLE_ALL: 0x0c,
  SETTLE_PAIR: 0x0d,
  TAKE: 0x0e,
  TAKE_ALL: 0x0f,
  TAKE_PORTION: 0x10,
  TAKE_PAIR: 0x11,
  CLOSE_CURRENCY: 0x12,
  CLEAR_OR_TAKE: 0x13,
  SWEEP: 0x14,
  WRAP: 0x15,
  UNWRAP: 0x16,
} as const;

export const universalRouterAbi = parseAbi([
  "function execute(bytes commands, bytes[] inputs, uint256 deadline) payable",
  "function execute(bytes commands, bytes[] inputs) payable",
]);
export const permit2Abi = parseAbi([
  "function approve(address token, address spender, uint160 amount, uint48 expiration)",
  "function allowance(address owner, address token, address spender) view returns (uint160 amount, uint48 expiration, uint48 nonce)",
]);
export const quoterV2Abi = parseAbi([
  "function quoteExactInputSingle((address tokenIn, address tokenOut, uint256 amountIn, uint24 fee, uint160 sqrtPriceLimitX96) params) returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)",
]);

// ---------------------------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------------------------

export class SwapError extends Error {
  override name = "SwapError";
}
/** The backend proxy has no Trading API key (503 `uniswap_disabled`); use the Universal Router. */
export class SwapProxyDisabledError extends SwapError {
  override name = "SwapProxyDisabledError";
  constructor() {
    super("Soapay swap: the Trading API proxy is disabled (no UNISWAP_API_KEY)");
  }
}
/** The quote or its calldata would send value somewhere other than the stealth address. */
export class SwapRecipientError extends SwapError {
  override name = "SwapRecipientError";
}
/** A request to the quote service would have carried the stealth address. Never falls back silently. */
export class SwapPrivacyError extends SwapError {
  override name = "SwapPrivacyError";
}
/** The Trading API route uses pools we don't re-encode (V4, mixed) or doesn't add up; use the fallback. */
export class SwapRouteUnsupportedError extends SwapError {
  override name = "SwapRouteUnsupportedError";
}
/** The Trading API (or the proxy in front of it) failed with a 5xx, e.g. Base Sepolia routing timeouts. */
export class SwapUpstreamError extends SwapError {
  override name = "SwapUpstreamError";
}

export type SwapSource = "trading-api" | "universal-router";

/** Minimal fetch shape, so the SDK does not depend on DOM typings. */
export type SwapFetch = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string },
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown>; text(): Promise<string> }>;

export type SwapQuoteParams = {
  chainId: number;
  /** The stealth address that pays AND receives. */
  stealthAddress: Address;
  /** Defaults to the chain's USDC. */
  tokenIn?: Address;
  /** ERC-20 address, or `NATIVE_ETH` (0x0) for native ETH delivered to the stealth address. */
  tokenOut: Address;
  amountIn: bigint;
  /** Max output shortfall vs. the quote, in bps. Must be ≤ `MAX_SLIPPAGE_BPS`. */
  slippageBps: number;
  /** Trading API key (server-side only). Without it or `apiUrl`, the Universal Router fallback is used. */
  apiKey?: string;
  /**
   * Force a source. Default (`defaultSwapSource`): "trading-api" when `apiKey` or `apiUrl` is set AND
   * the chain is in `TRADING_API_ROUTED_CHAINS`, else "universal-router".
   */
  source?: SwapSource;
  /** The throwaway `/quote` swapper. Default: a fresh random address per quote. Injectable for tests. */
  placeholderSwapper?: () => Address;
  /** Needed for the fallback quote and the ERC-20 balance guard. */
  publicClient?: PublicClient<Transport, Chain>;
  /** V3 pool fee for the fallback. Default 500. */
  feeTier?: number;
  /**
   * Trading API base URL. Browser apps point this at a backend proxy that adds `x-api-key`
   * (the key must not ship in a client bundle, and the API rejects browser CORS preflights).
   */
  apiUrl?: string;
  fetch?: SwapFetch;
  deadlineSeconds?: number;
  /** Unix seconds; injectable for tests. */
  now?: () => number;
};

export type SwapQuote = {
  source: SwapSource;
  chainId: number;
  stealthAddress: Address;
  tokenIn: Address;
  tokenOut: Address;
  amountIn: bigint;
  /** Expected output. */
  amountOut: bigint;
  /** Output floor enforced on-chain: amountOut × (1 − slippage). */
  minOut: bigint;
  slippageBps: number;
  /** Human-readable route, e.g. "USDC -[v3 0.05%]-> WETH". */
  route: string;
  router: Address;
  deadline: bigint;
  /** The calls for `executeFromStealth`, in order. All value 0. */
  calls: StealthCall[];
};

// ---------------------------------------------------------------------------------------------
// Encoding helpers
// ---------------------------------------------------------------------------------------------

export function universalRouterFor(chainId: number): Address {
  const a = (UNIVERSAL_ROUTER as Record<number, Address>)[chainId];
  if (!a) throw new SwapError(`Soapay swap: no Universal Router known for chain ${chainId}`);
  return a;
}

export function minOutFor(amountOut: bigint, slippageBps: number): bigint {
  return (amountOut * BigInt(10_000 - slippageBps)) / 10_000n;
}

function checkSlippage(slippageBps: number): void {
  if (!Number.isInteger(slippageBps) || slippageBps < 0) throw new SwapError("Soapay swap: slippageBps must be a non-negative integer");
  if (slippageBps > MAX_SLIPPAGE_BPS) throw new SwapError(`Soapay swap: slippage ${slippageBps} bps exceeds cap ${MAX_SLIPPAGE_BPS}`);
}

const isNative = (t: Address) => isAddressEqual(t, NATIVE_ETH);

/** UR 2.1.x V3_SWAP_EXACT_IN input: V2.0 layout plus `uint256[] minHopPriceX36` (empty = no per-hop check). */
const V3_EXACT_IN_PARAMS = parseAbiParameters("address, uint256, uint256, bytes, bool, uint256[]");
const V2_EXACT_IN_PARAMS = parseAbiParameters("address, uint256, uint256, address[], bool, uint256[]");
const V3_EXACT_OUT_PARAMS = V3_EXACT_IN_PARAMS;
const V2_EXACT_OUT_PARAMS = V2_EXACT_IN_PARAMS;
const TOKEN_RECIPIENT_AMOUNT = parseAbiParameters("address, address, uint256");
const RECIPIENT_AMOUNT = parseAbiParameters("address, uint256");

/** Encodes `USDC.approve(Permit2)` + `Permit2.approve(UR)` for exactly `amount`. */
export function buildPermit2ApprovalCalls(args: { token: Address; router: Address; amount: bigint; expiration: bigint }): StealthCall[] {
  if (args.amount >= 1n << 160n) throw new SwapError("Soapay swap: amount exceeds uint160");
  return [
    { to: args.token, value: 0n, data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [PERMIT2_ADDRESS, args.amount] }) },
    {
      to: PERMIT2_ADDRESS,
      value: 0n,
      data: encodeFunctionData({ abi: permit2Abi, functionName: "approve", args: [args.token, args.router, args.amount, Number(args.expiration)] }),
    },
  ];
}

/** `UR.execute(BALANCE_CHECK_ERC20(owner, token, minBalance))`: reverts the whole userOp if short. */
export function buildBalanceGuardCall(args: { router: Address; owner: Address; token: Address; minBalance: bigint; deadline: bigint }): StealthCall {
  const input = encodeAbiParameters(TOKEN_RECIPIENT_AMOUNT, [args.owner, args.token, args.minBalance]);
  return {
    to: args.router,
    value: 0n,
    data: encodeFunctionData({
      abi: universalRouterAbi,
      functionName: "execute",
      args: [encodePacked(["uint8"], [UrCommand.BALANCE_CHECK_ERC20]), [input], args.deadline],
    }),
  };
}

/**
 * Universal Router V3 exact-input single-hop swap whose output lands at `recipient`. For native ETH
 * out it swaps to WETH held by the router, then UNWRAP_WETH to `recipient` with the same floor.
 */
export function encodeV3ExactInSwap(args: {
  tokenIn: Address;
  tokenOut: Address;
  weth: Address;
  feeTier: number;
  amountIn: bigint;
  minOut: bigint;
  recipient: Address;
  deadline: bigint;
}): Hex {
  const native = isNative(args.tokenOut);
  const out = native ? args.weth : args.tokenOut;
  const path = encodePacked(["address", "uint24", "address"], [args.tokenIn, args.feeTier, out]);
  const swapInput = encodeAbiParameters(V3_EXACT_IN_PARAMS, [
    native ? UR_ADDRESS_THIS : args.recipient,
    args.amountIn,
    native ? 0n : args.minOut,
    path,
    true, // payerIsUser: pulled from msg.sender (the stealth address) through Permit2
    [],
  ]);
  const commands: number[] = [UrCommand.V3_SWAP_EXACT_IN];
  const inputs: Hex[] = [swapInput];
  if (native) {
    commands.push(UrCommand.UNWRAP_WETH);
    inputs.push(encodeAbiParameters(RECIPIENT_AMOUNT, [args.recipient, args.minOut]));
  }
  return encodeFunctionData({
    abi: universalRouterAbi,
    functionName: "execute",
    args: [encodePacked(commands.map(() => "uint8" as const), commands), inputs, args.deadline],
  });
}

// ---------------------------------------------------------------------------------------------
// In-place validation of Universal Router calldata
// ---------------------------------------------------------------------------------------------

export type ValidatedSwapCall = {
  router: Address;
  commands: number[];
  /** Every recipient the calldata names, as written (sentinels included). */
  recipients: Address[];
  deadline: bigint | null;
};

/**
 * Throws `SwapRecipientError` unless every value the call moves ends at `stealthAddress`.
 * Allowed recipients: the stealth address, MSG_SENDER (= the stealth address, since it calls the
 * router), and ADDRESS_THIS (the router) for intermediate hops only, which must then be swept or
 * unwrapped back to the stealth address. Unknown commands, allow-revert flags, transfers, fee
 * portions and Permit2 signature commands are rejected.
 */
export function assertSwapStaysInPlace(args: {
  chainId: number;
  stealthAddress: Address;
  tx: { to: Address; data: Hex; value?: bigint };
  routers?: readonly Address[];
}): ValidatedSwapCall {
  const routers = args.routers ?? [universalRouterFor(args.chainId)];
  const to = getAddress(args.tx.to);
  if (!routers.some((r) => isAddressEqual(r, to))) throw new SwapRecipientError(`Soapay swap: call target ${to} is not a known Universal Router`);
  if ((args.tx.value ?? 0n) !== 0n) throw new SwapError("Soapay swap: swap call must not carry ETH value");

  let decoded;
  try {
    decoded = decodeFunctionData({ abi: universalRouterAbi, data: args.tx.data });
  } catch {
    throw new SwapRecipientError("Soapay swap: calldata is not UniversalRouter.execute");
  }
  const [commandsHex, inputs, deadline] = decoded.args as readonly [Hex, readonly Hex[], bigint?];
  const commands = [...hexToBytes(commandsHex)];
  if (commands.length !== inputs.length) throw new SwapRecipientError("Soapay swap: commands/inputs length mismatch");

  const self = getAddress(args.stealthAddress);
  const recipients: Address[] = [];
  const isSelf = (a: Address) => isAddressEqual(a, self) || isAddressEqual(a, UR_MSG_SENDER);
  let routerHolds = false;
  let swaps = 0;
  const reject = (why: string): never => {
    throw new SwapRecipientError(`Soapay swap: ${why}`);
  };
  const hop = (recipient: Address, what: string) => {
    recipients.push(recipient);
    if (isAddressEqual(recipient, UR_ADDRESS_THIS)) routerHolds = true;
    else if (!isSelf(recipient)) reject(`${what} pays ${recipient}, not the stealth address`);
  };
  const final = (recipient: Address, what: string) => {
    recipients.push(recipient);
    if (!isSelf(recipient)) reject(`${what} pays ${recipient}, not the stealth address`);
    routerHolds = false;
  };

  for (let i = 0; i < commands.length; i++) {
    const raw = commands[i]!;
    if (raw & 0x80) reject(`command ${i} sets the allow-revert flag`);
    const cmd = raw & 0x3f;
    const input = inputs[i]!;
    switch (cmd) {
      case UrCommand.V3_SWAP_EXACT_IN:
      case UrCommand.V3_SWAP_EXACT_OUT:
      case UrCommand.V2_SWAP_EXACT_IN:
      case UrCommand.V2_SWAP_EXACT_OUT: {
        const params =
          cmd === UrCommand.V3_SWAP_EXACT_IN
            ? V3_EXACT_IN_PARAMS
            : cmd === UrCommand.V3_SWAP_EXACT_OUT
              ? V3_EXACT_OUT_PARAMS
              : cmd === UrCommand.V2_SWAP_EXACT_IN
                ? V2_EXACT_IN_PARAMS
                : V2_EXACT_OUT_PARAMS;
        // Recipient is the first word in both the 2.0 and 2.1.x layouts.
        const [recipient] = decodeAbiParameters(params.slice(0, 1) as never, slice(input, 0, 32)) as unknown as [Address];
        hop(recipient, `swap command ${i}`);
        swaps++;
        break;
      }
      case UrCommand.V4_SWAP:
        for (const r of v4Recipients(input)) {
          if (r.final) final(r.recipient, `v4 action in command ${i}`);
          else hop(r.recipient, `v4 action in command ${i}`);
        }
        swaps++;
        break;
      case UrCommand.SWEEP: {
        const [, recipient] = decodeAbiParameters(TOKEN_RECIPIENT_AMOUNT, input);
        final(recipient, `SWEEP (command ${i})`);
        break;
      }
      case UrCommand.UNWRAP_WETH: {
        const [recipient] = decodeAbiParameters(RECIPIENT_AMOUNT, input);
        final(recipient, `UNWRAP_WETH (command ${i})`);
        break;
      }
      case UrCommand.BALANCE_CHECK_ERC20:
        break;
      default:
        reject(`command 0x${cmd.toString(16).padStart(2, "0")} at ${i} is not allowed for an in-place swap`);
    }
  }
  if (swaps === 0 && !commands.every((c) => c === UrCommand.BALANCE_CHECK_ERC20)) reject("no swap command");
  if (routerHolds) reject("output left in the router without a sweep back to the stealth address");
  return { router: to, commands, recipients, deadline: deadline ?? null };
}

const V4_ACTIONS_PARAMS = parseAbiParameters("bytes, bytes[]");

/** Recipients inside a V4_SWAP input; unknown actions throw. */
function v4Recipients(input: Hex): { recipient: Address; final: boolean }[] {
  const [actionsHex, params] = decodeAbiParameters(V4_ACTIONS_PARAMS, input);
  const actions = [...hexToBytes(actionsHex)];
  if (actions.length !== params.length) throw new SwapRecipientError("Soapay swap: v4 actions/params length mismatch");
  const out: { recipient: Address; final: boolean }[] = [];
  actions.forEach((a, i) => {
    const p = params[i]!;
    switch (a) {
      case V4Action.SWAP_EXACT_IN_SINGLE:
      case V4Action.SWAP_EXACT_IN:
      case V4Action.SWAP_EXACT_OUT_SINGLE:
      case V4Action.SWAP_EXACT_OUT:
      case V4Action.SETTLE:
      case V4Action.SETTLE_ALL:
      case V4Action.SETTLE_PAIR:
      case V4Action.TAKE_ALL: // to msgSender
      case V4Action.CLOSE_CURRENCY:
      case V4Action.CLEAR_OR_TAKE: // to msgSender
      case V4Action.WRAP:
      case V4Action.UNWRAP:
        break;
      case V4Action.TAKE:
      case V4Action.TAKE_PORTION: {
        const [, recipient] = decodeAbiParameters(TOKEN_RECIPIENT_AMOUNT, p);
        out.push({ recipient, final: !isAddressEqual(recipient, UR_ADDRESS_THIS) });
        break;
      }
      case V4Action.TAKE_PAIR: {
        const [, , recipient] = decodeAbiParameters(parseAbiParameters("address, address, address"), p);
        out.push({ recipient, final: !isAddressEqual(recipient, UR_ADDRESS_THIS) });
        break;
      }
      case V4Action.SWEEP: {
        const [, recipient] = decodeAbiParameters(parseAbiParameters("address, address"), p);
        out.push({ recipient, final: true });
        break;
      }
      default:
        throw new SwapRecipientError(`Soapay swap: v4 action 0x${a.toString(16)} is not allowed for an in-place swap`);
    }
  });
  return out;
}

// ---------------------------------------------------------------------------------------------
// Quotes
// ---------------------------------------------------------------------------------------------

type Resolved = Required<Pick<SwapQuoteParams, "chainId" | "tokenOut" | "amountIn" | "slippageBps">> & {
  stealthAddress: Address;
  tokenIn: Address;
  router: Address;
  deadline: bigint;
};

function resolve(params: SwapQuoteParams): Resolved {
  checkSlippage(params.slippageBps);
  if (params.amountIn <= 0n) throw new SwapError("Soapay swap: amountIn must be positive");
  const config = getChainConfig(params.chainId);
  const tokenIn = getAddress(params.tokenIn ?? config.usdc);
  const tokenOut = getAddress(params.tokenOut);
  if (isNative(tokenIn)) throw new SwapError("Soapay swap: native ETH input is not supported (stealth addresses hold no ETH)");
  if (isAddressEqual(tokenIn, tokenOut)) throw new SwapError("Soapay swap: tokenIn equals tokenOut");
  const now = BigInt(params.now?.() ?? Math.floor(Date.now() / 1000));
  return {
    chainId: params.chainId,
    stealthAddress: getAddress(params.stealthAddress),
    tokenIn,
    tokenOut,
    amountIn: params.amountIn,
    slippageBps: params.slippageBps,
    router: universalRouterFor(params.chainId),
    deadline: now + BigInt(params.deadlineSeconds ?? DEFAULT_SWAP_DEADLINE_SECONDS),
  };
}

async function assembleCalls(r: Resolved, swapCall: StealthCall, minOut: bigint, publicClient?: PublicClient<Transport, Chain>): Promise<StealthCall[]> {
  const calls = [...buildPermit2ApprovalCalls({ token: r.tokenIn, router: r.router, amount: r.amountIn, expiration: r.deadline }), swapCall];
  if (!isNative(r.tokenOut)) {
    // Our own floor, independent of whatever minimum the quoted calldata encodes.
    if (!publicClient) throw new SwapError("Soapay swap: publicClient is required for the ERC-20 balance guard");
    const before = await publicClient.readContract({ address: r.tokenOut, abi: erc20Abi, functionName: "balanceOf", args: [r.stealthAddress] });
    calls.push(buildBalanceGuardCall({ router: r.router, owner: r.stealthAddress, token: r.tokenOut, minBalance: before + minOut, deadline: r.deadline }));
  }
  return calls;
}

async function quoteViaUniversalRouter(params: SwapQuoteParams, r: Resolved): Promise<SwapQuote> {
  const publicClient = params.publicClient;
  if (!publicClient) throw new SwapError("Soapay swap: publicClient is required for the Universal Router fallback");
  const quoter = (UNISWAP_V3_QUOTER_V2 as Record<number, Address>)[r.chainId];
  if (!quoter) throw new SwapError(`Soapay swap: no QuoterV2 known for chain ${r.chainId}`);
  const feeTier = params.feeTier ?? DEFAULT_V3_FEE_TIER;
  const out = isNative(r.tokenOut) ? WETH_BASE : r.tokenOut;
  const { result } = await publicClient.simulateContract({
    address: quoter,
    abi: quoterV2Abi,
    functionName: "quoteExactInputSingle",
    args: [{ tokenIn: r.tokenIn, tokenOut: out, amountIn: r.amountIn, fee: feeTier, sqrtPriceLimitX96: 0n }],
  });
  const amountOut = result[0];
  if (amountOut === 0n) throw new SwapError("Soapay swap: no liquidity");
  const minOut = minOutFor(amountOut, r.slippageBps);
  const data = encodeV3ExactInSwap({
    tokenIn: r.tokenIn,
    tokenOut: r.tokenOut,
    weth: WETH_BASE,
    feeTier,
    amountIn: r.amountIn,
    minOut,
    recipient: r.stealthAddress,
    deadline: r.deadline,
  });
  const swapCall = { to: r.router, value: 0n, data };
  assertSwapStaysInPlace({ chainId: r.chainId, stealthAddress: r.stealthAddress, tx: { to: r.router, data } });
  return {
    source: "universal-router",
    chainId: r.chainId,
    stealthAddress: r.stealthAddress,
    tokenIn: r.tokenIn,
    tokenOut: r.tokenOut,
    amountIn: r.amountIn,
    amountOut,
    minOut,
    slippageBps: r.slippageBps,
    route: `${r.tokenIn} -[v3 ${feeTier / 10_000}%]-> ${out}${isNative(r.tokenOut) ? " -> ETH" : ""}`,
    router: r.router,
    deadline: r.deadline,
    calls: await assembleCalls(r, swapCall, minOut, publicClient),
  };
}

// ---------------------------------------------------------------------------------------------
// Trading API, platform-free (D-27): quote with a placeholder swapper, build the swap ourselves
// ---------------------------------------------------------------------------------------------

/** Chains where the Trading API actually routes. Base Sepolia is listed but times out upstream. */
export const TRADING_API_ROUTED_CHAINS: readonly number[] = [8453];

/**
 * Pool types we re-encode as Universal Router commands. V4 is not requested: its path keys need
 * hooks and tick spacing, and a route we can't rebuild exactly is one we won't sign.
 */
export const TRADING_API_PROTOCOLS = ["V2", "V3"] as const;

/**
 * A fresh random address used as the `/quote` swapper. It holds nothing, signs nothing and is
 * thrown away after the quote, so the quote service (and our proxy) never learns the stealth address.
 */
export function randomPlaceholderSwapper(): Address {
  const c = (globalThis as unknown as { crypto?: { getRandomValues(a: Uint8Array): Uint8Array } }).crypto;
  if (!c?.getRandomValues) throw new SwapError("Soapay swap: no secure randomness for the placeholder swapper");
  return getAddress(bytesToHex(c.getRandomValues(new Uint8Array(20))));
}

/**
 * The privacy guard for every request to the Trading API or our proxy: throws `SwapPrivacyError`
 * if the URL or body contains the stealth address in any casing, with or without `0x`.
 */
export function assertNoStealthAddress(stealthAddress: Address, ...parts: string[]): void {
  const needle = getAddress(stealthAddress).slice(2).toLowerCase();
  if (parts.some((p) => p.toLowerCase().includes(needle)))
    throw new SwapPrivacyError("Soapay swap: refusing to send the stealth address to the quote service");
}

/** The default source: the Trading API only where it routes and a key or proxy is configured. */
export function defaultSwapSource(params: Pick<SwapQuoteParams, "chainId" | "apiKey" | "apiUrl">): SwapSource {
  if (!params.apiKey && !params.apiUrl) return "universal-router";
  return TRADING_API_ROUTED_CHAINS.includes(params.chainId) ? "trading-api" : "universal-router";
}

type ApiToken = { address?: string };
type ApiPool = { type?: string; tokenIn?: ApiToken; tokenOut?: ApiToken; fee?: string | number; amountIn?: string; amountOut?: string };
type ApiQuoteResponse = {
  routing?: string;
  permitData?: unknown;
  quote?: {
    input?: { token?: string; amount?: string };
    output?: { token?: string; amount?: string };
    route?: unknown;
    routeString?: string;
    swapper?: string;
    slippage?: number;
    [k: string]: unknown;
  };
};

const MAX_SPLITS = 8;
const MAX_HOPS = 4;

/**
 * Re-encodes a Trading API `quote.route` (splits of V2 or V3 pools) as one `UniversalRouter.execute`
 * whose outputs all land at `recipient`. Each split is an exact-input swap of its quoted amount;
 * the splits must add up to `amountIn`. Native ETH out: swaps pay the router in WETH, then one
 * UNWRAP_WETH to `recipient` enforces the total floor. Anything else (V4 or mixed pools, broken
 * token chains, a mismatched total) throws `SwapRouteUnsupportedError`.
 *
 * Only pool types, tokens and fee tiers come from the quote. The router derives pool addresses
 * itself, so a quoted pool address can't redirect funds.
 */
export function encodeQuotedRouteExactIn(args: {
  route: unknown;
  tokenIn: Address;
  tokenOut: Address;
  weth: Address;
  amountIn: bigint;
  /** Total floor for all splits together. */
  minOut: bigint;
  slippageBps: number;
  recipient: Address;
  deadline: bigint;
}): Hex {
  const bad = (why: string): never => {
    throw new SwapRouteUnsupportedError(`Soapay swap: can't rebuild the quoted route (${why})`);
  };
  const splits = args.route;
  if (!Array.isArray(splits) || splits.length === 0) bad("no route");
  if ((splits as unknown[]).length > MAX_SPLITS) bad("too many splits");
  const native = isNative(args.tokenOut);
  const out = native ? args.weth : args.tokenOut;
  const single = (splits as unknown[]).length === 1;
  const commands: number[] = [];
  const inputs: Hex[] = [];
  let total = 0n;

  const addr = (t: ApiToken | undefined): Address => {
    if (!t?.address || !isAddress(t.address, { strict: false })) bad("pool token is not an address");
    return getAddress(t!.address!);
  };
  const uint = (v: unknown, what: string): bigint => {
    if (typeof v !== "string" || !/^\d+$/.test(v)) bad(`${what} is not an integer`);
    return BigInt(v as string);
  };

  for (const split of splits as unknown[]) {
    if (!Array.isArray(split) || split.length === 0 || split.length > MAX_HOPS) bad("split has no pools or too many hops");
    const pools = split as ApiPool[];
    const kind = pools[0]!.type;
    if (kind !== "v3-pool" && kind !== "v2-pool") bad(`pool type ${String(kind)}`);
    if (pools.some((p) => p.type !== kind)) bad("mixed pool types in one split");
    const hops = pools.map((p) => ({ from: addr(p.tokenIn), to: addr(p.tokenOut), pool: p }));
    if (!isAddressEqual(hops[0]!.from, args.tokenIn)) bad("route does not start at tokenIn");
    if (!isAddressEqual(hops[hops.length - 1]!.to, out)) bad("route does not end at tokenOut");
    for (let i = 1; i < hops.length; i++) if (!isAddressEqual(hops[i - 1]!.to, hops[i]!.from)) bad("broken token chain");

    const splitIn = uint(pools[0]!.amountIn, "split amountIn");
    if (splitIn === 0n) bad("zero split");
    total += splitIn;
    const splitMin = single ? args.minOut : minOutFor(uint(pools[pools.length - 1]!.amountOut, "split amountOut"), args.slippageBps);
    const to = native ? UR_ADDRESS_THIS : args.recipient;
    // One split: its floor is the total (for native out, the UNWRAP_WETH below enforces it).
    // Several splits: each gets its own slippage floor, and the total is enforced after them.
    const floor = native && single ? 0n : splitMin;
    if (kind === "v3-pool") {
      const types: ("address" | "uint24")[] = ["address"];
      const values: (Address | number)[] = [hops[0]!.from];
      for (const h of hops) {
        const fee = Number(h.pool.fee);
        if (!Number.isInteger(fee) || fee <= 0 || fee >= 1 << 24) bad("v3 fee tier");
        types.push("uint24", "address");
        values.push(fee, h.to);
      }
      commands.push(UrCommand.V3_SWAP_EXACT_IN);
      inputs.push(encodeAbiParameters(V3_EXACT_IN_PARAMS, [to, splitIn, floor, encodePacked(types, values), true, []]));
    } else {
      const path = [hops[0]!.from, ...hops.map((h) => h.to)];
      commands.push(UrCommand.V2_SWAP_EXACT_IN);
      inputs.push(encodeAbiParameters(V2_EXACT_IN_PARAMS, [to, splitIn, floor, path, true, []]));
    }
  }
  if (total !== args.amountIn) bad("split amounts do not add up to amountIn");
  if (native) {
    commands.push(UrCommand.UNWRAP_WETH);
    inputs.push(encodeAbiParameters(RECIPIENT_AMOUNT, [args.recipient, args.minOut]));
  }
  return encodeFunctionData({
    abi: universalRouterAbi,
    functionName: "execute",
    args: [encodePacked(commands.map(() => "uint8" as const), commands), inputs, args.deadline],
  });
}

async function apiPost(params: SwapQuoteParams, stealthAddress: Address, path: string, body: unknown): Promise<unknown> {
  const f = params.fetch ?? ((globalThis as unknown as { fetch?: SwapFetch }).fetch as SwapFetch | undefined);
  if (!f) throw new SwapError("Soapay swap: no fetch available");
  const url = `${params.apiUrl ?? TRADING_API_URL}${path}`;
  const json = JSON.stringify(body);
  assertNoStealthAddress(stealthAddress, url, json);
  const res = await f(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
      // Omitted when calling through a backend proxy that adds the key itself.
      ...(params.apiKey ? { "x-api-key": params.apiKey } : {}),
      "x-universal-router-version": UNIVERSAL_ROUTER_VERSION,
      "x-agent-info": TRADING_API_AGENT_INFO,
    },
    body: json,
  });
  if (!res.ok && res.status === 503 && params.apiUrl) {
    const text = await res.text();
    if (text.includes('"uniswap_disabled"')) throw new SwapProxyDisabledError();
    throw new SwapUpstreamError(`Soapay swap: Trading API ${path} returned 503: ${text.slice(0, 300)}`);
  }
  if (!res.ok) {
    const msg = `Soapay swap: Trading API ${path} returned ${res.status}: ${(await res.text()).slice(0, 300)}`;
    throw res.status >= 500 ? new SwapUpstreamError(msg) : new SwapError(msg);
  }
  return res.json();
}

async function quoteViaTradingApi(params: SwapQuoteParams, r: Resolved): Promise<SwapQuote> {
  if (!params.apiKey && !params.apiUrl) throw new SwapError("Soapay swap: the Trading API needs apiKey, or apiUrl pointing at a proxy that adds it");
  const swapper = getAddress((params.placeholderSwapper ?? randomPlaceholderSwapper)());
  if (isAddressEqual(swapper, r.stealthAddress)) throw new SwapPrivacyError("Soapay swap: the placeholder swapper must not be the stealth address");
  const quoteRes = (await apiPost(params, r.stealthAddress, "/quote", {
    type: "EXACT_INPUT",
    amount: r.amountIn.toString(),
    tokenInChainId: r.chainId,
    tokenOutChainId: r.chainId,
    tokenIn: r.tokenIn,
    tokenOut: r.tokenOut,
    // A throwaway address: the quote only needs *a* swapper, and routing doesn't depend on it.
    swapper,
    slippageTolerance: r.slippageBps / 100,
    routingPreference: "BEST_PRICE",
    // AMM only (UniswapX orders aren't batchable calls), and only pools we can re-encode.
    protocols: [...TRADING_API_PROTOCOLS],
    generatePermitAsTransaction: true,
    permitAmount: "EXACT",
  })) as ApiQuoteResponse;

  if (quoteRes.routing !== "CLASSIC") throw new SwapError(`Soapay swap: unsupported routing ${quoteRes.routing}`);
  if (quoteRes.permitData) throw new SwapError("Soapay swap: quote requires a Permit2 signature; expected a permit transaction");
  const q = quoteRes.quote;
  if (!q?.output?.amount || !q.input?.amount) throw new SwapError("Soapay swap: malformed quote");
  if (BigInt(q.input.amount) !== r.amountIn) throw new SwapError("Soapay swap: quote input amount differs from the request");
  if (!q.output.token || !isAddressEqual(getAddress(q.output.token), r.tokenOut)) throw new SwapError("Soapay swap: quote output token differs");
  if (q.swapper && !isAddressEqual(getAddress(q.swapper), swapper)) throw new SwapError("Soapay swap: quote is for a different swapper");
  if (typeof q.slippage === "number" && Math.round(q.slippage * 100) > r.slippageBps) throw new SwapError("Soapay swap: quote slippage above request");
  const amountOut = BigInt(q.output.amount);
  if (amountOut === 0n) throw new SwapError("Soapay swap: no liquidity");
  const minOut = minOutFor(amountOut, r.slippageBps);

  // No `/swap`: its calldata would be built for (and name) the swapper. We encode the quoted route
  // with the stealth address as recipient, then run the same in-place check as any other calldata.
  const data = encodeQuotedRouteExactIn({
    route: q.route,
    tokenIn: r.tokenIn,
    tokenOut: r.tokenOut,
    weth: WETH_BASE,
    amountIn: r.amountIn,
    minOut,
    slippageBps: r.slippageBps,
    recipient: r.stealthAddress,
    deadline: r.deadline,
  });
  const swapCall = { to: r.router, value: 0n, data };
  assertSwapStaysInPlace({ chainId: r.chainId, stealthAddress: r.stealthAddress, tx: swapCall });

  return {
    source: "trading-api",
    chainId: r.chainId,
    stealthAddress: r.stealthAddress,
    tokenIn: r.tokenIn,
    tokenOut: r.tokenOut,
    amountIn: r.amountIn,
    amountOut,
    minOut,
    slippageBps: r.slippageBps,
    route: q.routeString ?? "trading-api",
    router: r.router,
    deadline: r.deadline,
    calls: await assembleCalls(r, swapCall, minOut, params.publicClient),
  };
}

/**
 * Quote a swap that stays inside `stealthAddress`. Returns the calls for one userOp; nothing is
 * signed or sent. Rejects any calldata that would pay a different address.
 *
 * Default source (D-27): the Trading API (placeholder swapper, route re-encoded here) on chains
 * where it routes and a key or proxy is set; otherwise, and whenever the API is unavailable or its
 * route can't be rebuilt exactly, the on-chain QuoterV2 + Universal Router path.
 */
export async function quoteSwapInPlace(params: SwapQuoteParams): Promise<SwapQuote> {
  const r = resolve(params);
  const source = params.source ?? defaultSwapSource(params);
  if (source !== "trading-api") return quoteViaUniversalRouter(params, r);
  try {
    return await quoteViaTradingApi(params, r);
  } catch (e) {
    // Fall back unless the caller forced the Trading API. Never on a privacy-guard failure.
    const recoverable = e instanceof SwapProxyDisabledError || e instanceof SwapRouteUnsupportedError || e instanceof SwapUpstreamError;
    if (recoverable && params.source === undefined) return quoteViaUniversalRouter(params, r);
    throw e;
  }
}

export type SwapInPlaceParams = Omit<SwapQuoteParams, "chainId" | "stealthAddress" | "publicClient"> & {
  stealthKey: Hex;
  /** Fee cap in USDC base units. Default 1 USDC. */
  maxFeeUsdc?: bigint;
};

export type SwapInPlaceResult = ExecuteResult & { quote: SwapQuote };

/**
 * Swap from one stealth address into another asset held by the SAME address: one 7702 userOp,
 * gas in USDC. Checks `amountIn + fee <= USDC balance` before signing.
 */
export async function swapInPlace(client: SpendClient, params: SwapInPlaceParams, options: SpendOptions = {}): Promise<SwapInPlaceResult> {
  const { stealthKey, maxFeeUsdc, ...rest } = params;
  const stealthAddress = privateKeyToAccount(stealthKey).address;
  const quote = await quoteSwapInPlace({ ...rest, chainId: client.chainId, stealthAddress, publicClient: client.publicClient });
  const feeToken = client.paymaster.feeToken(client.chainId);
  const result = await executeFromStealth(
    client,
    {
      stealthKey,
      calls: quote.calls,
      ...(maxFeeUsdc !== undefined ? { maxFeeUsdc } : {}),
      feeTokenSpend: isAddressEqual(quote.tokenIn, feeToken) ? quote.amountIn : 0n,
    },
    options,
  );
  return { ...result, quote };
}

