// Executes one attempt of a run, chunk by chunk, reporting every state change so the
// record can be persisted (encrypted) and shown. Wallet and RPC calls are injected so
// this stays testable and path-agnostic.
//
// Failure semantics, chosen so a retry can never double-pay silently:
// - the wallet call throws before returning a hash/id → "failed" (never broadcast);
// - broadcast, then reverted/failed on-chain → "failed";
// - broadcast, outcome not known (timeout, dropped connection) → "unknown": no retry
//   until the employer rechecks it;
// - after the first failure the remaining chunks are not sent ("pending").
import type { Address, Hash } from "viem";
import {
  encodeBatchCalls,
  encodeStealthDisperseCalls,
  type PayRunCall,
} from "@soapay/sdk";
import type { Attempt, ChunkRecord, RunPlan, RunRecord, StepStatus } from "./run.js";

export type BatchOutcome = { status: "success" | "failure" | "pending"; txHash?: Hash };

export type ExecDeps = {
  sendTransaction(call: PayRunCall): Promise<Hash>;
  /** Resolves with the receipt status; throws if it can't tell (timeout, network). */
  waitForReceipt(hash: Hash): Promise<"success" | "reverted">;
  /** EIP-5792 wallet_sendCalls with atomic required; resolves with the batch id. */
  sendCalls(calls: PayRunCall[]): Promise<string>;
  waitForCalls(id: string): Promise<BatchOutcome>;
  readAllowance(owner: Address, spender: Address): Promise<bigint>;
  /** Delay between allowance re-reads after an approval lands (injectable for tests). */
  sleep?: (ms: number) => Promise<void>;
};

export function errorMessage(e: unknown): string {
  const err = e as { shortMessage?: string; message?: string; code?: number; name?: string };
  if (err?.code === 4001 || err?.name === "UserRejectedRequestError" || /user (rejected|denied)/i.test(err?.message ?? "")) {
    return "You rejected the request in your wallet";
  }
  return (err?.shortMessage ?? err?.message ?? String(e)).split("\n")[0] ?? "Unknown error";
}

type Update = (fn: (run: RunRecord) => RunRecord) => void;

function patchAttempt(run: RunRecord, index: number, fn: (a: Attempt) => Attempt): RunRecord {
  return { ...run, attempts: run.attempts.map((a) => (a.index === index ? fn(a) : a)) };
}

function patchChunk(
  run: RunRecord,
  attempt: number,
  chunk: number,
  patch: Partial<ChunkRecord>,
  opts: { clearError?: boolean } = {},
): RunRecord {
  return patchAttempt(run, attempt, (a) => ({
    ...a,
    chunks: a.chunks.map((c) => {
      if (c.index !== chunk) return c;
      const next: ChunkRecord = { ...c, ...patch };
      if (opts.clearError) delete next.error;
      return next;
    }),
  }));
}

export type ExecuteParams = {
  run: RunRecord;
  attemptIndex: number;
  plan: RunPlan;
  payer: Address;
  deps: ExecDeps;
  onChange: (run: RunRecord) => void;
};

/** Runs the attempt; resolves with the final record (never throws for wallet errors). */
export async function executeAttempt(p: ExecuteParams): Promise<RunRecord> {
  let run = p.run;
  const update: Update = (fn) => {
    run = fn(run);
    p.onChange(run);
  };
  const attempt = run.attempts.find((a) => a.index === p.attemptIndex);
  if (!attempt) throw new Error("Unknown attempt");
  if (attempt.chunks.length !== p.plan.chunks.length) throw new Error("Plan and record disagree");

  let chunkCalls: PayRunCall[][];
  let approveCall: PayRunCall | null = null;
  let total = 0n;
  if (run.path === "disperse") {
    if (!run.stealthDisperse) throw new Error("StealthDisperse address missing");
    const enc = encodeStealthDisperseCalls({ stealthDisperse: run.stealthDisperse, token: run.token, lines: p.plan.lines });
    chunkCalls = enc.pays.map((c) => [c]);
    approveCall = enc.approve;
    total = enc.total;
    if (enc.chunkSizes.join() !== attempt.chunks.map((c) => c.lines.length).join()) {
      throw new Error("Chunking mismatch between plan and calldata");
    }
  } else if (run.path === "batch") {
    const enc = encodeBatchCalls({ token: run.token, lines: p.plan.lines });
    chunkCalls = enc.map((c) => c.calls);
    if (enc.map((c) => c.calls.length / 2).join() !== attempt.chunks.map((c) => c.lines.length).join()) {
      throw new Error("Chunking mismatch between plan and calldata");
    }
  } else {
    throw new Error("Safe exports are not executed here");
  }

  // Exact-total approval (never max). Skipped only when the allowance already equals the total.
  if (approveCall && run.stealthDisperse) {
    let current: bigint | null = null;
    try {
      current = await p.deps.readAllowance(p.payer, run.stealthDisperse);
    } catch {
      current = null;
    }
    if (current === total) {
      update((r) => patchAttempt(r, p.attemptIndex, (a) => ({ ...a, approve: { amount: total, status: "skipped" } })));
    } else {
      update((r) => patchAttempt(r, p.attemptIndex, (a) => ({ ...a, approve: { amount: total, status: "signing" } })));
      let hash: Hash;
      try {
        hash = await p.deps.sendTransaction(approveCall);
      } catch (e) {
        const error = errorMessage(e);
        update((r) =>
          patchAttempt(r, p.attemptIndex, (a) => ({
            ...a,
            approve: { amount: total, status: "failed", error },
            chunks: a.chunks.map((c) => ({ ...c, error: "Not sent: the approval didn't go through" })),
          })),
        );
        return run;
      }
      update((r) => patchAttempt(r, p.attemptIndex, (a) => ({ ...a, approve: { amount: total, status: "confirming", txHash: hash } })));
      let status: StepStatus;
      let error: string | undefined;
      try {
        status = (await p.deps.waitForReceipt(hash)) === "success" ? "landed" : "failed";
        if (status === "failed") error = "Approval reverted";
      } catch (e) {
        status = "unknown";
        error = errorMessage(e);
      }
      update((r) =>
        patchAttempt(r, p.attemptIndex, (a) => ({
          ...a,
          approve: { amount: total, status, txHash: hash, ...(error ? { error } : {}) },
          chunks:
            status === "landed" ? a.chunks : a.chunks.map((c) => ({ ...c, error: "Not sent: the approval didn't confirm" })),
        })),
      );
      if (status !== "landed") return run;
      // Load-balanced public RPCs can serve a node that hasn't seen the approval yet, so `pay`
      // would fail gas estimation with "exceeds allowance". Wait until the allowance is visible.
      const sleep = p.deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
      for (let attempt = 0; attempt < 10; attempt++) {
        const seen = await p.deps.readAllowance(p.payer, run.stealthDisperse).catch(() => null);
        if (seen === null || seen >= total) break;
        await sleep(1_500);
      }
    }
  }

  for (let i = 0; i < chunkCalls.length; i++) {
    const calls = chunkCalls[i]!;
    update((r) => patchChunk(r, p.attemptIndex, i, { status: "signing" }));
    if (run.path === "disperse") {
      let hash: Hash;
      try {
        hash = await p.deps.sendTransaction(calls[0]!);
      } catch (e) {
        update((r) => patchChunk(r, p.attemptIndex, i, { status: "failed", error: errorMessage(e) }));
        markRestNotSent(update, p.attemptIndex, i);
        return run;
      }
      update((r) => patchChunk(r, p.attemptIndex, i, { status: "confirming", txHash: hash }));
      try {
        const s = await p.deps.waitForReceipt(hash);
        if (s === "success") {
          update((r) => patchChunk(r, p.attemptIndex, i, { status: "landed" }));
        } else {
          update((r) => patchChunk(r, p.attemptIndex, i, { status: "failed", error: "Transaction reverted" }));
          markRestNotSent(update, p.attemptIndex, i);
          return run;
        }
      } catch (e) {
        update((r) => patchChunk(r, p.attemptIndex, i, { status: "unknown", error: errorMessage(e) }));
        markRestNotSent(update, p.attemptIndex, i);
        return run;
      }
    } else {
      let id: string;
      try {
        id = await p.deps.sendCalls(calls);
      } catch (e) {
        update((r) => patchChunk(r, p.attemptIndex, i, { status: "failed", error: errorMessage(e) }));
        markRestNotSent(update, p.attemptIndex, i);
        return run;
      }
      update((r) => patchChunk(r, p.attemptIndex, i, { status: "confirming", callsId: id }));
      let out: BatchOutcome;
      try {
        out = await p.deps.waitForCalls(id);
      } catch (e) {
        out = { status: "pending" };
        update((r) => patchChunk(r, p.attemptIndex, i, { error: errorMessage(e) }));
      }
      if (out.status === "success") {
        update((r) =>
          patchChunk(r, p.attemptIndex, i, { status: "landed", ...(out.txHash ? { txHash: out.txHash } : {}) }, { clearError: true }),
        );
      } else {
        update((r) =>
          patchChunk(r, p.attemptIndex, i, {
            status: out.status === "failure" ? "failed" : "unknown",
            ...(out.txHash ? { txHash: out.txHash } : {}),
            ...(out.status === "failure" ? { error: "The batch failed; nothing in it was paid" } : {}),
          }),
        );
        markRestNotSent(update, p.attemptIndex, i);
        return run;
      }
    }
  }
  return run;
}

function markRestNotSent(update: Update, attempt: number, failedIndex: number): void {
  update((r) =>
    patchAttempt(r, attempt, (a) => ({
      ...a,
      chunks: a.chunks.map((c) =>
        c.index > failedIndex && c.status === "pending" ? { ...c, error: "Not sent: an earlier transaction didn't land" } : c,
      ),
    })),
  );
}

export type RecheckDeps = {
  getReceipt(hash: Hash): Promise<"success" | "reverted" | null>;
  getCallsStatus(id: string): Promise<BatchOutcome>;
};

/** Resolves "unknown" steps of the latest attempt from chain/wallet state. */
export async function recheckRun(run: RunRecord, deps: RecheckDeps): Promise<RunRecord> {
  const last = run.attempts[run.attempts.length - 1];
  if (!last) return run;
  let out = run;
  if (last.approve?.status === "unknown" && last.approve.txHash) {
    const s = await deps.getReceipt(last.approve.txHash).catch(() => null);
    if (s) {
      out = patchAttempt(out, last.index, (a) => ({
        ...a,
        approve: { ...a.approve!, status: s === "success" ? "landed" : "failed" },
      }));
    }
  }
  for (const c of last.chunks) {
    if (c.status !== "unknown") continue;
    if (c.txHash && !c.callsId) {
      const s = await deps.getReceipt(c.txHash).catch(() => null);
      if (s === "success") out = patchChunk(out, last.index, c.index, { status: "landed" }, { clearError: true });
      else if (s === "reverted") out = patchChunk(out, last.index, c.index, { status: "failed", error: "Transaction reverted" });
    } else if (c.callsId) {
      const s = await deps.getCallsStatus(c.callsId).catch((): BatchOutcome => ({ status: "pending" }));
      if (s.status === "success") {
        out = patchChunk(out, last.index, c.index, { status: "landed", ...(s.txHash ? { txHash: s.txHash } : {}) }, { clearError: true });
      } else if (s.status === "failure") {
        out = patchChunk(out, last.index, c.index, { status: "failed", error: "The batch failed; nothing in it was paid" });
      }
    }
  }
  return out;
}

/**
 * The employer checked their wallet activity and confirms an interrupted step with no
 * hash was never sent. Only valid for steps without a tx hash or batch id.
 */
export function confirmNotSent(run: RunRecord, chunkIndex: number): RunRecord {
  const last = run.attempts[run.attempts.length - 1]!;
  const c = last.chunks.find((x) => x.index === chunkIndex);
  if (!c || c.status !== "unknown" || c.txHash || c.callsId) throw new Error("Only an interrupted, unsent step can be marked as not sent");
  return patchChunk(run, last.index, chunkIndex, { status: "failed", error: "Not sent (confirmed by you)" });
}

/**
 * After a reload nothing is executing: steps caught mid-flight become "unknown"
 * (recheck or confirm), and unsent chunks are marked so the run can be retried.
 */
export function normalizeInterrupted(run: RunRecord): RunRecord {
  if (run.path === "safe-export") return run;
  const last = run.attempts[run.attempts.length - 1];
  if (!last) return run;
  const inflight = (s: string) => s === "signing" || s === "confirming";
  const touched = inflight(last.approve?.status ?? "") || last.chunks.some((c) => inflight(c.status) || (c.status === "pending" && !c.error));
  if (!touched) return run;
  return patchAttempt(run, last.index, (a) => ({
    ...a,
    ...(a.approve && inflight(a.approve.status)
      ? { approve: { ...a.approve, status: "unknown" as const, error: "Interrupted: the page was closed" } }
      : {}),
    chunks: a.chunks.map((c) =>
      inflight(c.status)
        ? { ...c, status: "unknown" as const, error: "Interrupted: the page was closed while this was in your wallet" }
        : c.status === "pending" && !c.error
          ? { ...c, error: "Not sent: the page was closed" }
          : c,
    ),
  }));
}
