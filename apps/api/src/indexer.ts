import { getAnnouncements, type ReadClient } from "./chain.js";
import { getState, setState, tx, type Db } from "./db.js";
import type { Logger } from "./util.js";

const HEAD_KEY = "announcements.lastIndexedBlock";
const CHUNK_KEY = "announcements.chunkSize";

export type IndexerOptions = {
  db: Db;
  client: ReadClient;
  startBlock: bigint;
  /** Initial (and maximum) getLogs range, in blocks. Halved on RPC range errors. */
  chunkSize: number;
  /** Blocks behind the last indexed head that get re-scanned every tick. */
  reorgDepth: number;
  pollMs: number;
  logger: Logger;
};

/** Heuristic for "your getLogs range / result set is too large" across common RPC providers. */
export function isRangeError(e: unknown): boolean {
  const parts: string[] = [];
  let cur: any = e;
  for (let i = 0; cur && i < 6; i++) {
    parts.push(String(cur.message ?? ""), String(cur.details ?? ""), String(cur.shortMessage ?? ""));
    if (cur.code === -32005) return true;
    cur = cur.cause;
  }
  const text = parts.join(" ").toLowerCase();
  // e.g. sepolia.base.org: {"code":-32614,"message":"eth_getLogs is limited to a 1,000 range"}
  return /block range|limited to|range (is )?too (large|wide)|range limit|exceeds? (the )?(max|limit|range)|too many (results|logs|blocks)|more than \d+ (results|logs)|query returned more than|response size|limit exceeded|query timeout|max(imum)? (block )?range/.test(
    text,
  );
}

export class Indexer {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private running = false;
  private stopped = false;
  private streak = 0;
  private chunk: number;
  private readonly maxChunk: number;
  latestBlock: bigint | undefined;
  lastError: string | undefined;

  constructor(private readonly o: IndexerOptions) {
    this.maxChunk = Math.max(1, o.chunkSize);
    const saved = Number(getState(o.db, CHUNK_KEY) ?? NaN);
    this.chunk = Number.isFinite(saved) && saved >= 1 ? Math.min(saved, this.maxChunk) : this.maxChunk;
  }

  /** Last fully indexed block (inclusive), or startBlock - 1 before the first chunk lands. */
  head(): bigint {
    const v = getState(this.o.db, HEAD_KEY);
    return v === undefined ? this.o.startBlock - 1n : BigInt(v);
  }

  get chunkSize(): number {
    return this.chunk;
  }

  /**
   * One pass: re-scan the reorg window, then walk forward to the tip in adaptive chunks.
   * Each chunk replaces the rows in its block range and advances the head atomically,
   * so a crash anywhere resumes from indexer_state.
   */
  async tick(opts: { maxChunks?: number } = {}): Promise<void> {
    const latest = await this.o.client.getBlockNumber();
    this.latestBlock = latest;
    const head = this.head();
    let from = head + 1n - BigInt(this.o.reorgDepth);
    if (from < this.o.startBlock) from = this.o.startBlock;
    if (head > latest) {
      // The chain went backwards past our head (deep reorg or RPC switch): rescan the window.
      from = latest - BigInt(this.o.reorgDepth) + 1n;
      if (from < this.o.startBlock) from = this.o.startBlock;
    }
    let chunks = 0;
    while (from <= latest) {
      if (this.stopped) return;
      if (opts.maxChunks !== undefined && chunks >= opts.maxChunks) return;
      let to = from + BigInt(this.chunk) - 1n;
      if (to > latest) to = latest;
      let rows;
      try {
        rows = await getAnnouncements(this.o.client, from, to);
      } catch (e) {
        if (isRangeError(e) && this.chunk > 1) {
          this.chunk = Math.max(1, Math.floor(this.chunk / 2));
          this.streak = 0;
          setState(this.o.db, CHUNK_KEY, String(this.chunk));
          this.o.logger.warn("indexer: range error, halving chunk", { chunk: this.chunk });
          continue;
        }
        throw e;
      }
      this.store(from, to, rows);
      chunks++;
      // Probe back up after a run of clean chunks, in case the error was transient.
      if (++this.streak >= 20 && this.chunk < this.maxChunk) {
        this.chunk = Math.min(this.maxChunk, this.chunk * 2);
        this.streak = 0;
        setState(this.o.db, CHUNK_KEY, String(this.chunk));
      }
      from = to + 1n;
    }
  }

  private store(from: bigint, to: bigint, rows: Awaited<ReturnType<typeof getAnnouncements>>): void {
    const db = this.o.db;
    tx(db, () => {
      // Replace the whole range so logs dropped by a reorg disappear too.
      db.prepare("DELETE FROM announcements WHERE block_number BETWEEN ? AND ?").run(from, to);
      const ins = db.prepare(
        `INSERT INTO announcements
           (block_number, log_index, tx_hash, block_hash, stealth_address, caller, ephemeral_pub_key, metadata)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(tx_hash, log_index) DO UPDATE SET
           block_number = excluded.block_number, block_hash = excluded.block_hash,
           stealth_address = excluded.stealth_address, caller = excluded.caller,
           ephemeral_pub_key = excluded.ephemeral_pub_key, metadata = excluded.metadata`,
      );
      for (const r of rows) {
        ins.run(r.blockNumber, r.logIndex, r.txHash, r.blockHash, r.stealthAddress, r.caller, r.ephemeralPubKey, r.metadata);
      }
      const head = this.head();
      // Rescanning the reorg window must not move the head backwards.
      if (to > head) setState(db, HEAD_KEY, to.toString());
    });
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.stopped = false;
    const loop = async () => {
      if (!this.running) return;
      let delay = this.o.pollMs;
      try {
        await this.tick();
        if (this.lastError) this.o.logger.info("indexer: recovered");
        this.lastError = undefined;
      } catch (e) {
        this.lastError = (e as Error).message?.split("\n")[0] ?? String(e);
        this.o.logger.error("indexer: tick failed", { error: this.lastError });
        delay = Math.min(this.o.pollMs * 5, 60_000);
      }
      if (this.running) this.timer = setTimeout(loop, delay);
    };
    this.o.logger.info("indexer: starting", { head: this.head().toString(), startBlock: this.o.startBlock.toString() });
    void loop();
  }

  stop(): void {
    this.running = false;
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
  }
}
