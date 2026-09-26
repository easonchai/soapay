// Recipient scanning (docs/mvp-spec.md §3, §4).
//
// Trust rules (CLAUDE.md): an announcement is ours only if the stealth address recomputes from our
// keys. Metadata (view tag, token, amount, payer) is an untrusted hint; the ledger uses real on-chain
// balances only. Unknown payers are ranked lower, never dropped.
import {
  getAddress,
  hexToBytes,
  isAddress,
  isHex,
  parseAbiItem,
  toHex,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { keccak_256 } from "@noble/hashes/sha3.js";
import { checkStealthAddress, computeStealthKey } from "@scopelift/stealth-address-sdk";
import { erc20Abi } from "./abis.js";
import { ANNOUNCER_ADDRESS, SCHEME_ID } from "./constants.js";

export const announcementEvent = parseAbiItem(
  "event Announcement(uint256 indexed schemeId, address indexed stealthAddress, address indexed caller, bytes ephemeralPubKey, bytes metadata)",
);

/** One ERC-5564 Announcement log, scheme 1. */
export type AnnouncementRecord = {
  blockNumber: bigint;
  txHash: Hex;
  logIndex: number;
  stealthAddress: Address;
  caller: Address;
  ephemeralPubKey: Hex;
  metadata: Hex;
};

// ---------------------------------------------------------------------------------------------
// Fetching

/**
 * `GET /announcements?from=<block>&to=<block>&cursor=<opaque>&limit=<n>` response body.
 * `blockNumber` is a decimal string (JSON has no bigint). `nextCursor` is null on the last page.
 * Items are ordered by (blockNumber, logIndex) ascending. Scheme 1 only, never filtered by recipient.
 */
export type AnnouncementsPage = {
  items: {
    blockNumber: string;
    txHash: Hex;
    logIndex: number;
    stealthAddress: Address;
    caller: Address;
    ephemeralPubKey: Hex;
    metadata: Hex;
  }[];
  nextCursor: string | null;
};

function parseApiItem(x: unknown): AnnouncementRecord | null {
  if (typeof x !== "object" || x === null) return null;
  const o = x as Record<string, unknown>;
  const { blockNumber, txHash, logIndex, stealthAddress, caller, ephemeralPubKey, metadata } = o;
  if (typeof blockNumber !== "string" && typeof blockNumber !== "number") return null;
  if (typeof blockNumber === "string" && !/^\d+$/.test(blockNumber)) return null;
  if (typeof txHash !== "string" || !isHex(txHash) || txHash.length !== 66) return null;
  if (typeof logIndex !== "number" || !Number.isInteger(logIndex) || logIndex < 0) return null;
  if (typeof stealthAddress !== "string" || !isAddress(stealthAddress, { strict: false })) return null;
  if (typeof caller !== "string" || !isAddress(caller, { strict: false })) return null;
  if (typeof ephemeralPubKey !== "string" || !isHex(ephemeralPubKey)) return null;
  if (typeof metadata !== "string" || !isHex(metadata)) return null;
  return {
    blockNumber: BigInt(blockNumber),
    txHash,
    logIndex,
    stealthAddress: getAddress(stealthAddress),
    caller: getAddress(caller),
    ephemeralPubKey: ephemeralPubKey.toLowerCase() as Hex,
    metadata: metadata.toLowerCase() as Hex,
  };
}

/** The subset of `fetch` used here (the SDK compiles without DOM types). */
export type FetchLike = (url: string) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

/**
 * Pages through the Soapay API's announcement index. Malformed items are skipped (counted in
 * `skipped`), since the API is a convenience cache: scanning re-derives everything anyway.
 */
export async function fetchAnnouncements(params: {
  apiUrl: string;
  fromBlock?: bigint;
  toBlock?: bigint;
  limit?: number;
  maxPages?: number;
  fetch?: FetchLike;
}): Promise<{ announcements: AnnouncementRecord[]; skipped: number }> {
  const doFetch: FetchLike | undefined = params.fetch ?? (globalThis as { fetch?: FetchLike }).fetch;
  if (!doFetch) throw new Error("Soapay: no fetch available");
  const maxPages = params.maxPages ?? 10_000;
  const out: AnnouncementRecord[] = [];
  let skipped = 0;
  let cursor: string | null = null;
  const seenCursors = new Set<string>();

  for (let page = 0; page < maxPages; page++) {
    const query: string[] = [];
    if (params.fromBlock !== undefined) query.push(`from=${params.fromBlock.toString()}`);
    if (params.toBlock !== undefined) query.push(`to=${params.toBlock.toString()}`);
    if (params.limit !== undefined) query.push(`limit=${params.limit}`);
    if (cursor !== null) query.push(`cursor=${encodeURIComponent(cursor)}`);
    const base = params.apiUrl.replace(/\/+$/, "");
    const url = `${base}/announcements${query.length ? `?${query.join("&")}` : ""}`;

    const res = await doFetch(url);
    if (!res.ok) throw new Error(`Soapay: GET /announcements failed: ${res.status}`);
    const body = (await res.json()) as unknown;
    if (typeof body !== "object" || body === null || !Array.isArray((body as { items?: unknown }).items)) {
      throw new Error("Soapay: GET /announcements: malformed page");
    }
    const { items, nextCursor } = body as { items: unknown[]; nextCursor?: unknown };
    for (const item of items) {
      const a = parseApiItem(item);
      if (a) out.push(a);
      else skipped++;
    }
    if (nextCursor === null || nextCursor === undefined) return { announcements: out, skipped };
    if (typeof nextCursor !== "string") throw new Error("Soapay: GET /announcements: bad cursor");
    if (seenCursors.has(nextCursor)) throw new Error("Soapay: GET /announcements: cursor loop");
    seenCursors.add(nextCursor);
    cursor = nextCursor;
  }
  throw new Error("Soapay: GET /announcements: too many pages");
}

/** Minimal client surface for the RPC fallback. */
export type LogsClient = Pick<PublicClient, "getLogs">;

/**
 * getLogs fallback over the canonical Announcer, schemeId 1, in `chunkSize`-block ranges with at most
 * `concurrency` requests in flight. Results are sorted by (blockNumber, logIndex).
 */
export async function fetchAnnouncementsRpc(params: {
  client: LogsClient;
  fromBlock: bigint;
  toBlock: bigint;
  chunkSize?: number;
  concurrency?: number;
  announcer?: Address;
}): Promise<AnnouncementRecord[]> {
  const chunk = BigInt(params.chunkSize ?? 10_000);
  const concurrency = Math.max(1, params.concurrency ?? 4);
  if (chunk < 1n) throw new Error("Soapay: chunkSize must be >= 1");
  if (params.toBlock < params.fromBlock) return [];

  const ranges: [bigint, bigint][] = [];
  for (let from = params.fromBlock; from <= params.toBlock; from += chunk) {
    const to = from + chunk - 1n;
    ranges.push([from, to > params.toBlock ? params.toBlock : to]);
  }

  const results: AnnouncementRecord[][] = new Array(ranges.length);
  let next = 0;
  const worker = async () => {
    while (next < ranges.length) {
      const i = next++;
      const range = ranges[i];
      if (!range) return;
      const logs = await params.client.getLogs({
        address: params.announcer ?? ANNOUNCER_ADDRESS,
        event: announcementEvent,
        args: { schemeId: BigInt(SCHEME_ID) },
        fromBlock: range[0],
        toBlock: range[1],
      });
      const rows: AnnouncementRecord[] = [];
      for (const log of logs) {
        const { stealthAddress, caller, ephemeralPubKey, metadata, schemeId } = log.args;
        if (schemeId !== BigInt(SCHEME_ID)) continue;
        if (!stealthAddress || !caller || ephemeralPubKey === undefined || metadata === undefined) continue;
        if (log.blockNumber === null || log.transactionHash === null || log.logIndex === null) continue;
        rows.push({
          blockNumber: log.blockNumber,
          txHash: log.transactionHash,
          logIndex: log.logIndex,
          stealthAddress: getAddress(stealthAddress),
          caller: getAddress(caller),
          ephemeralPubKey: ephemeralPubKey.toLowerCase() as Hex,
          metadata: metadata.toLowerCase() as Hex,
        });
      }
      results[i] = rows;
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, ranges.length) }, worker));
  return results
    .flat()
    .sort((a, b) => (a.blockNumber === b.blockNumber ? a.logIndex - b.logIndex : a.blockNumber < b.blockNumber ? -1 : 1));
}

// ---------------------------------------------------------------------------------------------
// Metadata

/** Parsed announcement metadata. Every field is an UNTRUSTED hint written by whoever announced. */
export type MetadataHints = {
  format: 57 | 77;
  viewTag: number;
  selector: Hex;
  token: Address;
  amount: bigint;
  /** Only in StealthDisperse's 77-byte form. Trust it only when `caller` is StealthDisperse. */
  payer?: Address;
};

/** Parses 57-byte (EIP-5564 ERC-20) or 77-byte (StealthDisperse) metadata; null for anything else. */
export function parseMetadata(metadata: Hex): MetadataHints | null {
  if (!isHex(metadata)) return null;
  const h = metadata.slice(2).toLowerCase();
  if (h.length !== 114 && h.length !== 154) return null;
  const base = {
    format: (h.length === 114 ? 57 : 77) as 57 | 77,
    viewTag: Number.parseInt(h.slice(0, 2), 16),
    selector: `0x${h.slice(2, 10)}` as Hex,
    token: getAddress(`0x${h.slice(10, 50)}`),
    amount: BigInt(`0x${h.slice(50, 114)}`),
  };
  return h.length === 154 ? { ...base, payer: getAddress(`0x${h.slice(114, 154)}`) } : base;
}

/** The view tag hint (metadata byte 0), or undefined when metadata is empty. */
export function metadataViewTag(metadata: Hex): number | undefined {
  if (metadata.length < 4) return undefined;
  const v = Number.parseInt(metadata.slice(2, 4), 16);
  return Number.isNaN(v) ? undefined : v;
}

// ---------------------------------------------------------------------------------------------
// Scanning

export type ScanKeys = {
  /** 33-byte compressed spending public key. */
  spendingPublicKey: Hex;
  viewingPrivateKey: Hex;
};

export type ScanMatch = {
  announcement: AnnouncementRecord;
  /** Untrusted hints, null if the metadata is neither 57 nor 77 bytes. */
  hints: MetadataHints | null;
};

export type ScanStats = {
  scanned: number;
  /** Bad ephemeral key encoding or not a curve point. */
  malformed: number;
  /** Passed the view-tag prefilter and needed the full check. */
  fullChecks: number;
  matches: number;
};

function isCompressedKeyHex(k: Hex): boolean {
  return k.length === 68 && (k.startsWith("0x02") || k.startsWith("0x03")) && isHex(k);
}

/**
 * Finds the announcements that belong to `keys`. For each one: one ECDH with the viewing key, then the
 * view-tag prefilter (hash byte 0 vs metadata byte 0) drops ~255/256 of the rest before the full
 * ScopeLift `checkStealthAddress`.
 *
 * The ECDH uses variable-time scalar multiplication: the viewing key is local, and a timing side channel
 * on the client is outside the agreed threat model. Scanning is CPU-bound (one ECDH per announcement);
 * callers scanning large ranges should shard the input across workers.
 */
export function scanAnnouncementsWithStats(
  announcements: readonly AnnouncementRecord[],
  keys: ScanKeys,
): { matches: ScanMatch[]; stats: ScanStats } {
  const viewingKey = hexToBytes(keys.viewingPrivateKey);
  if (!secp256k1.utils.isValidSecretKey(viewingKey)) throw new Error("Soapay: invalid viewing key");
  if (!isCompressedKeyHex(keys.spendingPublicKey)) throw new Error("Soapay: spending key must be 33-byte compressed");
  const k = BigInt(keys.viewingPrivateKey);
  const Point = secp256k1.Point;

  const stats: ScanStats = { scanned: 0, malformed: 0, fullChecks: 0, matches: 0 };
  const matches: ScanMatch[] = [];

  for (const a of announcements) {
    stats.scanned++;
    if (!isCompressedKeyHex(a.ephemeralPubKey)) {
      stats.malformed++;
      continue;
    }
    let shared: Uint8Array;
    try {
      shared = Point.fromBytes(hexToBytes(a.ephemeralPubKey)).multiplyUnsafe(k).toBytes(true);
    } catch {
      stats.malformed++;
      continue;
    }
    const computedTag = keccak_256(shared)[0];
    const hintTag = metadataViewTag(a.metadata);
    if (hintTag !== undefined && hintTag !== computedTag) continue;

    stats.fullChecks++;
    const mine = checkStealthAddress({
      ephemeralPublicKey: a.ephemeralPubKey,
      schemeId: SCHEME_ID,
      spendingPublicKey: keys.spendingPublicKey,
      userStealthAddress: a.stealthAddress,
      viewingPrivateKey: keys.viewingPrivateKey,
      viewTag: toHex(computedTag ?? 0, { size: 1 }),
    });
    if (!mine) continue;
    stats.matches++;
    matches.push({ announcement: a, hints: parseMetadata(a.metadata) });
  }
  return { matches, stats };
}

export function scanAnnouncements(announcements: readonly AnnouncementRecord[], keys: ScanKeys): ScanMatch[] {
  return scanAnnouncementsWithStats(announcements, keys).matches;
}

/** Spending key for a match. Verifies it controls the announced address before returning it. */
export function deriveStealthKey(
  match: Pick<ScanMatch, "announcement">,
  keys: { spendingPrivateKey: Hex; viewingPrivateKey: Hex },
): Hex {
  const key = computeStealthKey({
    ephemeralPublicKey: match.announcement.ephemeralPubKey,
    spendingPrivateKey: keys.spendingPrivateKey,
    viewingPrivateKey: keys.viewingPrivateKey,
    schemeId: SCHEME_ID,
  });
  if (privateKeyToAccount(key).address !== getAddress(match.announcement.stealthAddress)) {
    throw new Error("Soapay: derived key does not control the stealth address");
  }
  return key;
}

// ---------------------------------------------------------------------------------------------
// Balances and ledger

export type BalanceRow = { stealthAddress: Address; token: Address; balance: bigint | null };

export type MulticallClient = Pick<PublicClient, "multicall">;

/** Reads the real balance of every matched stealth address for every token, in one multicall. */
export async function verifyBalances(params: {
  client: MulticallClient;
  matches: readonly Pick<ScanMatch, "announcement">[];
  tokens: readonly Address[];
}): Promise<BalanceRow[]> {
  const addrs = [...new Set(params.matches.map((m) => getAddress(m.announcement.stealthAddress)))];
  const pairs = addrs.flatMap((stealthAddress) => params.tokens.map((t) => ({ stealthAddress, token: getAddress(t) })));
  if (pairs.length === 0) return [];
  const results = await params.client.multicall({
    contracts: pairs.map((p) => ({
      address: p.token,
      abi: erc20Abi,
      functionName: "balanceOf" as const,
      args: [p.stealthAddress] as const,
    })),
    allowFailure: true,
  });
  return pairs.map((p, i) => {
    const r = results[i];
    return { ...p, balance: r && r.status === "success" ? (r.result as bigint) : null };
  });
}

export type LedgerFlag =
  /** No payer, or the payer is not in `knownPayers`. */
  | "unknown-payer"
  /** More than one announcement for this address (e.g. spam copies with fake metadata). */
  | "duplicate-announcement"
  /** Metadata is not a 57/77-byte token form. */
  | "no-metadata"
  /** Metadata names a different token than this row. */
  | "hint-token-mismatch"
  /** Metadata amount differs from the real balance (normal after a spend; suspicious before). */
  | "hint-amount-mismatch"
  /** The balance read failed. */
  | "balance-unavailable";

export type LedgerEntry = {
  stealthAddress: Address;
  token: Address;
  /** Real on-chain balance; the only amount the ledger trusts. null if the read failed. */
  balance: bigint | null;
  /** Best-supported payer: metadata payer when announced through StealthDisperse, else the caller. */
  payer: Address | null;
  payerKnown: boolean;
  /** Untrusted, for display only. */
  claimedAmount: bigint | null;
  flags: LedgerFlag[];
  announcements: AnnouncementRecord[];
};

function payerOf(m: ScanMatch, disperse: Set<string>): Address | null {
  if (disperse.has(m.announcement.caller.toLowerCase())) return m.hints?.payer ?? null;
  return m.announcement.caller;
}

/**
 * One entry per (stealth address, token), amounts from real balances only. Entries from unknown payers
 * are kept and ranked after known ones (payerKnown desc, then balance desc).
 *
 * `stealthDisperse` lists StealthDisperse deployments: only for those callers is the metadata payer
 * used, since StealthDisperse writes msg.sender there. Anyone else can call the Announcer directly with
 * any metadata, so for them the payer is the announcing `caller`.
 */
export function buildLedger(
  matches: readonly ScanMatch[],
  balances: readonly BalanceRow[],
  knownPayers: readonly Address[] = [],
  opts: { stealthDisperse?: readonly Address[] } = {},
): LedgerEntry[] {
  const known = new Set(knownPayers.map((p) => p.toLowerCase()));
  const disperse = new Set((opts.stealthDisperse ?? []).map((p) => p.toLowerCase()));

  const byAddress = new Map<string, ScanMatch[]>();
  for (const m of matches) {
    const key = m.announcement.stealthAddress.toLowerCase();
    const list = byAddress.get(key);
    if (list) list.push(m);
    else byAddress.set(key, [m]);
  }

  const entries: LedgerEntry[] = [];
  for (const b of balances) {
    const group = byAddress.get(b.stealthAddress.toLowerCase());
    if (!group || group.length === 0) continue;
    // Prefer the announcement whose payer we know; then the earliest one.
    const ranked = [...group].sort((x, y) => {
      const kx = known.has((payerOf(x, disperse) ?? "").toLowerCase()) ? 0 : 1;
      const ky = known.has((payerOf(y, disperse) ?? "").toLowerCase()) ? 0 : 1;
      if (kx !== ky) return kx - ky;
      const ax = x.announcement;
      const ay = y.announcement;
      return ax.blockNumber === ay.blockNumber ? ax.logIndex - ay.logIndex : ax.blockNumber < ay.blockNumber ? -1 : 1;
    });
    const best = ranked[0];
    if (!best) continue;
    const payer = payerOf(best, disperse);
    const payerKnown = payer !== null && known.has(payer.toLowerCase());
    const hints = best.hints;
    const hintTokenMatches = hints !== null && hints.token.toLowerCase() === b.token.toLowerCase();

    const flags: LedgerFlag[] = [];
    if (!payerKnown) flags.push("unknown-payer");
    if (group.length > 1) flags.push("duplicate-announcement");
    if (hints === null) flags.push("no-metadata");
    else if (!hintTokenMatches) flags.push("hint-token-mismatch");
    if (b.balance === null) flags.push("balance-unavailable");
    else if (hintTokenMatches && hints.amount !== b.balance) flags.push("hint-amount-mismatch");

    entries.push({
      stealthAddress: getAddress(b.stealthAddress),
      token: getAddress(b.token),
      balance: b.balance,
      payer,
      payerKnown,
      claimedAmount: hintTokenMatches ? hints.amount : null,
      flags,
      announcements: group.map((m) => m.announcement),
    });
  }

  return entries.sort((x, y) => {
    if (x.payerKnown !== y.payerKnown) return x.payerKnown ? -1 : 1;
    const bx = x.balance ?? -1n;
    const by = y.balance ?? -1n;
    return bx === by ? 0 : bx > by ? -1 : 1;
  });
}
