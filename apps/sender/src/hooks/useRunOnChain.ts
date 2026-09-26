// Reads a run's landed transactions and rebuilds what the chain shows (D-41). Read-only; the result is
// displayed next to the record, never used to pay.
import { useQuery } from "@tanstack/react-query";
import { useConfig } from "wagmi";
import { getTransactionReceipt } from "wagmi/actions";
import { payRunBatchFromReceipt, type BatchReceipt } from "@soapay/sdk";
import { demoBatches, landedTxs, onChainRows, plannedRows, type OnChainRow } from "../lib/onchain.js";
import type { RunRecord } from "../lib/run.js";
import { useStore } from "./store.js";

export type RunOnChain = {
  /** Lines as the chain shows them, one per Announcement in each landed tx. */
  rows: OnChainRow[];
  /** Planned lines, shown as a preview only when nothing has landed. */
  planned: ReturnType<typeof plannedRows>;
  landed: number;
  loading: boolean;
  error: string | null;
};

export function useRunOnChain(run: RunRecord | undefined): RunOnChain {
  const { app } = useStore();
  const config = useConfig();
  const txs = run ? landedTxs(run) : [];
  const q = useQuery({
    queryKey: ["run-onchain", run?.chainId, run?.token, txs],
    // Demo: no chain to read; the landed lines are rebuilt from the record itself (demoBatches).
    enabled: !!run && txs.length > 0 && !app.demo,
    staleTime: Infinity, // receipts don't change once mined
    queryFn: async () =>
      Promise.all(
        txs.map(async (hash) => {
          const r = await getTransactionReceipt(config, { chainId: run!.chainId, hash });
          return payRunBatchFromReceipt(r as unknown as BatchReceipt, { token: run!.token });
        }),
      ),
  });
  const batches = app.demo && run ? demoBatches(run) : q.data;
  return {
    rows: run && batches ? onChainRows(run, batches) : [],
    planned: run ? plannedRows(run) : [],
    landed: txs.length,
    loading: !app.demo && q.isLoading && txs.length > 0,
    error: q.error ? (q.error instanceof Error ? q.error.message.split("\n")[0]! : String(q.error)) : null,
  };
}
