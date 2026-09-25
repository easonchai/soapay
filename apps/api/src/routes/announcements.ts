import { Hono } from "hono";
import type { AppDeps } from "../app.js";
import { ApiError } from "../util.js";

export const DEFAULT_LIMIT = 500;
export const MAX_LIMIT = 2000;

type Row = {
  block_number: number;
  log_index: number;
  tx_hash: string;
  stealth_address: string;
  caller: string;
  ephemeral_pub_key: string;
  metadata: string;
};

function blockParam(v: string | undefined, name: string): number | undefined {
  if (v === undefined || v === "") return undefined;
  if (!/^\d{1,15}$/.test(v)) throw new ApiError(400, "invalid_query", `${name} must be a block number`);
  return Number(v);
}

/** Cursor = "<blockNumber>:<logIndex>" of the last item returned; the next page starts after it. */
export function encodeCursor(block: number, logIndex: number): string {
  return `${block}:${logIndex}`;
}

function decodeCursor(v: string | undefined): [number, number] | undefined {
  if (v === undefined || v === "") return undefined;
  const m = /^(\d{1,15}):(\d{1,9})$/.exec(v);
  if (!m) throw new ApiError(400, "invalid_query", "cursor is malformed");
  return [Number(m[1]), Number(m[2])];
}

/**
 * All scheme-1 announcements, ascending by (blockNumber, logIndex). No recipient
 * filtering, ever: clients filter by view tag locally.
 */
export function announcementRoutes(deps: AppDeps): Hono {
  const r = new Hono();
  r.get("/announcements", (c) => {
    const q = c.req.query();
    const fromBlock = blockParam(q.fromBlock ?? q.from, "fromBlock");
    const toBlock = blockParam(q.toBlock ?? q.to, "toBlock");
    const cursor = decodeCursor(q.cursor);
    let limit = DEFAULT_LIMIT;
    if (q.limit !== undefined) {
      if (!/^\d{1,6}$/.test(q.limit) || Number(q.limit) < 1) throw new ApiError(400, "invalid_query", "limit must be >= 1");
      limit = Math.min(Number(q.limit), MAX_LIMIT);
    }

    const where: string[] = [];
    const args: number[] = [];
    if (fromBlock !== undefined) (where.push("block_number >= ?"), args.push(fromBlock));
    if (toBlock !== undefined) (where.push("block_number <= ?"), args.push(toBlock));
    if (cursor) (where.push("(block_number, log_index) > (?, ?)"), args.push(cursor[0], cursor[1]));
    const sql = `SELECT block_number, log_index, tx_hash, stealth_address, caller, ephemeral_pub_key, metadata
                 FROM announcements ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
                 ORDER BY block_number ASC, log_index ASC LIMIT ?`;
    const rows = deps.db.prepare(sql).all(...args, limit + 1) as Row[];
    const page = rows.slice(0, limit);
    const last = page.at(-1);
    const head = deps.indexer?.head();

    return c.json({
      items: page.map((r) => ({
        blockNumber: String(r.block_number),
        txHash: r.tx_hash,
        logIndex: r.log_index,
        stealthAddress: r.stealth_address,
        caller: r.caller,
        ephemeralPubKey: r.ephemeral_pub_key,
        metadata: r.metadata,
      })),
      nextCursor: rows.length > limit && last ? encodeCursor(last.block_number, last.log_index) : null,
      ...(head !== undefined ? { head: head.toString() } : {}),
    });
  });
  return r;
}
