import { describe, expect, it } from "vitest";
import type { Address } from "viem";
import {
  DEFAULT_QUEUE_WINDOW,
  cancel,
  emptyQueue,
  enqueue,
  lockedAddresses,
  nextDue,
  nextWindowAt,
  pendingItems,
  randomWindowMs,
  release,
  requeue,
  roundAllocate,
  roundUnitFor,
  settle,
  shuffle,
  type NewQueueItem,
  type SpendQueue,
} from "../src/queue.js";

const H = 3_600_000;
const USDC = 1_000_000n;
const TO = "0x00000000000000000000000000000000000000aa" as Address;
const addr = (i: number) => `0x${(i + 1).toString(16).padStart(40, "0")}` as Address;

/** Deterministic PRNG (mulberry32) so the privacy properties are checked on fixed seeds. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const items = (n: number, groupId = "g1"): NewQueueItem[] =>
  Array.from({ length: n }, (_, i) => ({ groupId, kind: "spend" as const, from: addr(i), to: TO, amount: (100n * USDC).toString() }));

/** Runs the app loop: wake every `stepMs`, release whatever is due (at most one per wake). */
function drain(q: SpendQueue, start: number, stepMs: number, random: () => number, until = start + 30 * 24 * H) {
  const released: { id: string; from: Address; at: number }[] = [];
  for (let now = start; now <= until && pendingItems(q).some((i) => i.status === "queued"); now += stepMs) {
    const due = nextDue(q, now);
    if (!due) continue;
    q = release(q, [due.id], { now, random });
    q = settle(q, due.id, { ok: true }, now);
    released.push({ id: due.id, from: due.from, at: now });
  }
  return { q, released };
}

describe("timing queue: CI privacy invariants (D-28)", () => {
  it("never releases two items of one user within the same window, across seeds and wake rates", () => {
    for (const seed of [1, 2, 3, 42, 1337]) {
      for (const step of [10 * 60_000, 3 * H, 30 * H]) {
        const random = rng(seed);
        const q = enqueue(emptyQueue(), items(6), { now: 0, random });
        const { released } = drain(q, 0, step, random);
        expect(released).toHaveLength(6);
        for (let i = 1; i < released.length; i++) {
          expect(released[i]!.at - released[i - 1]!.at).toBeGreaterThanOrEqual(DEFAULT_QUEUE_WINDOW.minMs);
        }
      }
    }
  });

  it("spends in random order, not input or address order", () => {
    const orders = new Set<string>();
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const random = rng(seed);
      const { released } = drain(enqueue(emptyQueue(), items(5), { now: 0, random }), 0, H, random);
      orders.add(released.map((r) => r.from).join(","));
    }
    expect(orders.size).toBeGreaterThan(4);
    const asc = items(5).map((i) => i.from).join(",");
    expect([...orders].filter((o) => o === asc).length).toBeLessThanOrEqual(1);
  });

  it("a backlog after days offline goes out one per window, not in a burst", () => {
    const random = rng(9);
    let q = enqueue(emptyQueue(), items(4), { now: 0, random });
    // App closed for a week: every item is overdue.
    const week = 7 * 24 * H;
    const first = nextDue(q, week)!;
    expect(first).not.toBeNull();
    q = release(q, [first.id], { now: week, random });
    expect(nextDue(q, week)).toBeNull();
    expect(nextDue(q, week + DEFAULT_QUEUE_WINDOW.minMs - 1)).toBeNull();
    const at = nextWindowAt(q)!;
    expect(at).toBeGreaterThanOrEqual(week + DEFAULT_QUEUE_WINDOW.minMs);
    expect(at).toBeLessThanOrEqual(week + DEFAULT_QUEUE_WINDOW.maxMs);
    // The rest are respaced one window apart.
    const rest = pendingItems(q).filter((i) => i.status === "queued");
    for (let i = 1; i < rest.length; i++) expect(rest[i]!.notBefore - rest[i - 1]!.notBefore).toBeGreaterThanOrEqual(DEFAULT_QUEUE_WINDOW.minMs);
  });

  it("the first item of an idle queue goes now; a new batch waits a window after the last release", () => {
    const random = rng(5);
    let q = enqueue(emptyQueue(), items(1), { now: 1000, random });
    expect(nextDue(q, 1000)?.from).toBe(addr(0));
    q = release(q, [q.items[0]!.id], { now: 1000, random });
    q = enqueue(q, [{ ...items(1)[0]!, from: addr(7) }], { now: 2000, random });
    const n = q.items[1]!.notBefore;
    expect(n).toBeGreaterThanOrEqual(1000 + DEFAULT_QUEUE_WINDOW.minMs);
    expect(n).toBeLessThanOrEqual(1000 + DEFAULT_QUEUE_WINDOW.maxMs);
  });

  it("send now releases a whole group at once (the explicit override)", () => {
    const random = rng(3);
    let q = enqueue(emptyQueue(), items(3), { now: 0, random });
    q = enqueue(q, items(2, "g2").map((i, k) => ({ ...i, from: addr(10 + k) })), { now: 0, random });
    const g1 = q.items.filter((i) => i.groupId === "g1").map((i) => i.id);
    q = release(q, g1, { now: 5, random });
    expect(q.items.filter((i) => i.groupId === "g1").every((i) => i.status === "released")).toBe(true);
    // g2 is still spaced from this release.
    for (const i of q.items.filter((x) => x.groupId === "g2")) expect(i.notBefore).toBeGreaterThanOrEqual(5 + DEFAULT_QUEUE_WINDOW.minMs);
  });

  it("locks queued and in-flight addresses; refuses a second item for one address; cancel and requeue", () => {
    const random = rng(8);
    let q = enqueue(emptyQueue(), items(2), { now: 0, random });
    expect(lockedAddresses(q)).toEqual(new Set([addr(0), addr(1)].map((a) => a.toLowerCase())));
    expect(() => enqueue(q, items(1), { now: 0, random })).toThrow(/already queued/);
    const [a, b] = pendingItems(q);
    q = release(q, [a!.id], { now: 0, random });
    q = settle(q, a!.id, { ok: false, error: "AA21" }, 1);
    expect(q.items.find((i) => i.id === a!.id)).toMatchObject({ status: "failed", error: "AA21" });
    expect(lockedAddresses(q).has(a!.from.toLowerCase())).toBe(false);
    q = requeue(q, a!.id, { now: 10, random });
    const again = q.items.find((i) => i.id === a!.id)!;
    expect(again.status).toBe("queued");
    expect(again.notBefore).toBeGreaterThan(b!.notBefore);
    q = cancel(q, [b!.id]);
    expect(q.items.some((i) => i.id === b!.id)).toBe(false);
    // Cancel never drops a released item.
    q = release(q, [again.id], { now: again.notBefore, random });
    expect(cancel(q, [again.id]).items).toHaveLength(1);
  });

  it("window lengths stay in range", () => {
    const random = rng(11);
    for (let i = 0; i < 200; i++) {
      const w = randomWindowMs(DEFAULT_QUEUE_WINDOW, random);
      expect(w).toBeGreaterThanOrEqual(2 * H);
      expect(w).toBeLessThanOrEqual(12 * H);
    }
    expect(() => randomWindowMs({ minMs: 5, maxMs: 1 })).toThrow();
    expect(shuffle([1, 2, 3], rng(1)).sort()).toEqual([1, 2, 3]);
  });
});

describe("round amounts", () => {
  it("picks the rounding unit by size", () => {
    expect(roundUnitFor(1234n * USDC)).toBe(10n * USDC);
    expect(roundUnitFor(42n * USDC)).toBe(USDC);
    expect(roundUnitFor(USDC / 2n)).toBe(1n);
  });

  it("splits into round parts where possible and still delivers the exact amount", () => {
    const r = roundAllocate([700n * USDC + 123_456n, 900n * USDC + 1n], 1000n * USDC);
    expect(r.remaining).toBe(0n);
    expect(r.amounts).toEqual([700n * USDC, 300n * USDC]);

    const odd = roundAllocate([700n * USDC + 500_000n, 900n * USDC], 1234n * USDC + 560_000n);
    expect(odd.amounts.reduce((a, b) => a + b)).toBe(1234n * USDC + 560_000n);
    expect(odd.amounts.filter((a) => a % (10n * USDC) !== 0n)).toHaveLength(1);
  });

  it("doesn't pull in an extra source just to round", () => {
    expect(roundAllocate([105n * USDC, 50n * USDC], 105n * USDC).amounts).toEqual([105n * USDC, 0n]);
  });

  it("reports what the sources can't cover", () => {
    expect(roundAllocate([30n * USDC, 20n * USDC], 100n * USDC)).toEqual({ amounts: [30n * USDC, 20n * USDC], remaining: 50n * USDC });
    expect(() => roundAllocate([1n], 0n)).toThrow();
  });
});
