import { describe, expect, it } from "vitest";
import {
  ClusterGraph,
  buildMetadata77,
  derivePayRun,
  generateMnemonic,
  getChainConfig,
  keysFromMnemonic,
  splitIntoDenominations,
  type AnnouncementRecord,
  type ScanKeys,
} from "@soapay/sdk";
import { getAddress, keccak256, toHex, type Address, type Hex } from "viem";
import { keysForGeneration, keyRing, scanKeysOf } from "../src/features/rotation/keys.js";
import { handleScanRequest, type ScanRequest, type ScanResponse } from "../src/scan/protocol.js";
import { ScanAborted, ScanPool, type WorkerLike } from "../src/scan/pool.js";
import { ledgerFromState, mergeScanResult, runScan, type ScanClient } from "../src/scan/scanner.js";
import { emptyChainState } from "../src/vault/types.js";

const CHAIN = 84532;
const cfg = getChainConfig(CHAIN);
const EMPLOYER: Address = "0x5ca1ab1e00000000000000000000000000000e3e";
const DISPERSE: Address = "0xd15fe25e00000000000000000000000000000d15";
const UNIT = 1_000_000n;

/** Runs the real worker code in-process, asynchronously, like a Worker would. */
function inProcessWorker(): WorkerLike {
  const w: WorkerLike = {
    onmessage: null,
    onerror: null,
    postMessage(msg: ScanRequest) {
      setTimeout(() => handleScanRequest(msg, (r: ScanResponse) => w.onmessage?.({ data: r })), 0);
    },
    terminate() {},
  };
  return w;
}

const scanKeys = (m: string): ScanKeys => {
  const k = keysFromMnemonic(m);
  return { spendingPublicKey: k.spendingPublicKey, viewingPrivateKey: k.viewingKey };
};

type Built = { anns: AnnouncementRecord[]; balances: Map<string, bigint>; mine: Set<string> };

/** A batch mixing my denominated salary with 30 coworkers' lines, as StealthDisperse would announce it. */
function payRun(block: bigint, metas: { me: string; others: string[] }, salary: bigint, tx: string): Built {
  const mine = derivePayRun({
    recipients: [{ metaAddressURI: metas.me, amount: salary, id: "me" }],
    denominate: (a) => splitIntoDenominations(a, 500n * UNIT).chunks,
  });
  const others = derivePayRun({ recipients: metas.others.map((m, i) => ({ metaAddressURI: m, amount: 1_234n * UNIT, id: `o${i}` })) });
  const lines = [...mine, ...others].sort((a, b) => (a.stealthAddress.toLowerCase() < b.stealthAddress.toLowerCase() ? -1 : 1));
  const txHash = keccak256(toHex(tx));
  const balances = new Map<string, bigint>();
  const anns = lines.map((l, logIndex) => {
    balances.set(l.stealthAddress.toLowerCase(), l.amount);
    return {
      blockNumber: block,
      txHash,
      logIndex,
      schemeId: 1n,
      stealthAddress: l.stealthAddress,
      caller: DISPERSE,
      ephemeralPubKey: l.ephemeralPublicKey,
      metadata: buildMetadata77({ viewTag: l.viewTag, token: cfg.usdc, amount: l.amount, payer: EMPLOYER }),
    } as AnnouncementRecord;
  });
  return { anns, balances, mine: new Set(mine.map((l) => l.stealthAddress.toLowerCase())) };
}

function fakeClient(anns: AnnouncementRecord[], balances: Map<string, bigint>, head: bigint): ScanClient {
  return {
    getBlockNumber: async () => head,
    getLogs: (async (args: { fromBlock: bigint; toBlock: bigint }) =>
      anns
        .filter((a) => a.blockNumber >= args.fromBlock && a.blockNumber <= args.toBlock)
        .map((a) => ({
          blockNumber: a.blockNumber,
          transactionHash: a.txHash,
          logIndex: a.logIndex,
          args: { schemeId: 1n, stealthAddress: a.stealthAddress, caller: a.caller, ephemeralPubKey: a.ephemeralPubKey, metadata: a.metadata },
        }))) as unknown as ScanClient["getLogs"],
    multicall: (async (args: { contracts: { args: readonly [Address] }[] }) =>
      args.contracts.map((c) => ({ status: "success", result: balances.get(c.args[0].toLowerCase()) ?? 0n }))) as unknown as ScanClient["multicall"],
  };
}

const me = generateMnemonic();
const meta = keysFromMnemonic(me).metaAddressURI;
const coworkers = Array.from({ length: 30 }, () => keysFromMnemonic(generateMnemonic()).metaAddressURI);

describe("ScanPool", () => {
  it("finds exactly my lines across jobs and workers, in chain order", async () => {
    const run = payRun(cfg.announcerStartBlock + 10n, { me: meta, others: coworkers }, 2_600n * UNIT, "run1");
    const pool = new ScanPool(inProcessWorker, 3, 7);
    const progress: number[] = [];
    const r = await pool.scan(run.anns, scanKeys(me), { onProgress: (p) => progress.push(p.scanned) });
    expect(r.matches.map((m) => m.announcement.stealthAddress.toLowerCase()).sort()).toEqual([...run.mine].sort());
    expect(r.stats.scanned).toBe(run.anns.length);
    expect(r.workers).toBe(3);
    expect(progress.at(-1)).toBe(run.anns.length);
    const idx = r.matches.map((m) => m.announcement.logIndex);
    expect(idx).toEqual([...idx].sort((a, b) => a - b));
  });

  it("aborts", async () => {
    const run = payRun(cfg.announcerStartBlock + 10n, { me: meta, others: coworkers }, 1_000n * UNIT, "run-abort");
    const ctrl = new AbortController();
    ctrl.abort();
    await expect(new ScanPool(inProcessWorker, 2, 4).scan(run.anns, scanKeys(me), { signal: ctrl.signal })).rejects.toBeInstanceOf(ScanAborted);
  });
});

describe("runScan", () => {
  it("scans incrementally, reads real balances, and builds the ledger and guard graph", async () => {
    const b1 = cfg.announcerStartBlock + 100n;
    const b2 = cfg.announcerStartBlock + 2_000n;
    const r1 = payRun(b1, { me: meta, others: coworkers }, 2_600n * UNIT, "run1");
    const r2 = payRun(b2, { me: meta, others: coworkers.slice(0, 10) }, 2_750n * UNIT, "run2");
    const balances = new Map([...r1.balances, ...r2.balances]);
    const pool = new ScanPool(inProcessWorker, 2, 16);
    const deps = { chainId: CHAIN, apiUrl: "http://unused", useRpc: true, fetch: fetch, pool, keys: scanKeys(me) };

    // First scan sees only run 1.
    const first = await runScan(emptyChainState(), { ...deps, client: fakeClient(r1.anns, balances, b1 + 5n) });
    expect(first.state.matches).toHaveLength(r1.mine.size);
    expect(first.state.lastScannedBlock).toBe((b1 + 5n).toString());

    // Second scan resumes after the last block and adds run 2.
    const second = await runScan(first.state, { ...deps, client: fakeClient([...r1.anns, ...r2.anns], balances, b2 + 1n) });
    expect(second.fromBlock).toBe(b1 + 6n);
    expect(second.newMatches).toBe(r2.mine.size);
    expect(second.state.matches).toHaveLength(r1.mine.size + r2.mine.size);

    const ledger = ledgerFromState(second.state, [EMPLOYER], [DISPERSE]);
    const total = ledger.reduce((a, e) => a + (e.balance ?? 0n), 0n);
    expect(total).toBe(5_350n * UNIT);
    expect(ledger.every((e) => e.payerKnown && e.payer === getAddress(EMPLOYER))).toBe(true);

    // Every stealth address starts as its own cluster.
    const g = ClusterGraph.fromJSON(second.state.graph!);
    expect(g.clusters()).toHaveLength(r1.mine.size + r2.mine.size);
  });

  it("scans every key generation after a rotation", async () => {
    const gen1 = keysForGeneration(me, 1).metaAddressURI;
    const block = cfg.announcerStartBlock + 50n;
    const old = payRun(block, { me: meta, others: coworkers.slice(0, 5) }, 500n * UNIT, "old");
    const neu = payRun(block + 1n, { me: gen1, others: coworkers.slice(0, 5) }, 500n * UNIT, "new");
    const ring = keyRing(me, 1);
    const out = await runScan(emptyChainState(), {
      chainId: CHAIN,
      apiUrl: "",
      useRpc: true,
      fetch,
      pool: new ScanPool(inProcessWorker, 2),
      keys: scanKeysOf(ring),
      client: fakeClient([...old.anns, ...neu.anns], new Map([...old.balances, ...neu.balances]), block + 2n),
    });
    expect(out.state.matches).toHaveLength(2);
  });

  it("mergeScanResult keeps labels and spend links made while the scan ran", async () => {
    const block = cfg.announcerStartBlock + 10n;
    const run = payRun(block, { me: meta, others: coworkers.slice(0, 3) }, 1_000n * UNIT, "merge");
    const scanned = await runScan(emptyChainState(), {
      chainId: CHAIN,
      apiUrl: "",
      useRpc: true,
      fetch,
      pool: new ScanPool(inProcessWorker, 1),
      keys: scanKeys(me),
      client: fakeClient(run.anns, run.balances, block),
    });
    const wallet = "0x1111111111111111111111111111111111111111" as Address;
    const latest = { ...emptyChainState(), graph: new ClusterGraph().addExternal(wallet).setLabel(wallet, "main-wallet").toJSON(), spends: [] };
    const merged = mergeScanResult(latest, scanned.state);
    const g = ClusterGraph.fromJSON(merged.graph!);
    expect(g.labelOf(wallet)).toBe("main-wallet");
    expect(merged.matches).toHaveLength(scanned.state.matches.length);
    expect(merged.spends).toEqual([]);
  });
});

export type { Hex };
