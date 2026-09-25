/**
 * Scan orchestration: fetch → scan in workers → real balances → ledger → cluster graph.
 *
 * Incremental: resumes from `lastScannedBlock + 1` stored in the encrypted vault. A full rebuild
 * starts from the Announcer's deployment block with an empty cache, which is how the app proves PRD
 * invariant 4 (the ledger rebuilds from seed + chain alone).
 *
 * Trust: an announcement is ours only if the stealth address recomputes from our keys (the SDK does
 * that). Amounts come only from balances; metadata amount, token and payer are hints.
 */
import {
  ClusterGraph,
  buildLedger,
  fetchAnnouncements,
  fetchAnnouncementsRpc,
  getChainConfig,
  parseMetadata,
  verifyBalances,
  type AnnouncementRecord,
  type FetchLike,
  type LedgerEntry,
  type LogsClient,
  type MulticallClient,
  type ScanKeys,
  type ScanStats,
} from "@soapay/sdk";
import type { Address } from "viem";
import { annKey, storeAnnouncement, toScanMatch, type ChainState, type StoredBalance } from "../vault/types.js";
import type { PoolProgress, PoolResult, ScanPool } from "./pool.js";

export type ScanPhase =
  | { phase: "head" }
  | { phase: "fetching"; fetched: number; detail: string }
  | { phase: "scanning"; progress: PoolProgress }
  | { phase: "balances"; addresses: number }
  | { phase: "done" };

export type ScanClient = LogsClient & MulticallClient & { getBlockNumber(): Promise<bigint> };

export type ScanDeps = {
  chainId: number;
  apiUrl: string;
  useRpc: boolean;
  fetch: FetchLike;
  client: ScanClient;
  pool: Pick<ScanPool, "scan">;
  /** One key set, or every generation after a rotation (old payments still arrive at old meta-addresses). */
  keys: ScanKeys | readonly ScanKeys[];
  signal?: AbortSignal;
  onPhase?: (p: ScanPhase) => void;
  /** RPC getLogs range per request. */
  rpcChunk?: number;
};

export type ScanOutcome = {
  state: ChainState;
  fetched: number;
  fromBlock: bigint;
  toBlock: bigint | null;
  newMatches: number;
  stats: ScanStats;
  scanMs: number;
  workers: number;
  /** Set when the balance read failed; the previous balances were kept. */
  balanceError: string | null;
};

/** Blocks per progress step when fetching over RPC. */
const RPC_WINDOW = 200_000n;

async function fetchRange(deps: ScanDeps, from: bigint, to: bigint | null): Promise<AnnouncementRecord[]> {
  const report = (fetched: number, detail: string) => deps.onPhase?.({ phase: "fetching", fetched, detail });
  if (deps.useRpc) {
    if (to === null) throw new Error("The RPC fallback needs the chain head, and the RPC did not return it.");
    const out: AnnouncementRecord[] = [];
    for (let start = from; start <= to; start += RPC_WINDOW) {
      if (deps.signal?.aborted) throw new DOMException("Scan cancelled", "AbortError");
      const end = start + RPC_WINDOW - 1n > to ? to : start + RPC_WINDOW - 1n;
      out.push(
        ...(await fetchAnnouncementsRpc({
          client: deps.client,
          fromBlock: start,
          toBlock: end,
          chunkSize: deps.rpcChunk ?? 10_000,
          concurrency: 4,
        })),
      );
      const pct = Number(((end - from + 1n) * 100n) / (to - from + 1n));
      report(out.length, `getLogs ${pct}% of ${(to - from + 1n).toLocaleString()} blocks`);
    }
    return out;
  }
  // The SDK pages internally; count pages through the fetch it calls.
  let pages = 0;
  const counting: FetchLike = async (url) => {
    if (deps.signal?.aborted) throw new DOMException("Scan cancelled", "AbortError");
    const res = await deps.fetch(url);
    report(pages * 1000, `page ${++pages} from the Soapay API`);
    return res;
  };
  const r = await fetchAnnouncements({
    apiUrl: deps.apiUrl,
    fromBlock: from,
    ...(to !== null ? { toBlock: to } : {}),
    limit: 1000,
    fetch: counting,
  });
  report(r.announcements.length, `${pages} page${pages === 1 ? "" : "s"} from the Soapay API`);
  return r.announcements;
}

export async function runScan(prev: ChainState, deps: ScanDeps, opts: { full?: boolean } = {}): Promise<ScanOutcome> {
  const cfg = getChainConfig(deps.chainId);
  const start = opts.full || prev.lastScannedBlock === null ? cfg.announcerStartBlock : BigInt(prev.lastScannedBlock) + 1n;
  const base: ChainState = opts.full
    ? { lastScannedBlock: null, matches: [], balances: [], balancesAt: null, graph: prev.graph }
    : prev;

  deps.onPhase?.({ phase: "head" });
  let head: bigint | null = null;
  try {
    head = await deps.client.getBlockNumber();
  } catch {
    head = null; // API mode still works without it
  }

  let fetched: AnnouncementRecord[] = [];
  if (head === null || start <= head) fetched = await fetchRange(deps, start, head);

  const keySets: readonly ScanKeys[] = Array.isArray(deps.keys) ? deps.keys : [deps.keys as ScanKeys];
  const total = fetched.length * keySets.length;
  deps.onPhase?.({ phase: "scanning", progress: { scanned: 0, total } });
  const scan: PoolResult = { matches: [], stats: { scanned: 0, malformed: 0, fullChecks: 0, matches: 0 }, ms: 0, workers: 0 };
  for (const [i, keys] of keySets.entries()) {
    const offset = i * fetched.length;
    const r = await deps.pool.scan(fetched, keys, {
      onProgress: (p) => deps.onPhase?.({ phase: "scanning", progress: { scanned: offset + p.scanned, total } }),
      ...(deps.signal ? { signal: deps.signal } : {}),
    });
    scan.matches.push(...r.matches);
    scan.stats.scanned += r.stats.scanned;
    scan.stats.malformed += r.stats.malformed;
    scan.stats.fullChecks += r.stats.fullChecks;
    scan.stats.matches += r.stats.matches;
    scan.ms += r.ms;
    scan.workers = Math.max(scan.workers, r.workers);
  }

  // Merge with what we already had; dedupe by (txHash, logIndex).
  const merged = new Map(base.matches.map((a) => [annKey(a), a]));
  let newMatches = 0;
  for (const m of scan.matches) {
    const k = annKey(m.announcement);
    if (!merged.has(k)) newMatches++;
    merged.set(k, storeAnnouncement(m.announcement));
  }
  const matches = [...merged.values()].sort((a, b) =>
    a.blockNumber === b.blockNumber ? a.logIndex - b.logIndex : BigInt(a.blockNumber) < BigInt(b.blockNumber) ? -1 : 1,
  );

  // Without a head, re-read the last block we saw next time (an index can be mid-block).
  let last: bigint | null = base.lastScannedBlock === null ? null : BigInt(base.lastScannedBlock);
  if (head !== null) last = head;
  else if (fetched.length > 0) {
    const maxSeen = fetched[fetched.length - 1]!.blockNumber - 1n;
    last = last === null || maxSeen > last ? maxSeen : last;
  }

  deps.onPhase?.({ phase: "balances", addresses: new Set(matches.map((m) => m.stealthAddress)).size });
  let balances: StoredBalance[] = base.balances;
  let balancesAt = base.balancesAt;
  let balanceError: string | null = null;
  try {
    const rows = await verifyBalances({
      client: deps.client,
      matches: matches.map((a) => toScanMatch(a, parseMetadata)),
      tokens: [cfg.usdc],
    });
    balances = rows.map((r) => ({ ...r, balance: r.balance === null ? null : r.balance.toString() }));
    balancesAt = Date.now();
  } catch (e) {
    balanceError = e instanceof Error ? e.message : String(e);
  }

  const graph = base.graph ? ClusterGraph.fromJSON(base.graph) : new ClusterGraph();
  for (const a of matches) {
    const bal = balances.find((b) => b.stealthAddress.toLowerCase() === a.stealthAddress.toLowerCase())?.balance;
    graph.addStealth(a.stealthAddress, { runId: a.txHash, ...(bal ? { amount: BigInt(bal) } : {}) });
  }

  deps.onPhase?.({ phase: "done" });
  return {
    state: {
      lastScannedBlock: last === null ? null : last.toString(),
      matches,
      balances,
      balancesAt,
      graph: graph.toJSON(),
    },
    fetched: fetched.length,
    fromBlock: start,
    toBlock: head,
    newMatches,
    stats: scan.stats,
    scanMs: scan.ms,
    workers: scan.workers,
    balanceError,
  };
}

/** Ledger from stored state. Pure; re-run whenever payers or trusted StealthDisperse addresses change. */
export function ledgerFromState(
  state: ChainState,
  knownPayers: readonly Address[],
  stealthDisperse: readonly Address[],
): LedgerEntry[] {
  const matches = state.matches.map((a) => toScanMatch(a, parseMetadata));
  const balances = state.balances.map((b) => ({ ...b, balance: b.balance === null ? null : BigInt(b.balance) }));
  return buildLedger(matches, balances, knownPayers, { stealthDisperse });
}

/** Stealth address → balance, for the guard's balance view. Zero and unknown balances are omitted. */
export function balanceMap(state: ChainState): Map<Address, bigint> {
  const m = new Map<Address, bigint>();
  for (const b of state.balances) if (b.balance !== null && BigInt(b.balance) > 0n) m.set(b.stealthAddress, BigInt(b.balance));
  return m;
}
