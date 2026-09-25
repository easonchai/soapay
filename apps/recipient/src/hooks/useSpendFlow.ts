import { useCallback, useRef, useState } from "react";
import { applySpend } from "@soapay/sdk";
import { isAddress, type Address } from "viem";
import { useServices } from "../services/ServicesProvider.js";
import { executeSpend, prepareSpend, replan, type SpendDraft, type SpendOutcome } from "../spend/flow.js";
import { errorMessage } from "../ui/kit.js";
import { parseUsdc } from "../ui/format.js";
import { useChain, useKeyRing } from "./useChain.js";
import { graphOf, useWallet } from "./useWallet.js";

export type SpendFlowState =
  | { step: "form"; error: string | null }
  | { step: "preparing" }
  | { step: "review"; draft: SpendDraft; override: boolean; error: string | null }
  | { step: "sending"; draft: SpendDraft; done: number; total: number }
  | { step: "result"; outcome: SpendOutcome };

/** Parses the spend form. Returns an error string, or the typed values. */
export function parseSpendForm(to: string, amount: string): { error: string } | { to: Address; amount: bigint } {
  const t = to.trim();
  if (!isAddress(t, { strict: false })) return { error: "Enter a valid 0x address." };
  const a = parseUsdc(amount);
  if (a === null) return { error: "Enter an amount in USDC, up to 6 decimals." };
  return { to: t as Address, amount: a };
}

/**
 * The whole spend UX as a state machine over spend/flow.ts: form → review (guard decision, override)
 * → sending (progress) → result (incl. partial failure). Any UI renders `state` and calls the actions.
 */
export function useSpendFlow() {
  const svc = useServices();
  const { state: chain, updateChain } = useChain();
  const ring = useKeyRing();
  const wallet = useWallet();
  const [state, setState] = useState<SpendFlowState>({ step: "form", error: null });
  const busy = useRef(false);

  const prepare = useCallback(
    async (to: string, amount: string) => {
      const parsed = parseSpendForm(to, amount);
      if ("error" in parsed) return setState({ step: "form", error: parsed.error });
      if (!svc.spend.ready) return setState({ step: "form", error: svc.spend.unavailableReason ?? "Sending isn't available." });
      setState({ step: "preparing" });
      try {
        const draft = await prepareSpend({
          graph: wallet.graph,
          balances: wallet.balances,
          state: chain,
          ring,
          spend: svc.spend,
          to: parsed.to,
          amount: parsed.amount,
        });
        setState({ step: "review", draft, override: false, error: null });
      } catch (e) {
        setState({ step: "form", error: errorMessage(e) });
      }
    },
    [svc.spend, wallet.graph, wallet.balances, chain, ring],
  );

  const setOverride = useCallback(
    (override: boolean) =>
      setState((s) => (s.step === "review" ? { ...s, override, draft: replan(wallet.graph, s.draft, override) } : s)),
    [wallet.graph],
  );

  const send = useCallback(async () => {
    if (state.step !== "review" || busy.current) return;
    const { draft } = state;
    busy.current = true;
    setState({ step: "sending", draft, done: 0, total: draft.allocation.parts.length });
    try {
      // Always link against the LATEST stored graph, not the one the draft was planned on.
      const outcome = await executeSpend({
        graph: graphOf(chain),
        draft,
        spend: svc.spend,
        onProgress: (done, total) => setState((s) => (s.step === "sending" ? { ...s, done, total } : s)),
      });
      await updateChain((latest) => {
        const sent = outcome.record.parts.map((p) => p.from);
        const g = sent.length > 0 && draft.plan ? applySpend(graphOf(latest), { ...draft.plan, from: sent }) : graphOf(latest);
        return { ...latest, graph: g.toJSON(), spends: [...(latest.spends ?? []), outcome.record] };
      });
      setState({ step: "result", outcome });
    } catch (e) {
      setState({ step: "review", draft, override: draft.plan?.override ?? false, error: errorMessage(e) });
    } finally {
      busy.current = false;
    }
  }, [state, chain, svc.spend, updateChain]);

  const reset = useCallback(() => setState({ step: "form", error: null }), []);

  return { state, prepare, setOverride, send, reset, ready: svc.spend.ready, unavailableReason: svc.spend.unavailableReason };
}
