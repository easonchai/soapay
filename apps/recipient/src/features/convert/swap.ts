/**
 * Convert in place (docs/mvp-spec.md §6): swap part of ONE stealth address's USDC into another asset
 * that stays in the SAME address. One 7702 userOp (approve + swap + balance guard), gas in USDC via the
 * paymaster. No funds move between addresses, so no clusters merge and the guard has nothing to decide.
 *
 * All swap logic is the SDK's (`quoteSwapInPlace` / `swapInPlace`, packages/sdk/src/swap.ts). Routing:
 * - `proxyUrl` set (default `${VITE_API_URL}/uniswap`): Trading API through the Soapay API proxy, which
 *   adds UNISWAP_API_KEY server-side. The key never ships in this bundle.
 * - no proxy: the SDK's Universal Router V3 fallback, priced by QuoterV2 over the public client.
 */
import {
  MAX_SLIPPAGE_BPS,
  NATIVE_ETH,
  WETH_BASE,
  createSpendClient,
  getChainConfig,
  quoteSwapInPlace,
  swapInPlace,
  type SpendClient,
  type SwapFetch,
  type SwapInPlaceResult,
  type SwapQuote,
} from "@soapay/sdk";
import { getAddress, isAddress, type Address, type Chain, type Hex, type PublicClient, type Transport } from "viem";
import { privateKeyToAccount } from "viem/accounts";

export { MAX_SLIPPAGE_BPS, NATIVE_ETH, WETH_BASE, type SwapInPlaceResult, type SwapQuote };

export type ConvertRequest = { stealthKey: Hex; tokenOut: Address; amountIn: bigint; slippageBps: number };

export interface SwapService {
  readonly ready: boolean;
  readonly unavailableReason?: string;
  /** "trading-api (proxy)" or "universal-router", for display. */
  readonly route: string;
  quote(req: ConvertRequest): Promise<SwapQuote>;
  swap(req: ConvertRequest): Promise<SwapInPlaceResult>;
}

export function unavailableSwapService(reason: string): SwapService {
  return {
    ready: false,
    unavailableReason: reason,
    route: "none",
    quote: () => Promise.reject(new Error(reason)),
    swap: () => Promise.reject(new Error(reason)),
  };
}

export type ConvertTarget = { symbol: string; address: Address; decimals: number };

/** Assets offered in the UI. USDC is the input, so it is never a target. */
export function convertTargets(): ConvertTarget[] {
  return [
    { symbol: "ETH", address: NATIVE_ETH, decimals: 18 },
    { symbol: "WETH", address: WETH_BASE, decimals: 18 },
  ];
}

export type ConvertInput = { amountIn: bigint | null; balance: bigint | null; slippageBps: number; tokenOut: string; chainId: number };

/** Validates a convert form before quoting. Returns a user-facing error, or null when OK. */
export function validateConvert(i: ConvertInput): string | null {
  if (i.amountIn === null || i.amountIn <= 0n) return "Enter an amount above zero.";
  if (i.balance !== null && i.amountIn >= i.balance) return "Leave some USDC in the address to pay the network fee.";
  if (!Number.isInteger(i.slippageBps) || i.slippageBps <= 0) return "Slippage must be a positive number of basis points.";
  if (i.slippageBps > MAX_SLIPPAGE_BPS) return `Slippage can't exceed ${MAX_SLIPPAGE_BPS / 100}%.`;
  if (!isAddress(i.tokenOut, { strict: false })) return "Pick an asset to convert to.";
  if (getAddress(i.tokenOut) === getAddress(getChainConfig(i.chainId).usdc)) return "That's already USDC.";
  return null;
}

/**
 * Sanity checks on a quote before the user can confirm it. The SDK already rejects quotes that pay
 * anyone but the stealth address; these catch a quote that doesn't match what the user asked for.
 */
export function checkQuote(q: SwapQuote, req: { stealthAddress: Address; amountIn: bigint; tokenOut: Address; slippageBps: number }): string | null {
  if (getAddress(q.stealthAddress) !== getAddress(req.stealthAddress)) return "The quote is for a different address.";
  if (q.amountIn !== req.amountIn) return "The quote is for a different amount.";
  if (getAddress(q.tokenOut) !== getAddress(req.tokenOut)) return "The quote is for a different asset.";
  if (q.slippageBps > req.slippageBps) return "The quote allows more slippage than you set.";
  if (q.amountOut <= 0n || q.minOut <= 0n || q.minOut > q.amountOut) return "The quote's output looks wrong. Try again.";
  return null;
}

export function createSdkSwapService(opts: {
  chainId: number;
  bundlerUrl: string;
  publicClient: PublicClient<Transport, Chain>;
  /** Trading API proxy (adds the API key server-side). Empty = Universal Router fallback. */
  proxyUrl: string;
  fetch?: SwapFetch;
}): SwapService {
  if (!opts.bundlerUrl) return unavailableSwapService("Add a bundler URL in Settings to convert.");
  let client: SpendClient | null = null;
  const spendClient = () =>
    (client ??= createSpendClient({ chainId: opts.chainId, bundlerUrl: opts.bundlerUrl, publicClient: opts.publicClient }));
  const proxyUrl = opts.proxyUrl.replace(/\/+$/, "");
  // With a proxy the SDK picks the Trading API and falls back to the Universal Router by itself when
  // the proxy answers 503 `uniswap_disabled` (no key configured). No `source`, or that fallback is off.
  const routing = proxyUrl ? { apiUrl: proxyUrl, ...(opts.fetch ? { fetch: opts.fetch } : {}) } : { source: "universal-router" as const };
  return {
    ready: true,
    route: proxyUrl ? "Uniswap Trading API (via Soapay API)" : "Uniswap Universal Router (direct)",
    quote: (r) =>
      quoteSwapInPlace({
        chainId: opts.chainId,
        stealthAddress: privateKeyToAccount(r.stealthKey).address,
        tokenOut: r.tokenOut,
        amountIn: r.amountIn,
        slippageBps: r.slippageBps,
        publicClient: opts.publicClient,
        ...routing,
      }),
    swap: (r) =>
      swapInPlace(
        spendClient(),
        { stealthKey: r.stealthKey, tokenOut: r.tokenOut, amountIn: r.amountIn, slippageBps: r.slippageBps, ...routing },
        { wait: true },
      ),
  };
}
