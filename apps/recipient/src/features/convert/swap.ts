/**
 * Convert-in-place seam (docs/mvp-spec.md §6): swap part of ONE stealth address's USDC into another
 * asset that stays in the SAME address. One 7702 userOp (approve + swap), gas in USDC via the paymaster.
 * No funds move between addresses, so no clusters merge and the guard has nothing to decide.
 *
 * The SDK functions `quoteSwapInPlace` / `swapInPlace` (packages/sdk/src/swap.ts) are not in this tree
 * yet. The types below mirror their exact signatures.
 * TODO(swap): when swap.ts is exported from @soapay/sdk, make `loadSdkSwap` return
 *     { quoteSwapInPlace, swapInPlace }   (imported from "@soapay/sdk")
 * and delete the mirrored types in favour of the SDK's `SwapQuoteParams`, `SwapQuote`,
 * `SwapInPlaceParams`, `SwapInPlaceResult`.
 */
import { createSpendClient, type SpendClient, type SpendOptions } from "@soapay/sdk";
import { zeroAddress, type Address, type Chain, type Hex, type PublicClient, type Transport } from "viem";
import { privateKeyToAccount } from "viem/accounts";

// ---- Mirrors of packages/sdk/src/swap.ts ------------------------------------------------------

export const NATIVE_ETH: Address = zeroAddress;
export const WETH_BASE: Address = "0x4200000000000000000000000000000000000006";
/** The SDK rejects slippage above this. */
export const MAX_SLIPPAGE_BPS = 500;

export type SwapSource = "trading-api" | "universal-router";

export type SwapQuoteParams = {
  chainId: number;
  /** Must be the address that holds the funds; the SDK throws SwapRecipientError otherwise. */
  stealthAddress: Address;
  /** Defaults to the chain's USDC. */
  tokenIn?: Address;
  tokenOut: Address;
  amountIn: bigint;
  slippageBps: number;
  /** Uniswap Trading API key. Without it the SDK routes via the Universal Router V3 fallback. */
  apiKey?: string;
  source?: SwapSource;
  publicClient?: PublicClient<Transport, Chain>;
};

export type SwapQuote = {
  source: SwapSource;
  chainId: number;
  stealthAddress: Address;
  tokenIn: Address;
  tokenOut: Address;
  amountIn: bigint;
  amountOut: bigint;
  minOut: bigint;
  slippageBps: number;
  route: string;
  router: Address;
  deadline: bigint;
};

export type SwapInPlaceParams = Omit<SwapQuoteParams, "chainId" | "stealthAddress" | "publicClient"> & {
  stealthKey: Hex;
  /** Fee cap in USDC base units. Default 1 USDC. */
  maxFeeUsdc?: bigint;
};

export type SwapInPlaceResult = { from: Address; userOpHash: Hex; txHash?: Hex; quote: SwapQuote };

export type SdkSwap = {
  quoteSwapInPlace(params: SwapQuoteParams): Promise<SwapQuote>;
  swapInPlace(client: SpendClient, params: SwapInPlaceParams, options?: SpendOptions): Promise<SwapInPlaceResult>;
};

export function loadSdkSwap(): SdkSwap | null {
  return null; // TODO(swap): return { quoteSwapInPlace, swapInPlace } from "@soapay/sdk"
}

// ---- App-facing service -----------------------------------------------------------------------

export type ConvertRequest = { stealthKey: Hex; tokenOut: Address; amountIn: bigint; slippageBps: number };

export interface SwapService {
  readonly ready: boolean;
  readonly unavailableReason?: string;
  quote(req: ConvertRequest): Promise<SwapQuote>;
  swap(req: ConvertRequest): Promise<SwapInPlaceResult>;
}

export function unavailableSwapService(reason: string): SwapService {
  return {
    ready: false,
    unavailableReason: reason,
    quote: () => Promise.reject(new Error(reason)),
    swap: () => Promise.reject(new Error(reason)),
  };
}

export function createSdkSwapService(opts: {
  chainId: number;
  bundlerUrl: string;
  publicClient: PublicClient<Transport, Chain>;
  /** Optional (VITE_UNISWAP_API_KEY or Settings). */
  apiKey: string;
  sdk?: SdkSwap | null;
}): SwapService {
  const sdk = opts.sdk === undefined ? loadSdkSwap() : opts.sdk;
  if (!sdk) return unavailableSwapService("Converting isn't in this build yet (the SDK swap module hasn't landed).");
  if (!opts.bundlerUrl) return unavailableSwapService("Add a bundler URL in Settings to convert.");
  let client: SpendClient | null = null;
  const spendClient = () =>
    (client ??= createSpendClient({ chainId: opts.chainId, bundlerUrl: opts.bundlerUrl, publicClient: opts.publicClient }));
  const key = opts.apiKey ? { apiKey: opts.apiKey } : {};
  return {
    ready: true,
    quote: (r) =>
      sdk.quoteSwapInPlace({
        chainId: opts.chainId,
        stealthAddress: privateKeyToAccount(r.stealthKey).address,
        tokenOut: r.tokenOut,
        amountIn: r.amountIn,
        slippageBps: r.slippageBps,
        publicClient: opts.publicClient,
        ...key,
      }),
    swap: (r) =>
      sdk.swapInPlace(
        spendClient(),
        { stealthKey: r.stealthKey, tokenOut: r.tokenOut, amountIn: r.amountIn, slippageBps: r.slippageBps, ...key },
        { wait: true },
      ),
  };
}
