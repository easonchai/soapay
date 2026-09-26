import { describe, expect, it } from "vitest";
import { ClusterGraph, nextDue, pendingItems, planSpend, release, type SpendResult } from "@soapay/sdk";
import type { Address, Hex } from "viem";
import type { ExitRecord } from "../src/features/exit/types.js";
import { allocate } from "../src/spend/allocate.js";
import type { SpendDraft } from "../src/spend/flow.js";
import {
  INTERRUPTED_AFTER_MS,
  enqueueExitLegs,
  enqueueSpend,
  isLegQueued,
  markInterrupted,
  queueOf,
  queueWindow,
  recordQueuedSend,
  reconcileExits,
} from "../src/spend/queue.js";
import { emptyChainState, type ChainState } from "../src/vault/types.js";

const A = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as Address;
const B = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" as Address;
const C = "0xcccccccccccccccccccccccccccccccccccccccc" as Address;
const TO = "0x1111111111111111111111111111111111111111" as Address;
const USDC = 1_000_000n;
const H = 3_600_000;
const random = () => 0.5;

function draft(parts: Address[]): SpendDraft {
  const g = new ClusterGraph();
  for (const a of parts) g.addStealth(a);
  const allocation = allocate(
    parts.map((address) => ({ address, fee: USDC / 10n, maxSendable: 400n * USDC + 123n })),
    1000n * USDC,
  );
  return {
    to: TO,
    amount: 1000n * USDC,
    suggestion: { from: parts, clusterIds: parts, merges: parts.length - 1, total: 0n, sufficient: true },
    quotes: [],
    allocation,
    plan: planSpend(g, { from: allocation.parts.map((p) => p.address), to: TO, override: true }),
    keys: new Map(),
  };
}

describe("recipient timing queue (D-28)", () => {
  it("allocates round amounts per source", () => {
    const a = allocate(
      [A, B, C].map((address) => ({ address, fee: 1n, maxSendable: 400n * USDC + 123n })),
      1000n * USDC,
    );
    expect(a.parts.map((p) => p.amount)).toEqual([400n * USDC, 400n * USDC, 200n * USDC]);
    expect(a.sufficient).toBe(true);
  });

  it("queues a Send one source per window and links only what actually sent", () => {
    const d = draft([A, B, C]);
    let s: ChainState = enqueueSpend(emptyChainState(), d, { now: 0, window: queueWindow({ queueWindowHours: [2, 12] }), random, groupId: "g" });
    const q = queueOf(s);
    expect(q.items).toHaveLength(3);
    expect(q.items.every((i) => i.kind === "spend" && i.groupId === "g" && i.meta?.override === "1")).toBe(true);
    const times = pendingItems(q).map((i) => i.notBefore);
    for (let k = 1; k < times.length; k++) expect(times[k]! - times[k - 1]!).toBeGreaterThanOrEqual(2 * H);

    const due = nextDue(q, 0)!;
    s = { ...s, queue: release(q, [due.id], { now: 0, random }) };
    const result: SpendResult = { from: due.from, userOpHash: "0x01" as Hex, txHash: "0x02" as Hex, delegated: true, amount: BigInt(due.amount), feeEstimate: 1n };
    s = recordQueuedSend(s, queueOf(s).items.find((i) => i.id === due.id)!, { ok: true, result }, 1);
    expect(queueOf(s).items.find((i) => i.id === due.id)).toMatchObject({ status: "sent", txHash: "0x02" });
    expect(s.spends).toHaveLength(1);
    expect(s.spends![0]!.parts[0]!.from.toLowerCase()).toBe(due.from.toLowerCase());
    const g = ClusterGraph.fromJSON(s.graph!);
    expect(g.clusterOf(due.from)).toBe(g.clusterOf(TO));
    for (const other of [A, B, C].filter((x) => x !== due.from)) expect(g.has(other) && g.clusterOf(other) === g.clusterOf(TO)).toBe(false);
    // Nothing else is due in the same window.
    expect(nextDue(queueOf(s), 60_000)).toBeNull();
  });

  it("refuses a blocked or unfunded draft", () => {
    const d = draft([A]);
    expect(() => enqueueSpend(emptyChainState(), { ...d, plan: null }, { now: 0, groupId: "g" })).toThrow(/Not enough/);
    expect(() => enqueueSpend(emptyChainState(), { ...d, plan: { ...d.plan!, decision: "block" } }, { now: 0, groupId: "g" })).toThrow(/blocked/);
  });

  it("exit legs: queued until released, settled from the leg's progress", () => {
    const leg = (id: string, from: Address) => ({ id, stealthAddress: from, destination: TO, amount: "500000000" }) as unknown as ExitRecord["legs"][number];
    let q = enqueueExitLegs(queueOf(emptyChainState()), "e1", [leg("l1", A), leg("l2", B)], { now: 0, random });
    expect(isLegQueued(q, "l1") && isLegQueued(q, "l2")).toBe(true);
    const first = nextDue(q, 0)!;
    q = release(q, [first.id], { now: 0, random });
    expect(isLegQueued(q, first.meta!.legId!)).toBe(false);
    const exits = [{ legs: [{ ...leg(first.meta!.legId!, first.from), status: "burning", txs: { burn: "0xbb" } }] }] as unknown as ExitRecord[];
    q = reconcileExits(q, exits, 5);
    expect(q.items.find((i) => i.id === first.id)).toMatchObject({ status: "sent", txHash: "0xbb" });
  });

  it("a spend released in a closed tab is marked interrupted, never silently resent", () => {
    let s = enqueueSpend(emptyChainState(), draft([A]), { now: 0, random, groupId: "g" });
    const id = queueOf(s).items[0]!.id;
    s = { ...s, queue: release(queueOf(s), [id], { now: 0, random }) };
    expect(markInterrupted(queueOf(s), INTERRUPTED_AFTER_MS - 1, new Set()).items[0]!.status).toBe("released");
    expect(markInterrupted(queueOf(s), INTERRUPTED_AFTER_MS, new Set([id])).items[0]!.status).toBe("released");
    const q = markInterrupted(queueOf(s), INTERRUPTED_AFTER_MS, new Set());
    expect(q.items[0]).toMatchObject({ status: "failed", error: expect.stringMatching(/Interrupted/) });
  });

  it("window settings are clamped", () => {
    expect(queueWindow({ queueWindowHours: [2, 12] })).toEqual({ minMs: 2 * H, maxMs: 12 * H });
    expect(queueWindow({ queueWindowHours: [5, 1] })).toEqual({ minMs: 5 * H, maxMs: 5 * H });
    expect(queueWindow({ queueWindowHours: [-3, 1000] })).toEqual({ minMs: 0, maxMs: 168 * H });
    expect(queueWindow({})).toEqual({ minMs: 2 * H, maxMs: 12 * H });
  });
});
