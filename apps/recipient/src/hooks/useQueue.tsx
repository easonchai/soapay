/**
 * Timing queue driver (D-28). While the vault is unlocked it wakes on an interval and when the tab
 * comes back into view, and releases at most ONE due item per window: a queued Send is signed and
 * sent here (keys derived on the spot, never stored); a queued exit deposit is only released, and
 * ExitProvider's runner starts that leg. The queue itself lives in the encrypted vault
 * (ChainState.queue), so it survives reloads and locks. No server holds anything.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  SpendManyError,
  cancel as cancelItems,
  lockedAddresses,
  nextDue,
  nextWindowAt,
  pendingItems,
  release,
  requeue,
  windowOpensAt,
  type QueueWindow,
  type SpendParams,
} from "@soapay/sdk";
import { useServices } from "../services/ServicesProvider.js";
import { stealthKeyFor } from "../spend/flow.js";
import {
  markInterrupted,
  queueOf,
  queueWindow,
  recordQueuedSend,
  reconcileExits,
  type AppQueue,
  type AppQueueItem,
} from "../spend/queue.js";
import { errorMessage } from "../ui/kit.js";
import { useUnlocked } from "../vault/VaultProvider.js";
import { chainState, settingsOf } from "../vault/types.js";
import { useChain, useKeyRing } from "./useChain.js";

export type QueueApi = {
  /** Queued and in-flight items, soonest first, each with the time its window opens. */
  pending: (AppQueueItem & { opensAt: number })[];
  /** Recently settled items, newest first (failed ones can be retried). */
  recent: AppQueueItem[];
  /** When the next item may go, or null when nothing is queued. */
  nextAt: number | null;
  /** Lower-cased stealth addresses held by the queue: not available as new sources. */
  locked: ReadonlySet<string>;
  window: QueueWindow;
  /** An item is being sent right now. */
  sending: boolean;
  error: string | null;
  tick(): Promise<void>;
  /** The explicit override: send every queued item of this group now (links them by timing). */
  sendNow(groupId: string): Promise<void>;
  cancel(id: string): Promise<void>;
  retry(id: string): Promise<void>;
};

const QueueContext = createContext<QueueApi | null>(null);

const RECENT = 5;

export function QueueProvider({ children, pollMs = 30_000, random }: { children: ReactNode; pollMs?: number; random?: () => number }) {
  const v = useUnlocked();
  const svc = useServices();
  const { chainId, state, updateChain } = useChain();
  const ring = useKeyRing();
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dataRef = useRef(v.data);
  dataRef.current = v.data;
  const running = useRef(false);
  const inFlight = useRef(new Set<string>());
  const qw = queueWindow(settingsOf(v.data));
  const clock = useCallback(() => ({ now: Date.now(), window: queueWindow(settingsOf(dataRef.current)), ...(random ? { random } : {}) }), [random]);

  const setQueue = useCallback(
    (fn: (q: AppQueue) => AppQueue) => updateChain((s) => ({ ...s, queue: fn(queueOf(s)) })),
    [updateChain],
  );

  /** Signs and sends released spend items in order; settles each as it lands. */
  const sendItems = useCallback(
    async (items: AppQueueItem[]) => {
      if (items.length === 0) return;
      items.forEach((i) => inFlight.current.add(i.id));
      setSending(true);
      try {
        const latest = chainState(dataRef.current, chainId);
        const params: SpendParams[] = items.map((i) => ({ stealthKey: stealthKeyFor(latest, ring, i.from), to: i.to, amount: BigInt(i.amount) }));
        const results = await svc.spend.sendAll(params);
        await updateChain((s) => items.reduce((acc, it, k) => recordQueuedSend(acc, it, { ok: true, result: results[k]! }, Date.now()), s));
        setError(null);
      } catch (e) {
        const done = e instanceof SpendManyError ? e.completed : [];
        const failedAt = e instanceof SpendManyError ? e.failedIndex : 0;
        const cause = e instanceof SpendManyError ? e.cause : e;
        await updateChain((s) =>
          items.reduce((acc, it, k) => {
            if (k < done.length) return recordQueuedSend(acc, it, { ok: true, result: done[k]! }, Date.now());
            const msg = k === failedAt ? errorMessage(cause) : "Not sent: an earlier send in this batch failed.";
            return recordQueuedSend(acc, it, { ok: false, error: msg }, Date.now());
          }, s),
        );
        setError(errorMessage(cause));
      } finally {
        items.forEach((i) => inFlight.current.delete(i.id));
        setSending(false);
      }
    },
    [chainId, ring, svc.spend, updateChain],
  );

  const tick = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    try {
      const now = Date.now();
      const cs = chainState(dataRef.current, chainId);
      const q0 = queueOf(cs);
      const q1 = markInterrupted(reconcileExits(q0, cs.exits ?? [], now), now, inFlight.current);
      if (q1 !== q0) await setQueue((q) => markInterrupted(reconcileExits(q, chainState(dataRef.current, chainId).exits ?? [], now), now, inFlight.current));
      const c = clock();
      const due = nextDue(queueOf(chainState(dataRef.current, chainId)), c.now, c.window);
      if (!due) return;
      // A spend needs a bundler; leave it queued (not released) until one is configured.
      if (due.kind === "spend" && !svc.spend.ready) return;
      await setQueue((q) => release(q, [due.id], c));
      if (due.kind === "spend") await sendItems([due]);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      running.current = false;
    }
  }, [chainId, clock, setQueue, sendItems, svc.spend.ready]);

  const queue = useMemo(() => queueOf(state), [state]);
  const active = queue.items.some((i) => i.status === "queued" || i.status === "released");
  // Re-check whenever the set of waiting items changes (e.g. a new Send whose first item is due now).
  const waiting = queue.items.filter((i) => i.status === "queued").map((i) => i.id).join(",");

  useEffect(() => {
    if (!active) return;
    void tick();
    const t = setInterval(() => void tick(), pollMs);
    const onVisible = () => document.visibilityState === "visible" && void tick();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [active, waiting, pollMs, tick]);

  const sendNow = useCallback(
    async (groupId: string) => {
      const ids = queueOf(chainState(dataRef.current, chainId))
        .items.filter((i) => i.groupId === groupId && i.status === "queued")
        .map((i) => i.id);
      if (ids.length === 0) return;
      const released = queueOf(chainState(dataRef.current, chainId)).items.filter((i) => ids.includes(i.id));
      await setQueue((q) => release(q, ids, clock()));
      await sendItems(released.filter((i) => i.kind === "spend"));
    },
    [chainId, clock, setQueue, sendItems],
  );

  const cancel = useCallback((id: string) => setQueue((q) => cancelItems(q, [id])).then(() => undefined), [setQueue]);
  const retry = useCallback(
    async (id: string) => {
      await setQueue((q) => requeue(q, id, clock()));
      await tick();
    },
    [setQueue, clock, tick],
  );

  const api: QueueApi = useMemo(
    () => ({
      pending: pendingItems(queue).map((i) => ({ ...i, opensAt: windowOpensAt(queue, i, qw) })),
      recent: queue.items
        .filter((i) => i.status === "sent" || i.status === "failed")
        .sort((a, b) => (b.settledAt ?? 0) - (a.settledAt ?? 0))
        .slice(0, RECENT),
      nextAt: nextWindowAt(queue, qw),
      locked: lockedAddresses(queue),
      window: qw,
      sending,
      error,
      tick,
      sendNow,
      cancel,
      retry,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [queue, qw.minMs, qw.maxMs, sending, error, tick, sendNow, cancel, retry],
  );
  return <QueueContext.Provider value={api}>{children}</QueueContext.Provider>;
}

export function useQueue(): QueueApi {
  const q = useContext(QueueContext);
  if (!q) throw new Error("useQueue outside QueueProvider");
  return q;
}
