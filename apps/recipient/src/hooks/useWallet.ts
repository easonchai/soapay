import { useMemo } from "react";
import { ClusterGraph, balanceView, type BalanceView, type LedgerEntry } from "@soapay/sdk";
import type { Address } from "viem";
import { balanceMap, ledgerFromState } from "../scan/scanner.js";
import { useServices } from "../services/ServicesProvider.js";
import type { ChainState, SpendRecord, ConvertRecord } from "../vault/types.js";
import { useChain } from "./useChain.js";

export type Wallet = {
  /** One row per stealth address, amounts from real balances only. */
  ledger: LedgerEntry[];
  /** Balances grouped by guard cluster. */
  view: BalanceView;
  balances: Map<Address, bigint>;
  graph: ClusterGraph;
  total: bigint;
  state: ChainState;
  spends: SpendRecord[];
  conversions: ConvertRecord[];
  payerName(address: Address | null): string | null;
};

export function graphOf(state: ChainState): ClusterGraph {
  return state.graph ? ClusterGraph.fromJSON(state.graph) : new ClusterGraph();
}

/** Derived, read-only wallet view of the active chain. Pure derivations over the stored state. */
export function useWallet(): Wallet {
  const svc = useServices();
  const { state, settings } = useChain();
  const payers = settings.knownPayers;
  return useMemo(() => {
    const ledger = ledgerFromState(state, payers.map((p) => p.address), svc.stealthDisperse);
    const balances = balanceMap(state);
    const graph = graphOf(state);
    const view = balanceView(graph, balances);
    const names = new Map(payers.map((p) => [p.address.toLowerCase(), p.name]));
    return {
      ledger,
      view,
      balances,
      graph,
      total: view.total,
      state,
      spends: [...(state.spends ?? [])].reverse(),
      conversions: [...(state.conversions ?? [])].reverse(),
      payerName: (a) => (a ? (names.get(a.toLowerCase()) ?? null) : null),
    };
  }, [state, payers, svc.stealthDisperse]);
}
