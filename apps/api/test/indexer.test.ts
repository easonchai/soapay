import { describe, expect, it } from "vitest";
import { ANNOUNCER_ADDRESS, CHAINS } from "@soapay/sdk";
import { Indexer, isRangeError } from "../src/indexer.js";
import type { ReadClient } from "../src/chain.js";
import { makeTestApp, j } from "./helpers.js";

const START = CHAINS[84532].announcerStartBlock;

type FakeLog = { blockNumber: bigint; logIndex: number };

/** A chain of announcements plus a getLogs that rejects ranges wider than maxRange. */
function fakeChain(logs: FakeLog[], latest: bigint, maxRange: bigint) {
  const calls: [bigint, bigint][] = [];
  const state = { logs, latest };
  const getLogs = async (a: any) => {
    expect(a.address).toBe(ANNOUNCER_ADDRESS);
    expect(a.args).toEqual({ schemeId: 1n }); // scheme only: never filtered by recipient
    calls.push([a.fromBlock, a.toBlock]);
    if ((a.toBlock as bigint) - (a.fromBlock as bigint) + 1n > maxRange) {
      const err: any = new Error("RPC Request failed.");
      err.cause = { message: "eth_getLogs is limited to a 1000 block range", code: -32600 };
      throw err;
    }
    return state.logs
      .filter((l) => l.blockNumber >= a.fromBlock && l.blockNumber <= a.toBlock)
      .map((l) => ({
        blockNumber: l.blockNumber,
        logIndex: l.logIndex,
        transactionHash: `0x${l.blockNumber.toString(16).padStart(40, "0")}${l.logIndex.toString(16).padStart(24, "0")}`,
        blockHash: `0x${"bb".repeat(32)}`,
        args: {
          schemeId: 1n,
          stealthAddress: `0x${(Number(l.blockNumber % 1000n) + 1).toString(16).padStart(40, "0")}`,
          caller: `0x${"cc".repeat(20)}`,
          ephemeralPubKey: `0x02${"ee".repeat(32)}`,
          metadata: `0x${"aa".repeat(77)}`,
        },
      }));
  };
  return { calls, state, getLogs };
}

function makeIndexer(t: ReturnType<typeof makeTestApp>, chain: ReturnType<typeof fakeChain>, chunkSize = 4000) {
  t.client.getLogs.mockImplementation(chain.getLogs);
  t.client.getBlockNumber.mockImplementation(async () => chain.state.latest);
  return new Indexer({
    db: t.db,
    client: t.client as unknown as ReadClient,
    startBlock: START,
    chunkSize,
    pollMs: 1000,
    reorgDepth: 10,
    logger: t.deps.logger,
  });
}

describe("indexer", () => {
  it("recognises range errors in nested causes", () => {
    expect(isRangeError({ message: "x", cause: { message: "query returned more than 10000 results" } })).toBe(true);
    expect(isRangeError({ code: -32005 })).toBe(true);
    expect(isRangeError({ shortMessage: "RPC Request failed.", details: "eth_getLogs is limited to a 1,000 range" })).toBe(true);
    expect(isRangeError(new Error("connection refused"))).toBe(false);
  });

  it("backfills from the announcer start block, halving the chunk on range errors", async () => {
    const t = makeTestApp();
    const logs = [
      { blockNumber: START, logIndex: 0 },
      { blockNumber: START, logIndex: 3 },
      { blockNumber: START + 1500n, logIndex: 1 },
      { blockNumber: START + 4999n, logIndex: 7 },
    ];
    const chain = fakeChain(logs, START + 5000n, 1000n);
    const ix = makeIndexer(t, chain);
    expect(ix.head()).toBe(START - 1n);

    await ix.tick();
    expect(ix.chunkSize).toBe(1000); // 4000 → 2000 → 1000
    expect(chain.calls[0]).toEqual([START, START + 3999n]);
    expect(chain.calls[1]).toEqual([START, START + 1999n]);
    expect(chain.calls[2]).toEqual([START, START + 999n]);
    expect(ix.head()).toBe(START + 5000n);
    expect(ix.latestBlock).toBe(START + 5000n);
    const n = t.db.prepare("SELECT COUNT(*) AS n FROM announcements").get() as { n: number };
    expect(n.n).toBe(4);
  });

  it("resumes from indexer_state, re-scanning only the reorg window", async () => {
    const t = makeTestApp();
    const chain = fakeChain([{ blockNumber: START + 10n, logIndex: 0 }], START + 3000n, 1000n);
    const first = makeIndexer(t, chain, 1000);
    await first.tick({ maxChunks: 2 }); // "crash" after two chunks
    expect(first.head()).toBe(START + 1999n);

    chain.calls.length = 0;
    const second = makeIndexer(t, chain, 1000);
    await second.tick();
    expect(chain.calls[0]![0]).toBe(START + 1999n + 1n - 10n);
    expect(second.head()).toBe(START + 3000n);
    const n = t.db.prepare("SELECT COUNT(*) AS n FROM announcements").get() as { n: number };
    expect(n.n).toBe(1);
  });

  it("drops announcements that a reorg removed and upserts the replacements", async () => {
    const t = makeTestApp();
    const chain = fakeChain([{ blockNumber: START + 95n, logIndex: 0 }], START + 100n, 1000n);
    const ix = makeIndexer(t, chain);
    await ix.tick();
    chain.state.logs = [{ blockNumber: START + 97n, logIndex: 2 }];
    chain.state.latest = START + 102n;
    await ix.tick();
    const rows = t.db.prepare("SELECT block_number, log_index FROM announcements").all();
    expect(rows).toEqual([{ block_number: Number(START + 97n), log_index: 2 }]);
  });

  it("feeds /health", async () => {
    const t = makeTestApp({ indexer: true });
    const chain = fakeChain([], START + 50n, 1000n);
    t.client.getLogs.mockImplementation(chain.getLogs);
    t.client.getBlockNumber.mockResolvedValue(START + 50n);
    await t.indexer!.tick();
    t.client.getBlockNumber.mockResolvedValue(START + 60n);
    t.indexer!.latestBlock = START + 60n;
    const h = await j(await t.app.request("/health"));
    expect(h).toEqual({
      ok: true,
      chainId: 84532,
      indexerHead: String(START + 50n),
      latestBlock: String(START + 60n),
      lag: 10,
    });
  });
});

describe("GET /announcements", () => {
  function seedRows(t: ReturnType<typeof makeTestApp>) {
    const ins = t.db.prepare(
      "INSERT INTO announcements VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    );
    const rows: [number, number][] = [[100, 5], [100, 1], [101, 0], [150, 2], [200, 9]];
    for (const [b, l] of rows) ins.run(b, l, `0x${b}${l}`, "0xbh", `0xstealth${b}${l}`, "0xcaller", "0xeph", "0xmeta");
  }

  it("paginates ascending by (blockNumber, logIndex) with string block numbers", async () => {
    const t = makeTestApp({ indexer: true });
    seedRows(t);
    const p1 = await j(await t.app.request("/announcements?limit=2"));
    expect(p1.items.map((i: any) => [i.blockNumber, i.logIndex])).toEqual([["100", 1], ["100", 5]]);
    expect(p1.items[0]).toEqual({
      blockNumber: "100",
      txHash: "0x1001",
      logIndex: 1,
      stealthAddress: "0xstealth1001",
      caller: "0xcaller",
      ephemeralPubKey: "0xeph",
      metadata: "0xmeta",
    });
    expect(p1.nextCursor).toBe("100:5");
    expect(typeof p1.head).toBe("string");

    const p2 = await j(await t.app.request(`/announcements?limit=2&cursor=${p1.nextCursor}`));
    expect(p2.items.map((i: any) => [i.blockNumber, i.logIndex])).toEqual([["101", 0], ["150", 2]]);
    const p3 = await j(await t.app.request(`/announcements?limit=2&cursor=${p2.nextCursor}`));
    expect(p3.items.map((i: any) => i.blockNumber)).toEqual(["200"]);
    expect(p3.nextCursor).toBeNull();
  });

  it("filters by block range", async () => {
    const t = makeTestApp();
    seedRows(t);
    const r = await j(await t.app.request("/announcements?from=101&to=150"));
    expect(r.items.map((i: any) => i.blockNumber)).toEqual(["101", "150"]);
    expect(r.nextCursor).toBeNull();
    expect(r).not.toHaveProperty("head");
  });

  it("rejects bad query params", async () => {
    const t = makeTestApp();
    expect((await t.app.request("/announcements?cursor=nope")).status).toBe(400);
    expect((await t.app.request("/announcements?fromBlock=-1")).status).toBe(400);
    expect((await t.app.request("/announcements?limit=0")).status).toBe(400);
  });

  it("applies CORS only for configured origins", async () => {
    const t = makeTestApp();
    const ok = await t.app.request("/announcements", { headers: { origin: "http://localhost:5173" } });
    expect(ok.headers.get("access-control-allow-origin")).toBe("http://localhost:5173");
    const no = await t.app.request("/announcements", { headers: { origin: "https://evil.example" } });
    expect(no.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("returns JSON 404s", async () => {
    const t = makeTestApp();
    const r = await t.app.request("/nope");
    expect(r.status).toBe(404);
    expect(await j(r)).toEqual({ error: { code: "not_found", message: "Route not found" } });
  });
});
