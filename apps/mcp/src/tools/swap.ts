/**
 * `swap_in_place`: swap USDC held by ONE stealth address into another asset kept by the same
 * address (SDK `quoteSwapInPlace`, routed through `${API_URL}/uniswap`; one 7702 userOp, gas
 * in USDC). Links nothing, so the guard isn't involved; the per-call cap still applies.
 */
import { getAddress, isAddress, type Address } from "viem";
import { MAX_SLIPPAGE_BPS, NATIVE_ETH, type AnnouncementRecord } from "@soapay/sdk";
import type { Ctx } from "../context.js";
import { errorMessage, formatUsdc, parseUsdc, ToolError } from "../util.js";
import { collect, stealthKeyFor } from "./receive.js";

export type SwapInput = {
  tokenOut?: string | undefined;
  amount?: string | number | undefined;
  slippage_bps?: number | undefined;
  dry_run?: boolean | undefined;
  confirm?: string | undefined;
};

type SwapPlan = { stealthAddress: Address; announcement: AnnouncementRecord; tokenOut: Address; amountIn: bigint; slippageBps: number; minOut: bigint };

/** Rough fee headroom for picking a source address; the real fee is checked by the SDK. */
const FEE_HEADROOM = 200_000n; // 0.2 USDC

function parseTokenOut(v: string): Address {
  const s = v.trim();
  if (/^(eth|native)$/i.test(s)) return NATIVE_ETH;
  if (isAddress(s, { strict: false })) return getAddress(s);
  throw new ToolError("invalid_token", 'tokenOut must be "ETH" or a token address');
}

export async function swapInPlace(ctx: Ctx, input: SwapInput) {
  const now = ctx.now();
  if (input.confirm) {
    const plan = ctx.plans.take<SwapPlan>(input.confirm, "swap", now);
    ctx.caps.check(plan.amountIn, now, { daily: false });
    const stealthKey = stealthKeyFor(ctx, plan.announcement);
    let quote;
    try {
      quote = await ctx.chain.quoteSwap({ stealthAddress: plan.stealthAddress, tokenOut: plan.tokenOut, amountIn: plan.amountIn, slippageBps: plan.slippageBps });
    } catch (e) {
      throw new ToolError("quote_failed", `re-quote failed: ${errorMessage(e)}`);
    }
    // Never execute below the floor the dry run showed.
    if (quote.minOut < plan.minOut) {
      throw new ToolError("price_moved", "the price moved below the dry run's minimum output; nothing was sent. Make a new dry run.", {
        plannedMinOut: plan.minOut.toString(),
        nowMinOut: quote.minOut.toString(),
      });
    }
    try {
      const r = await ctx.chain.execute({ stealthKey, calls: quote.calls, feeTokenSpend: plan.amountIn });
      return { ok: true, from: r.from, userOpHash: r.userOpHash, txHash: r.txHash ?? null, amountInUsdc: formatUsdc(plan.amountIn), tokenOut: plan.tokenOut, amountOut: quote.amountOut, minOut: quote.minOut, route: quote.route };
    } catch (e) {
      throw new ToolError("swap_failed", `swap failed: ${errorMessage(e)}`);
    }
  }

  if (!input.tokenOut || input.amount === undefined) throw new ToolError("invalid_input", "give `tokenOut` and `amount` for a dry run, or `confirm: <planId>`");
  const tokenOut = parseTokenOut(input.tokenOut);
  const amountIn = parseUsdc(input.amount);
  const slippageBps = input.slippage_bps ?? 50;
  if (slippageBps < 0 || slippageBps > MAX_SLIPPAGE_BPS) throw new ToolError("invalid_input", `slippage_bps must be 0-${MAX_SLIPPAGE_BPS}`);
  ctx.caps.check(amountIn, now, { daily: false });
  if (tokenOut.toLowerCase() === ctx.chain.usdc.toLowerCase()) throw new ToolError("invalid_token", "tokenOut is USDC already");

  const { holdings } = await collect(ctx);
  // One address pays and receives: the smallest one that covers amount + fee headroom.
  const source = holdings.filter((h) => h.balance >= amountIn + FEE_HEADROOM).sort((a, b) => (a.balance < b.balance ? -1 : a.balance > b.balance ? 1 : 0))[0];
  if (!source) {
    throw new ToolError("insufficient_funds", `no single received address holds ${formatUsdc(amountIn)} USDC plus fees; swaps never combine addresses`);
  }
  let quote;
  try {
    quote = await ctx.chain.quoteSwap({ stealthAddress: source.stealthAddress, tokenOut, amountIn, slippageBps });
  } catch (e) {
    throw new ToolError("quote_failed", `quote failed: ${errorMessage(e)}`);
  }
  const plan: SwapPlan = { stealthAddress: source.stealthAddress, announcement: source.announcement, tokenOut, amountIn, slippageBps, minOut: quote.minOut };
  const { planId, expiresAt } = ctx.plans.create("swap", plan, now);
  return {
    planId,
    expiresAt,
    confirmWith: { confirm: planId },
    stealthAddress: source.stealthAddress,
    amountInUsdc: formatUsdc(amountIn),
    tokenOut,
    amountOut: quote.amountOut,
    minOut: quote.minOut,
    route: quote.route,
    source: quote.source,
    note: "Nothing was sent. The output stays in the same stealth address. Confirm within 10 minutes.",
  };
}
