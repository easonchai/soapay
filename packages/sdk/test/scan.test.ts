import { describe, expect, it } from "vitest";
import { bytesToHex, getAddress, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { generateRandomStealthMetaAddress, generateStealthAddress } from "@scopelift/stealth-address-sdk";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { buildMetadata57, buildMetadata77, derivePayRun, type PayRunLine } from "../src/payrun.js";
import {
  buildLedger,
  deriveStealthKey,
  fetchAnnouncements,
  fetchAnnouncementsRpc,
  parseMetadata,
  scanAnnouncements,
  scanAnnouncementsWithStats,
  verifyBalances,
  type AnnouncementRecord,
  type FetchLike,
  type LogsClient,
  type MulticallClient,
} from "../src/scan.js";

// The SDK's lib is ES2022 without DOM/Node globals.
const host = globalThis as unknown as {
  performance: { now(): number };
  console: { log(msg: string): void };
  setTimeout(fn: (v?: unknown) => void, ms: number): unknown;
  process: { env: Record<string, string | undefined> };
};

const TOKEN = getAddress("0x036CbD53842c5426634e7929541eC2318f3dCF7e");
const DISPERSE = getAddress("0x00000000000000000000000000000000DeaDBeef");
const EMPLOYER = getAddress("0x1111111111111111111111111111111111111111");
const ATTACKER = getAddress("0x2222222222222222222222222222222222222222");

let logIndex = 0;
function annFromLine(l: PayRunLine, opts: { caller?: Address; metadata?: Hex } = {}): AnnouncementRecord {
  return {
    blockNumber: 100n,
    txHash: `0x${"ab".repeat(32)}`,
    logIndex: logIndex++,
    stealthAddress: l.stealthAddress,
    caller: opts.caller ?? DISPERSE,
    ephemeralPubKey: l.ephemeralPublicKey,
    metadata: opts.metadata ?? buildMetadata77({ viewTag: l.viewTag, token: TOKEN, amount: l.amount, payer: EMPLOYER }),
  };
}

function setup() {
  const people = ["alice", "bob", "carol"].map((id) => ({ id, keys: generateRandomStealthMetaAddress() }));
  const lines = derivePayRun({
    recipients: people.map((p, i) => ({ metaAddressURI: p.keys.stealthMetaAddressURI, amount: BigInt(3000 + i), id: p.id })),
    denominate: (a) => [a / 3n, a / 3n, a - 2n * (a / 3n)],
  });
  return { people, lines, anns: lines.map((l) => annFromLine(l)) };
}

function fakeMulticall(balances: Map<string, bigint>): MulticallClient {
  return {
    multicall: (async ({ contracts }: { contracts: { address: Address; args: readonly [Address] }[] }) =>
      contracts.map((c) => ({
        status: "success" as const,
        result: balances.get(`${c.args[0].toLowerCase()}:${c.address.toLowerCase()}`) ?? 0n,
      }))) as unknown as MulticallClient["multicall"],
  };
}

describe("parseMetadata", () => {
  it("parses 57 and 77 byte forms; null otherwise", () => {
    const m57 = parseMetadata(buildMetadata57({ viewTag: 0xab, token: TOKEN, amount: 77n }));
    expect(m57).toEqual({ format: 57, viewTag: 0xab, selector: "0xa9059cbb", token: TOKEN, amount: 77n });
    const m77 = parseMetadata(buildMetadata77({ viewTag: 1, token: TOKEN, amount: 5n, payer: EMPLOYER }));
    expect(m77?.payer).toBe(EMPLOYER);
    expect(m77?.format).toBe(77);
    expect(parseMetadata("0x")).toBeNull();
    expect(parseMetadata("0xab")).toBeNull();
    expect(parseMetadata(`0x${"00".repeat(58)}`)).toBeNull();
  });
});

describe("full loop in memory", () => {
  it("each recipient's scan finds exactly its own lines, and can spend them", () => {
    const { people, lines, anns } = setup();
    for (const p of people) {
      const { matches, stats } = scanAnnouncementsWithStats(anns, p.keys);
      const expected = lines.filter((l) => l.recipientId === p.id).map((l) => l.stealthAddress).sort();
      expect(matches.map((m) => m.announcement.stealthAddress).sort()).toEqual(expected);
      expect(stats.matches).toBe(3);
      for (const m of matches) {
        expect(m.hints?.payer).toBe(EMPLOYER);
        const key = deriveStealthKey(m, p.keys);
        expect(privateKeyToAccount(key).address).toBe(m.announcement.stealthAddress);
      }
    }
  });

  it("finds 57-byte (EIP-5792 batch) and metadata-less announcements too", () => {
    const { people, lines } = setup();
    const alice = people[0]!;
    const aliceLines = lines.filter((l) => l.recipientId === "alice");
    const anns = [
      annFromLine(aliceLines[0]!, { caller: EMPLOYER, metadata: buildMetadata57({ viewTag: aliceLines[0]!.viewTag, token: TOKEN, amount: 1n }) }),
      annFromLine(aliceLines[1]!, { caller: EMPLOYER, metadata: "0x" }),
    ];
    expect(scanAnnouncements(anns, alice.keys)).toHaveLength(2);
  });

  it("deriveStealthKey refuses a match that is not ours", () => {
    const { people, anns } = setup();
    const bobMatch = scanAnnouncements(anns, people[1]!.keys)[0]!;
    expect(() => deriveStealthKey(bobMatch, people[0]!.keys)).toThrow(/does not control/);
  });
});

describe("spam and untrusted metadata", () => {
  it("flags spam and fake metadata instead of trusting it", async () => {
    const { people, lines, anns } = setup();
    const alice = people[0]!;
    const aliceLine = lines.find((l) => l.recipientId === "alice")!;

    // 1. Replay of a real announcement, sent directly to the Announcer with inflated metadata
    //    that claims the employer paid 1e12.
    const replay = annFromLine(aliceLine, {
      caller: ATTACKER,
      metadata: buildMetadata77({ viewTag: aliceLine.viewTag, token: TOKEN, amount: 10n ** 12n, payer: EMPLOYER }),
    });
    // 2. A fresh stealth address for alice announced by the attacker, claiming to be the employer,
    //    with nothing actually sent.
    const fake = generateStealthAddress({ stealthMetaAddressURI: alice.keys.stealthMetaAddressURI, schemeId: 1 });
    const fakeAnn: AnnouncementRecord = {
      blockNumber: 101n,
      txHash: `0x${"cd".repeat(32)}`,
      logIndex: 0,
      stealthAddress: fake.stealthAddress,
      caller: ATTACKER,
      ephemeralPubKey: fake.ephemeralPublicKey,
      metadata: buildMetadata77({ viewTag: Number(fake.viewTag), token: TOKEN, amount: 5_000_000n, payer: EMPLOYER }),
    };
    // 3. Garbage: wrong view tag, bad key encodings.
    const garbage: AnnouncementRecord[] = [
      { ...fakeAnn, metadata: buildMetadata57({ viewTag: (Number(fake.viewTag) + 1) % 256, token: TOKEN, amount: 1n }) },
      { ...fakeAnn, ephemeralPubKey: `0x04${"11".repeat(32)}` },
      { ...fakeAnn, ephemeralPubKey: `0x02${"ff".repeat(32)}` }, // x >= p: not a point
      { ...fakeAnn, ephemeralPubKey: "0x" },
    ];

    const all = [...anns, replay, fakeAnn, ...garbage];
    const { matches, stats } = scanAnnouncementsWithStats(all, alice.keys);
    expect(stats.malformed).toBe(3);
    // 3 real + the replay + the attacker's fresh address; garbage with a wrong tag is dropped.
    expect(matches).toHaveLength(5);

    const real = new Map<string, bigint>();
    for (const l of lines) real.set(`${l.stealthAddress.toLowerCase()}:${TOKEN.toLowerCase()}`, l.amount);
    const balances = await verifyBalances({ client: fakeMulticall(real), matches, tokens: [TOKEN] });
    const ledger = buildLedger(matches, balances, [EMPLOYER], { stealthDisperse: [DISPERSE] });

    expect(ledger).toHaveLength(4); // one row per stealth address
    const replayed = ledger.find((e) => e.stealthAddress === aliceLine.stealthAddress)!;
    expect(replayed.balance).toBe(aliceLine.amount); // real balance, not 1e12
    expect(replayed.claimedAmount).toBe(aliceLine.amount); // from the StealthDisperse announcement
    expect(replayed.payerKnown).toBe(true);
    expect(replayed.flags).toContain("duplicate-announcement");
    expect(replayed.announcements).toHaveLength(2);

    const spoofed = ledger.find((e) => e.stealthAddress === fake.stealthAddress)!;
    expect(spoofed.payer).toBe(ATTACKER); // metadata payer ignored off StealthDisperse
    expect(spoofed.payerKnown).toBe(false);
    expect(spoofed.balance).toBe(0n);
    expect(spoofed.flags).toEqual(expect.arrayContaining(["unknown-payer", "hint-amount-mismatch"]));
    expect(ledger[ledger.length - 1]).toBe(spoofed); // ranked last, not dropped

    const total = ledger.reduce((s, e) => s + (e.balance ?? 0n), 0n);
    expect(total).toBe(lines.filter((l) => l.recipientId === "alice").reduce((s, l) => s + l.amount, 0n));
  });

  it("without the StealthDisperse list, the metadata payer is never trusted", async () => {
    const { people, anns } = setup();
    const matches = scanAnnouncements(anns, people[0]!.keys);
    const balances = await verifyBalances({ client: fakeMulticall(new Map()), matches, tokens: [TOKEN] });
    const ledger = buildLedger(matches, balances, [EMPLOYER]);
    expect(ledger.every((e) => e.payer === DISPERSE && !e.payerKnown)).toBe(true);
  });
});

describe("fetching", () => {
  it("pages through GET /announcements and skips malformed items", async () => {
    const { anns } = setup();
    const json = anns.map((a) => ({ ...a, blockNumber: a.blockNumber.toString() }));
    const pages: Record<string, unknown> = {
      "": { items: json.slice(0, 4), nextCursor: "c1" },
      c1: { items: [...json.slice(4, 8), { bogus: true }], nextCursor: "c2" },
      c2: { items: json.slice(8), nextCursor: null },
    };
    const urls: string[] = [];
    const fetchImpl: FetchLike = async (url) => {
      urls.push(url);
      const cursor = /[?&]cursor=([^&]*)/.exec(url)?.[1] ?? "";
      return { ok: true, status: 200, json: async () => pages[cursor] };
    };
    const { announcements, skipped } = await fetchAnnouncements({ apiUrl: "https://api.test/", fromBlock: 5n, toBlock: 9n, fetch: fetchImpl });
    expect(announcements).toEqual(anns);
    expect(skipped).toBe(1);
    expect(urls[0]).toBe("https://api.test/announcements?from=5&to=9");
    expect(urls[2]).toBe("https://api.test/announcements?from=5&to=9&cursor=c2");
  });

  it("rejects a cursor loop", async () => {
    const fetchImpl: FetchLike = async () => ({ ok: true, status: 200, json: async () => ({ items: [], nextCursor: "same" }) });
    await expect(fetchAnnouncements({ apiUrl: "https://api.test", fetch: fetchImpl })).rejects.toThrow(/loop/);
  });

  it("RPC fallback: chunked getLogs, bounded concurrency, sorted output", async () => {
    const { anns } = setup();
    const calls: [bigint, bigint][] = [];
    let inFlight = 0;
    let peak = 0;
    const client: LogsClient = {
      getLogs: (async (args: { fromBlock: bigint; toBlock: bigint; args: { schemeId: bigint } }) => {
        expect(args.args.schemeId).toBe(1n);
        calls.push([args.fromBlock, args.toBlock]);
        inFlight++;
        peak = Math.max(peak, inFlight);
        await new Promise((r) => host.setTimeout(r, 5));
        inFlight--;
        // One log per range, in reverse order across ranges, to prove sorting.
        const a = anns[calls.length % anns.length]!;
        return [
          {
            blockNumber: args.fromBlock,
            transactionHash: a.txHash,
            logIndex: 0,
            args: { schemeId: 1n, stealthAddress: a.stealthAddress, caller: a.caller, ephemeralPubKey: a.ephemeralPubKey, metadata: a.metadata },
          },
        ];
      }) as unknown as LogsClient["getLogs"],
    };
    const out = await fetchAnnouncementsRpc({ client, fromBlock: 0n, toBlock: 95_000n, chunkSize: 10_000, concurrency: 3 });
    expect(calls).toHaveLength(10);
    expect(calls.map((c) => c[1] - c[0] + 1n).reduce((s, n) => s + n, 0n)).toBe(95_001n);
    expect(peak).toBeLessThanOrEqual(3);
    expect(out.map((a) => a.blockNumber)).toEqual(Array.from({ length: 10 }, (_, i) => BigInt(i) * 10_000n));
  });
});

describe("performance", () => {
  // Default N keeps CI fast; SOAPAY_SCAN_PERF_N=100000 runs the full-size benchmark.
  const N = Number(host.process.env.SOAPAY_SCAN_PERF_N ?? 5000);
  it(`scans ${N} announcements with the view-tag prefilter`, () => {
    const { people, anns } = setup();
    const alice = people[0]!;

    // Cheap distinct valid points: P, P+G, P+2G, ...
    const G = secp256k1.Point.BASE;
    let P = G.multiply(12345n);
    const noise: AnnouncementRecord[] = [];
    for (let i = 0; i < N; i++) {
      P = P.add(G);
      const tag = (i * 131) & 0xff;
      noise.push({
        blockNumber: BigInt(i),
        txHash: `0x${"ee".repeat(32)}`,
        logIndex: 0,
        stealthAddress: getAddress(`0x${(i + 1).toString(16).padStart(40, "0")}`),
        caller: DISPERSE,
        ephemeralPubKey: bytesToHex(P.toBytes(true)),
        metadata: buildMetadata77({ viewTag: tag, token: TOKEN, amount: 1n, payer: ATTACKER }),
      });
    }
    const all = [...noise, ...anns];

    const t0 = host.performance.now();
    const { matches, stats } = scanAnnouncementsWithStats(all, alice.keys);
    const ms = host.performance.now() - t0;
    const perAnn = ms / all.length;
    host.console.log(
      `[scan perf] ${all.length} announcements in ${(ms / 1000).toFixed(2)}s ` +
        `(${(perAnn * 1000).toFixed(0)} µs each; full checks ${stats.fullChecks}; ` +
        `projected 100k: ${((perAnn * 100_000) / 1000).toFixed(1)}s)`,
    );
    expect(matches).toHaveLength(3);
    // Prefilter lets ~1/256 of the noise through to the full check.
    expect(stats.fullChecks).toBeLessThan(3 + N / 64 + 10);
    expect(perAnn).toBeLessThan(20); // ms, generous for loaded CI machines
  }, Math.max(60_000, N * 30));
});
