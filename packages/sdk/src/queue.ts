/**
 * Timing queue (D-28; docs/shielded-rail-research.md Part B). Pure scheduling, ordering and rounding;
 * no I/O, no keys, no clock (callers pass `now` and `random`).
 *
 * A coworker who sees several stealth addresses drain within minutes links them. So by default a
 * client spends **at most one stealth address per randomized window** (2–12 h), in random order, in
 * round amounts where possible. The queue is plain JSON: the app keeps it in its encrypted vault and
 * runs due items while it is open. There is no server and no pre-signed userOp: neither
 * Simple7702Account nor the Circle paymaster returns a validAfter, so a signed op is valid at once
 * and forever, and whoever holds it could send it at any time.
 *
 * Pool deposits (the exit) use the same queue: each exit leg's first on-chain step is one item.
 */
import type { Address, Hex } from "viem";

const HOUR = 3_600_000;

/** Gap between two releases: uniform in [minMs, maxMs]. */
export type QueueWindow = { minMs: number; maxMs: number };

export const DEFAULT_QUEUE_WINDOW: QueueWindow = { minMs: 2 * HOUR, maxMs: 12 * HOUR };

/**
 * - queued: waiting for its window
 * - released: its window opened (or "send now"); the app is sending it
 * - sent / failed: settled
 */
export type QueueStatus = "queued" | "released" | "sent" | "failed";

export type QueueItem<M = Record<string, string>> = {
  id: string;
  /** One user action (a Send or an Exit); its items leave in separate windows. */
  groupId: string;
  kind: "spend" | "exit";
  /** The one stealth address this item spends from. */
  from: Address;
  to: Address;
  /** Base units, decimal string (JSON-safe). */
  amount: string;
  createdAt: number;
  /** Earliest time (ms) this item may be released. */
  notBefore: number;
  status: QueueStatus;
  releasedAt?: number;
  settledAt?: number;
  error?: string;
  txHash?: Hex;
  /** App data (e.g. the exit leg id, the guard plan). */
  meta?: M;
};

export type SpendQueue<M = Record<string, string>> = {
  items: QueueItem<M>[];
  /** When the last item was released, across sessions. Spacing is measured from here. */
  lastReleasedAt: number | null;
};

export type QueueClock = { now: number; window?: QueueWindow; random?: () => number };

export function emptyQueue<M = Record<string, string>>(): SpendQueue<M> {
  return { items: [], lastReleasedAt: null };
}

export function checkWindow(w: QueueWindow): void {
  if (!(w.minMs >= 0) || !(w.maxMs >= w.minMs)) throw new Error("queue: window needs 0 <= minMs <= maxMs");
}

/** One randomized window length, uniform in [minMs, maxMs]. */
export function randomWindowMs(w: QueueWindow = DEFAULT_QUEUE_WINDOW, random: () => number = Math.random): number {
  checkWindow(w);
  return Math.round(w.minMs + (w.maxMs - w.minMs) * random());
}

/** Fisher–Yates; returns a new array. Spend order must not follow derivation, ascending or input order. */
export function shuffle<T>(xs: readonly T[], random: () => number = Math.random): T[] {
  const out = [...xs];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/** USDC (6 decimals): 10 USDC steps from 100 USDC up, 1 USDC steps from 1 USDC up, else none. */
export function roundUnitFor(amount: bigint, decimals = 6): bigint {
  const one = 10n ** BigInt(decimals);
  if (amount >= 100n * one) return 10n * one;
  if (amount >= one) return one;
  return 1n;
}

export type RoundAllocation = {
  /** Per source, in input order; 0n = unused. */
  amounts: bigint[];
  /** What the sources could not cover (0n when sufficient). */
  remaining: bigint;
};

/**
 * Splits `amount` across sources (in the given order, each capped by what it can send) so that parts
 * are whole multiples of `unit` where possible. Round parts stop a coworker from matching odd sums to
 * a known salary or chunk. Pass 1 takes whole units; pass 2 places the odd rest in sources with slack,
 * so the exact amount still arrives and usually only one part is not round.
 */
export function roundAllocate(caps: readonly bigint[], amount: bigint, unit: bigint = roundUnitFor(amount)): RoundAllocation {
  if (amount <= 0n) throw new Error("queue: amount must be positive");
  if (unit <= 0n) throw new Error("queue: unit must be positive");
  const amounts = caps.map(() => 0n);
  let remaining = amount;
  const floor = (x: bigint) => (x / unit) * unit;
  for (let i = 0; i < caps.length && remaining > 0n; i++) {
    const cap = caps[i]! > 0n ? caps[i]! : 0n;
    const take = floor(cap < remaining ? cap : remaining);
    amounts[i] = take;
    remaining -= take;
  }
  const slackOf = (i: number) => (caps[i]! > 0n ? caps[i]! : 0n) - amounts[i]!;
  // Prefer one source (already used, else any) that can take the whole odd rest: one non-round part.
  const used = caps.findIndex((_, i) => amounts[i]! > 0n && slackOf(i) >= remaining);
  const whole = used >= 0 ? used : caps.findIndex((_, i) => slackOf(i) >= remaining);
  if (remaining > 0n && whole >= 0) {
    amounts[whole] = amounts[whole]! + remaining;
    remaining = 0n;
  }
  for (let i = 0; i < caps.length && remaining > 0n; i++) {
    const slack = slackOf(i);
    if (slack <= 0n) continue;
    const take = slack < remaining ? slack : remaining;
    amounts[i] = amounts[i]! + take;
    remaining -= take;
  }
  return { amounts, remaining };
}

export type NewQueueItem<M = Record<string, string>> = Pick<QueueItem<M>, "groupId" | "kind" | "from" | "to" | "amount"> & {
  id?: string;
  meta?: M;
};

const open = (i: QueueItem<unknown>) => i.status === "queued";
const live = (i: QueueItem<unknown>) => i.status === "queued" || i.status === "released";

/**
 * Adds items in RANDOM order, one per window: the first right away when nothing was released or
 * queued recently, otherwise one window after the last release or queued item; each next one a fresh
 * random window later. An address already queued or in flight is refused (one item per address).
 */
export function enqueue<M>(queue: SpendQueue<M>, items: readonly NewQueueItem<M>[], clock: QueueClock): SpendQueue<M> {
  const w = clock.window ?? DEFAULT_QUEUE_WINDOW;
  const random = clock.random ?? Math.random;
  checkWindow(w);
  const busy = lockedAddresses(queue);
  const seen = new Set<string>();
  for (const it of items) {
    const k = it.from.toLowerCase();
    if (busy.has(k) || seen.has(k)) throw new Error(`queue: ${it.from} is already queued`);
    seen.add(k);
  }
  const anchors = queue.items.filter(open).map((i) => i.notBefore);
  if (queue.lastReleasedAt !== null) anchors.push(queue.lastReleasedAt);
  let cursor = anchors.length === 0 ? clock.now : Math.max(clock.now, Math.max(...anchors) + randomWindowMs(w, random));
  const added: QueueItem<M>[] = [];
  for (const [n, it] of shuffle(items, random).entries()) {
    if (n > 0) cursor += randomWindowMs(w, random);
    const id = it.id ?? `q-${clock.now.toString(36)}-${n}-${Math.floor(random() * 2 ** 32).toString(36)}`;
    added.push({ ...it, id, createdAt: clock.now, notBefore: cursor, status: "queued" });
  }
  return { ...queue, items: [...queue.items, ...added] };
}

/** When the next queued item may go: its own time, but never within `minMs` of the last release. */
export function nextWindowAt<M>(queue: SpendQueue<M>, window: QueueWindow = DEFAULT_QUEUE_WINDOW): number | null {
  const q = queue.items.filter(open);
  if (q.length === 0) return null;
  const earliest = Math.min(...q.map((i) => i.notBefore));
  return queue.lastReleasedAt === null ? earliest : Math.max(earliest, queue.lastReleasedAt + window.minMs);
}

/** When this queued item's window opens: its own time, but never within `minMs` of the last release. */
export function windowOpensAt<M>(queue: SpendQueue<M>, item: QueueItem<M>, window: QueueWindow = DEFAULT_QUEUE_WINDOW): number {
  return queue.lastReleasedAt === null ? item.notBefore : Math.max(item.notBefore, queue.lastReleasedAt + window.minMs);
}

/**
 * The one item to release now, or null. After the app was closed for days a backlog is NOT sent in a
 * burst: one item, then the rest are respaced by `release`.
 */
export function nextDue<M>(queue: SpendQueue<M>, now: number, window: QueueWindow = DEFAULT_QUEUE_WINDOW): QueueItem<M> | null {
  const at = nextWindowAt(queue, window);
  if (at === null || now < at) return null;
  const due = queue.items.filter((i) => open(i) && i.notBefore <= now);
  return due.reduce<QueueItem<M> | null>((best, i) => (best === null || i.notBefore < best.notBefore ? i : best), null);
}

/**
 * Marks items released (their send starts now) and pushes every other queued item so that
 * consecutive ones stay at least one random window apart. Releasing several ids at once is the
 * explicit "send now" override, which links those addresses by timing.
 */
export function release<M>(queue: SpendQueue<M>, ids: readonly string[], clock: QueueClock): SpendQueue<M> {
  const w = clock.window ?? DEFAULT_QUEUE_WINDOW;
  const random = clock.random ?? Math.random;
  const set = new Set(ids);
  if (!queue.items.some((i) => set.has(i.id) && open(i))) return queue;
  let items = queue.items.map((i) => (set.has(i.id) && open(i) ? { ...i, status: "released" as const, releasedAt: clock.now } : i));
  const rest = items.filter(open).sort((a, b) => a.notBefore - b.notBefore);
  const moved = new Map<string, number>();
  let prev = clock.now;
  for (const i of rest) {
    const t = i.notBefore - prev < w.minMs ? prev + randomWindowMs(w, random) : i.notBefore;
    if (t !== i.notBefore) moved.set(i.id, t);
    prev = t;
  }
  items = items.map((i) => (moved.has(i.id) ? { ...i, notBefore: moved.get(i.id)! } : i));
  return { items, lastReleasedAt: clock.now };
}

export type SettleResult = { ok: true; txHash?: Hex } | { ok: false; error: string };

export function settle<M>(queue: SpendQueue<M>, id: string, result: SettleResult, now: number): SpendQueue<M> {
  return {
    ...queue,
    items: queue.items.map((i) => {
      if (i.id !== id) return i;
      const base = { ...i, settledAt: now };
      if (result.ok) {
        const { error: _e, ...rest } = base;
        return { ...rest, status: "sent" as const, ...(result.txHash ? { txHash: result.txHash } : {}) };
      }
      return { ...base, status: "failed" as const, error: result.error };
    }),
  };
}

/** A failed (or interrupted) item goes back in line, one window after everything else. */
export function requeue<M>(queue: SpendQueue<M>, id: string, clock: QueueClock): SpendQueue<M> {
  const item = queue.items.find((i) => i.id === id);
  if (!item || item.status === "sent" || item.status === "queued") return queue;
  const without = { ...queue, items: queue.items.filter((i) => i.id !== id) };
  const { error: _e, releasedAt: _r, settledAt: _s, txHash: _t, notBefore: _n, status: _st, createdAt: _c, ...keep } = item;
  return enqueue(without, [keep], clock);
}

/** Drops queued items (never released ones: those may already be on chain). */
export function cancel<M>(queue: SpendQueue<M>, ids: readonly string[]): SpendQueue<M> {
  const set = new Set(ids);
  return { ...queue, items: queue.items.filter((i) => !(set.has(i.id) && open(i))) };
}

/** Lower-cased addresses with a queued or in-flight item: never pick these as new sources. */
export function lockedAddresses<M>(queue: SpendQueue<M>): Set<string> {
  return new Set(queue.items.filter(live).map((i) => i.from.toLowerCase()));
}

/** Queued and in-flight items, soonest first. */
export function pendingItems<M>(queue: SpendQueue<M>): QueueItem<M>[] {
  return queue.items.filter(live).sort((a, b) => a.notBefore - b.notBefore);
}
