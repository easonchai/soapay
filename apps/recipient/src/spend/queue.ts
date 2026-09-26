/**
 * The recipient's timing queue (D-28), framework-free. Scheduling, ordering and rounding live in the
 * SDK (`packages/sdk/src/queue.ts`); this file maps it onto the vault's ChainState: queue a guarded
 * spend or an exit's legs, record a queued spend once it lands (guard links, history), and reconcile
 * items whose outcome is known elsewhere (exit legs) or was lost (the tab closed mid-send).
 * `hooks/useQueue.tsx` runs it while the app is open.
 */
import {
  ClusterGraph,
  applySpend,
  emptyQueue,
  enqueue,
  settle,
  type QueueClock,
  type QueueItem,
  type QueueWindow,
  type SpendPlan,
  type SpendQueue,
  type SpendResult,
} from "@soapay/sdk";
import { getAddress } from "viem";
import type { ExitLeg, ExitRecord } from "../features/exit/types.js";
import type { ChainState, QueueMeta, Settings, SpendRecord } from "../vault/types.js";
import type { SpendDraft } from "./flow.js";

export type AppQueue = SpendQueue<QueueMeta>;
export type AppQueueItem = QueueItem<QueueMeta>;

const HOUR = 3_600_000;

export const queueOf = (s: Pick<ChainState, "queue">): AppQueue => s.queue ?? emptyQueue<QueueMeta>();

/** The window from Settings, clamped to sane values (0–168 h, min ≤ max). */
export function queueWindow(s: Partial<Pick<Settings, "queueWindowHours">>): QueueWindow {
  const [a, b] = s.queueWindowHours ?? [2, 12];
  const clamp = (x: number) => (Number.isFinite(x) ? Math.min(Math.max(x, 0), 168) : 0);
  const lo = clamp(a);
  const hi = Math.max(lo, clamp(b));
  return { minMs: lo * HOUR, maxMs: hi * HOUR };
}

/** Queues a guarded spend: one item per source address, each in its own window, in random order. */
export function enqueueSpend(state: ChainState, draft: SpendDraft, clock: QueueClock & { groupId: string }): ChainState {
  const plan = draft.plan;
  if (!plan) throw new Error("Not enough funds for this amount after fees.");
  if (plan.decision === "block") throw new Error("The privacy guard blocked this spend. Tick the override to send anyway.");
  const items = draft.allocation.parts.map((p) => ({
    groupId: clock.groupId,
    kind: "spend" as const,
    from: p.address,
    to: draft.to,
    amount: p.amount.toString(),
    meta: plan.override ? { override: "1" as const } : {},
  }));
  return { ...state, queue: enqueue(queueOf(state), items, clock) };
}

/** Queues each exit leg's first on-chain step (the burn, which leads to the pool deposit). */
export function enqueueExitLegs(queue: AppQueue, exitId: string, legs: readonly ExitLeg[], clock: QueueClock): AppQueue {
  return enqueue(
    queue,
    legs.map((l) => ({
      groupId: exitId,
      kind: "exit" as const,
      from: l.stealthAddress,
      to: l.destination,
      amount: l.amount,
      meta: { exitId, legId: l.id },
    })),
    clock,
  );
}

/** True while an exit leg waits for its window (the runner must not start it). */
export function isLegQueued(queue: AppQueue, legId: string): boolean {
  return queue.items.some((i) => i.kind === "exit" && i.meta?.legId === legId && i.status === "queued");
}

/**
 * Settles a released spend item: on success, links its source to the destination in the guard graph
 * (only what actually sent) and adds it to the local history.
 */
export function recordQueuedSend(
  state: ChainState,
  item: AppQueueItem,
  outcome: { ok: true; result: SpendResult } | { ok: false; error: string },
  now: number,
): ChainState {
  const queue = settle(queueOf(state), item.id, outcome.ok ? { ok: true, ...(outcome.result.txHash ? { txHash: outcome.result.txHash } : {}) } : { ok: false, error: outcome.error }, now);
  if (!outcome.ok) return { ...state, queue };
  const r = outcome.result;
  const graph = state.graph ? ClusterGraph.fromJSON(state.graph) : new ClusterGraph();
  // applySpend only reads from/to/decision; the guard allowed (or the user overrode) this at queue time.
  const plan = { from: [getAddress(r.from)], to: getAddress(item.to), decision: "allow", override: item.meta?.override === "1" } as unknown as SpendPlan;
  const record: SpendRecord = {
    at: now,
    to: getAddress(item.to),
    parts: [
      {
        from: getAddress(r.from),
        amount: (typeof r.amount === "bigint" ? r.amount : BigInt(item.amount)).toString(),
        userOpHash: r.userOpHash,
        ...(r.txHash ? { txHash: r.txHash } : {}),
      },
    ],
    override: plan.override,
  };
  return { ...state, queue, graph: applySpend(graph, plan).toJSON(), spends: [...(state.spends ?? []), record] };
}

/** Released exit items settle when their leg leaves "planned" (it burned) or fails. */
export function reconcileExits(queue: AppQueue, exits: readonly ExitRecord[], now: number): AppQueue {
  let q = queue;
  for (const i of queue.items) {
    if (i.kind !== "exit" || i.status !== "released") continue;
    const leg = exits.flatMap((r) => r.legs).find((l) => l.id === i.meta?.legId);
    if (!leg || leg.status === "planned") continue;
    q =
      leg.status === "failed"
        ? settle(q, i.id, { ok: false, error: leg.error ?? "The exit leg failed." }, now)
        : settle(q, i.id, { ok: true, ...(leg.txs.burn ? { txHash: leg.txs.burn } : {}) }, now);
  }
  return q;
}

/** How long a released spend may stay unsettled before we assume the tab closed mid-send. */
export const INTERRUPTED_AFTER_MS = 10 * 60_000;

/**
 * A spend released in an earlier session that never settled: the userOp may or may not have landed.
 * Mark it failed with advice; Retry re-queues it, and a rescan shows whether the balance moved.
 */
export function markInterrupted(queue: AppQueue, now: number, inFlight: ReadonlySet<string>): AppQueue {
  let q = queue;
  for (const i of queue.items) {
    if (i.kind !== "spend" || i.status !== "released" || inFlight.has(i.id)) continue;
    if (now - (i.releasedAt ?? 0) < INTERRUPTED_AFTER_MS) continue;
    q = settle(q, i.id, { ok: false, error: "Interrupted before it confirmed. Rescan: if the balance is still there, retry." }, now);
  }
  return q;
}
