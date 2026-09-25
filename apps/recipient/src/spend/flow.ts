/**
 * Spend pipeline, framework-free (PRD guard; docs/mvp-spec.md §3 guard.ts):
 *
 *   suggestSources → per-source fee quotes → allocate → planSpend (allow | warn | block)
 *     → [user override for block] → spendMany (one userOp per address, jittered)
 *     → applySpend for the sources that ACTUALLY sent (a SpendManyError stops mid-way)
 *
 * The UI only renders a `SpendDraft` and calls `executeSpend`; any other UI can do the same.
 */
import {
  ClusterGraph,
  SpendManyError,
  applySpend,
  deriveStealthKey,
  planSpend,
  suggestSources,
  type SpendParams,
  type SpendPlan,
  type SpendResult,
  type SourceSuggestion,
} from "@soapay/sdk";
import { getAddress, type Address, type Hex } from "viem";
import type { KeyRing } from "../features/rotation/keys.js";
import type { SendProgress, SpendService } from "../services/spend.js";
import { loadAnnouncement, type ChainState, type SpendRecord } from "../vault/types.js";
import { allocate, type Allocation, type SourceQuote } from "./allocate.js";

/**
 * Spending key for one of our stealth addresses. Tries every key generation (rotation) and every
 * announcement for the address (spam copies may carry junk ephemeral keys); the SDK verifies the key
 * controls the address before returning it. Keys live only in memory for the length of a spend.
 */
export function stealthKeyFor(state: ChainState, ring: KeyRing, address: Address): Hex {
  const anns = state.matches.filter((m) => m.stealthAddress.toLowerCase() === address.toLowerCase());
  for (const a of anns) {
    for (const k of ring.all) {
      try {
        return deriveStealthKey({ announcement: loadAnnouncement(a) }, { spendingPrivateKey: k.spendingKey, viewingPrivateKey: k.viewingKey });
      } catch {
        // not this generation / not this announcement
      }
    }
  }
  throw new Error(`No key controls ${address}. Rescan, then try again.`);
}

export type SpendDraft = {
  to: Address;
  amount: bigint;
  suggestion: SourceSuggestion;
  quotes: SourceQuote[];
  allocation: Allocation;
  /** Guard decision for the sources actually used. null when the allocation is insufficient. */
  plan: SpendPlan | null;
  keys: ReadonlyMap<string, Hex>;
};

/** How many times to widen the source set to cover fees before giving up. */
const FEE_ROUNDS = 3;

export async function prepareSpend(p: {
  graph: ClusterGraph;
  balances: ReadonlyMap<Address, bigint>;
  state: ChainState;
  ring: KeyRing;
  spend: Pick<SpendService, "quote">;
  to: Address;
  amount: bigint;
  override?: boolean;
}): Promise<SpendDraft> {
  const to = getAddress(p.to);
  if (p.amount <= 0n) throw new Error("Enter an amount above zero.");
  if (p.balances.has(to) || p.state.matches.some((m) => m.stealthAddress.toLowerCase() === to.toLowerCase())) {
    throw new Error("That's one of your own stealth addresses. Send somewhere else.");
  }
  const keys = new Map<string, Hex>();
  const quoted = new Map<string, SourceQuote>();
  let target = p.amount;
  let suggestion = suggestSources(p.graph, p.balances, target);
  let quotes: SourceQuote[] = [];
  let allocation = allocate([], p.amount === 0n ? 1n : p.amount);
  for (let round = 0; round < FEE_ROUNDS; round++) {
    for (const a of suggestion.from) {
      const k = a.toLowerCase();
      if (quoted.has(k)) continue;
      const stealthKey = keys.get(k) ?? stealthKeyFor(p.state, p.ring, a);
      keys.set(k, stealthKey);
      const q = await p.spend.quote(stealthKey, to);
      quoted.set(k, { address: getAddress(a), fee: q.fee, maxSendable: q.maxSendable });
    }
    quotes = suggestion.from.map((a) => quoted.get(a.toLowerCase())!);
    allocation = allocate(quotes, p.amount);
    if (allocation.sufficient || !suggestion.sufficient) break;
    // Fees ate into the cover: ask for enough to pay them too.
    target = p.amount + allocation.fees + allocation.fees / 2n;
    const next = suggestSources(p.graph, p.balances, target);
    if (next.from.length === suggestion.from.length && next.from.every((a, i) => a === suggestion.from[i])) break;
    suggestion = next;
  }
  const plan = allocation.sufficient
    ? planSpend(p.graph, { from: allocation.parts.map((x) => x.address), to, override: p.override === true })
    : null;
  return { to, amount: p.amount, suggestion, quotes, allocation, plan, keys };
}

/** Re-run the guard for an existing draft, e.g. after the user ticks "override". */
export function replan(graph: ClusterGraph, draft: SpendDraft, override: boolean): SpendDraft {
  if (!draft.allocation.sufficient) return draft;
  return { ...draft, plan: planSpend(graph, { from: draft.allocation.parts.map((x) => x.address), to: draft.to, override }) };
}

export type SpendOutcome = {
  results: SpendResult[];
  /** Set when a send failed; `results` holds the ones that went through before it. */
  failure: { index: number; from: Address; message: string } | null;
  /** The guard graph after linking the sources that actually sent. */
  graph: ClusterGraph;
  record: SpendRecord;
};

export async function executeSpend(p: {
  graph: ClusterGraph;
  draft: SpendDraft;
  spend: Pick<SpendService, "sendAll">;
  onProgress?: SendProgress;
  now?: number;
}): Promise<SpendOutcome> {
  const { draft } = p;
  const plan = draft.plan;
  if (!plan) throw new Error("Not enough funds for this amount after fees.");
  if (plan.decision === "block") throw new Error("The privacy guard blocked this spend. Tick the override to send anyway.");
  const spends: SpendParams[] = draft.allocation.parts.map((part) => {
    const stealthKey = draft.keys.get(part.address.toLowerCase());
    if (!stealthKey) throw new Error(`Missing key for ${part.address}`);
    return { stealthKey, to: draft.to, amount: part.amount };
  });

  let results: SpendResult[];
  let failure: SpendOutcome["failure"] = null;
  try {
    results = await p.spend.sendAll(spends, p.onProgress);
  } catch (e) {
    if (!(e instanceof SpendManyError)) throw e;
    results = e.completed;
    const from = draft.allocation.parts[e.failedIndex]?.address ?? draft.allocation.parts[0]!.address;
    const cause = e.cause instanceof Error ? e.cause.message : String(e.cause);
    failure = { index: e.failedIndex, from, message: cause };
  }

  // Link only what hit the chain: the failed and unsent sources stay in their own clusters.
  const sent = results.map((r) => getAddress(r.from));
  const graph = sent.length > 0 ? applySpend(p.graph, { ...plan, from: sent }) : p.graph;
  const record: SpendRecord = {
    at: p.now ?? Date.now(),
    to: draft.to,
    parts: results.map((r) => ({
      from: getAddress(r.from),
      amount: (typeof r.amount === "bigint" ? r.amount : 0n).toString(),
      userOpHash: r.userOpHash,
      ...(r.txHash ? { txHash: r.txHash } : {}),
    })),
    ...(failure ? { failed: { from: failure.from, message: failure.message } } : {}),
    override: plan.override,
  };
  return { results, failure, graph, record };
}
