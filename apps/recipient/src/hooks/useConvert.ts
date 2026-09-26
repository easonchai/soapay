import { useCallback, useMemo, useState } from "react";
import { getAddress, type Address } from "viem";
import { checkQuote, convertTargets, validateConvert, type SwapQuote } from "../features/convert/swap.js";
import { useServices } from "../services/ServicesProvider.js";
import { stealthKeyFor } from "../spend/flow.js";
import { errorMessage } from "../ui/kit.js";
import { parseUsdc } from "../ui/format.js";
import { useChain, useKeyRing } from "./useChain.js";
import { useWallet } from "./useWallet.js";

export type ConvertState =
  | { step: "form"; error: string | null }
  | { step: "quoting" }
  | { step: "review"; quote: SwapQuote; symbol: string; error: string | null }
  | { step: "swapping"; quote: SwapQuote; symbol: string }
  | { step: "done"; quote: SwapQuote; symbol: string; txHash?: string };

export const DEFAULT_SLIPPAGE_BPS = 50;

/**
 * Convert part of ONE stealth address's USDC into another asset kept in that same address. Never
 * touches a second address, so it needs no guard decision.
 */
export function useConvert() {
  const svc = useServices();
  const { chainId, state: chain, updateChain } = useChain();
  const ring = useKeyRing();
  const wallet = useWallet();
  const [state, setState] = useState<ConvertState>({ step: "form", error: null });
  const targets = useMemo(() => convertTargets(), []);
  const sources = useMemo(() => [...wallet.balances.entries()].sort((a, b) => (a[1] < b[1] ? 1 : -1)), [wallet.balances]);

  const quote = useCallback(
    async (form: { from: string; amount: string; tokenOut: string; slippageBps: number }) => {
      const amountIn = parseUsdc(form.amount);
      const from = form.from ? getAddress(form.from) : null;
      const balance = from ? (wallet.balances.get(from) ?? 0n) : null;
      const err = from ? validateConvert({ amountIn, balance, slippageBps: form.slippageBps, tokenOut: form.tokenOut, chainId }) : "Pick an address to convert from.";
      if (err) return setState({ step: "form", error: err });
      if (!svc.swap.ready) return setState({ step: "form", error: svc.swap.unavailableReason ?? "Converting isn't available." });
      setState({ step: "quoting" });
      try {
        const stealthKey = stealthKeyFor(chain, ring, from!);
        const req = { stealthKey, tokenOut: getAddress(form.tokenOut), amountIn: amountIn!, slippageBps: form.slippageBps };
        const q = await svc.swap.quote(req);
        const bad = checkQuote(q, { stealthAddress: from!, amountIn: amountIn!, tokenOut: req.tokenOut, slippageBps: req.slippageBps });
        if (bad) return setState({ step: "form", error: bad });
        const symbol = targets.find((t) => t.address === req.tokenOut)?.symbol ?? "token";
        setState({ step: "review", quote: q, symbol, error: null });
      } catch (e) {
        setState({ step: "form", error: errorMessage(e) });
      }
    },
    [wallet.balances, chainId, svc.swap, chain, ring, targets],
  );

  const confirm = useCallback(async () => {
    if (state.step !== "review") return;
    const { quote: q, symbol } = state;
    setState({ step: "swapping", quote: q, symbol });
    try {
      const stealthKey = stealthKeyFor(chain, ring, q.stealthAddress as Address);
      const res = await svc.swap.swap({ stealthKey, tokenOut: q.tokenOut, amountIn: q.amountIn, slippageBps: q.slippageBps });
      await updateChain((latest) => ({
        ...latest,
        conversions: [
          ...(latest.conversions ?? []),
          {
            at: Date.now(),
            address: res.from,
            amountIn: res.quote.amountIn.toString(),
            tokenOut: res.quote.tokenOut,
            symbol,
            amountOut: res.quote.amountOut.toString(),
            minOut: res.quote.minOut.toString(),
            userOpHash: res.userOpHash,
            ...(res.txHash ? { txHash: res.txHash } : {}),
          },
        ],
      }));
      setState({ step: "done", quote: res.quote, symbol, ...(res.txHash ? { txHash: res.txHash } : {}) });
    } catch (e) {
      setState({ step: "review", quote: q, symbol, error: errorMessage(e) });
    }
  }, [state, chain, ring, svc.swap, updateChain]);

  return {
    state,
    targets,
    sources,
    route: svc.swap.route,
    ready: svc.swap.ready,
    unavailableReason: svc.swap.unavailableReason,
    quote,
    confirm,
    reset: () => setState({ step: "form", error: null }),
  };
}
