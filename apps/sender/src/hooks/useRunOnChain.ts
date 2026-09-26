// Reads a run's landed transactions and rebuilds what the chain shows (D-41). Read-only; the result is
// displayed next to the record, never used to pay.
import { useQuery } from "@tanstack/react-query";
import { useConfig } from "wagmi";
import { getTransactionReceipt } from "wagmi/actions";
import { payRunBatchFromReceipt, type BatchReceipt } from "@soapay/sdk";
import { landedTxs, onChainRows, plannedRows, type OnChainRow } from "../lib/onchain.js";
import type { RunRecord } from "../lib/run.js";

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
  const config = useConfig();
  const txs = run ? landedTxs(run) : [];
  const q = useQuery({
    queryKey: ["run-onchain", run?.chainId, run?.token, txs],
    enabled: !!run && txs.length > 0,
    staleTime: Infinity, // receipts don't change once mined
    queryFn: async () =>
      Promise.all(
        txs.map(async (hash) => {
          const r = await getTransactionReceipt(config, { chainId: run!.chainId, hash });
          return payRunBatchFromReceipt(r as unknown as BatchReceipt, { token: run!.token });
        }),
      ),
  });
  return {
    rows: run && q.data ? onChainRows(run, q.data) : [],
    planned: run ? plannedRows(run) : [],
    landed: txs.length,
    loading: q.isLoading && txs.length > 0,
    error: q.error ? (q.error instanceof Error ? q.error.message.split("\n")[0]! : String(q.error)) : null,
  };
}
