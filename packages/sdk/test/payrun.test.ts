import { describe, expect, it } from "vitest";
import { bytesToHex, decodeFunctionData, getAddress, type Address, type Hex } from "viem";
import { buildMetadataForERC20, generateRandomStealthMetaAddress } from "@scopelift/stealth-address-sdk";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import {
  PAYRUN_GAS_PER_LINE,
  assertPayRunInvariants,
  buildMetadata57,
  buildMetadata77,
  chunkLines,
  compareAddresses,
  decodeHead,
  derivePayRun,
  encodeBatchCalls,
  encodeHead,
  encodeStealthDisperseCalls,
  estimatePayRunGas,
  type PayRunLine,
} from "../src/payrun.js";
import { announcerAbi, erc20Abi, stealthDisperseAbi } from "../src/abis.js";
import { ANNOUNCER_ADDRESS, MAX_LINE_AMOUNT } from "../src/constants.js";

const TOKEN = "0x036CbD53842c5426634e7929541eC2318f3dCF7e" as Address;
const DISPERSE = "0x00000000000000000000000000000000DeaDBeef" as Address;
const PAYER = "0x1111111111111111111111111111111111111111" as Address;

function randomAddress(): Address {
  return getAddress(bytesToHex(secp256k1.utils.randomSecretKey()).slice(0, 42));
}

function randBelow(max: bigint): bigint {
  const bytes = secp256k1.utils.randomSecretKey();
  return BigInt(bytesToHex(bytes)) % max;
}

describe("head encoding (spec §1)", () => {
  it("round trips edge amounts", () => {
    for (const amount of [1n, 2n, 1_000_000n, MAX_LINE_AMOUNT]) {
      for (const [viewTag, keyPrefix] of [[0, 2], [255, 3], [0x7f, 2]] as const) {
        for (const stealthAddress of [
          "0x0000000000000000000000000000000000000001",
          "0xFFfFfFffFFfffFFfFFfFFFFFffFFFffffFfFFFfF",
          randomAddress(),
        ] as Address[]) {
          const f = { stealthAddress: getAddress(stealthAddress), amount, viewTag, keyPrefix };
          expect(decodeHead(encodeHead(f))).toEqual(f);
        }
      }
    }
  });

  it("matches the spec bit layout", () => {
    const addr = "0x00000000000000000000000000000000000000Aa" as Address;
    const head = encodeHead({ stealthAddress: addr, amount: 5n, viewTag: 0x9c, keyPrefix: 3 });
    expect(head).toBe((0xaan << 96n) | (5n << 16n) | (0x9cn << 8n) | 3n);
  });

  it("rejects 2^80, zero, bad prefix and bad view tag", () => {
    const base = { stealthAddress: randomAddress(), amount: 1n, viewTag: 1, keyPrefix: 2 };
    expect(() => encodeHead({ ...base, amount: 1n << 80n })).toThrow(/2\^80/);
    expect(() => encodeHead({ ...base, amount: 0n })).toThrow(/> 0/);
    expect(() => encodeHead({ ...base, keyPrefix: 4 })).toThrow(/prefix/);
    expect(() => encodeHead({ ...base, viewTag: 256 })).toThrow(/view tag/);
  });

  it("fuzz: random fields round trip losslessly", () => {
    for (let i = 0; i < 2000; i++) {
      const f = {
        stealthAddress: randomAddress(),
        amount: randBelow(MAX_LINE_AMOUNT) + 1n,
        viewTag: Number(randBelow(256n)),
        keyPrefix: i % 2 === 0 ? 2 : 3,
      };
      const head = encodeHead(f);
      expect(head < 1n << 256n).toBe(true);
      expect(decodeHead(head)).toEqual(f);
    }
  });
});

describe("metadata", () => {
  it("57-byte form equals ScopeLift buildMetadataForERC20", () => {
    for (const amount of [1n, 123_456_789n, MAX_LINE_AMOUNT]) {
      const ours = buildMetadata57({ viewTag: 0x9a, token: TOKEN, amount });
      const theirs = buildMetadataForERC20({ viewTag: "0x9a", tokenAddress: TOKEN, amount });
      expect(ours).toBe(theirs.toLowerCase());
      expect((ours.length - 2) / 2).toBe(57);
    }
  });

  it("77-byte form is the 57-byte form followed by the payer", () => {
    const m57 = buildMetadata57({ viewTag: 7, token: TOKEN, amount: 42n });
    const m77 = buildMetadata77({ viewTag: 7, token: TOKEN, amount: 42n, payer: PAYER });
    expect((m77.length - 2) / 2).toBe(77);
    expect(m77).toBe(`${m57}${PAYER.slice(2).toLowerCase()}`);
    expect(m77.slice(4, 12)).toBe("a9059cbb");
  });
});

describe("derivePayRun", () => {
  it("derives sorted lines with 33-byte keys and unique ephemeral keys", () => {
    const rs = [0, 1, 2].map((i) => ({
      metaAddressURI: generateRandomStealthMetaAddress().stealthMetaAddressURI,
      amount: BigInt(1000 + i),
      id: `emp-${i}`,
    }));
    const lines = derivePayRun({ recipients: rs, denominate: (a) => [a / 2n, a - a / 2n] });
    expect(lines).toHaveLength(6);
    for (let i = 1; i < lines.length; i++) {
      expect(compareAddresses(lines[i - 1]!.stealthAddress, lines[i]!.stealthAddress)).toBe(-1);
    }
    for (const l of lines) {
      expect(l.ephemeralPublicKey).toHaveLength(68);
      expect(l.ephemeralPublicKey.slice(0, 4)).toBe(`0x0${l.keyPrefix}`);
      expect(`0x${l.ephemeralPublicKey.slice(4)}`).toBe(l.keyX);
    }
    expect(new Set(lines.map((l) => l.ephemeralPublicKey)).size).toBe(6);
    expect(lines.filter((l) => l.recipientId === "emp-1").reduce((s, l) => s + l.amount, 0n)).toBe(1001n);
  });

  it("sorts numerically by the 160-bit value, not by checksum string", () => {
    // Mixed-case checksums would sort differently as strings.
    const a = "0xaBcd000000000000000000000000000000000000" as Address;
    const b = "0xABCE000000000000000000000000000000000000" as Address;
    expect(compareAddresses(a, b)).toBe(-1);
    expect(compareAddresses(b, a)).toBe(1);
  });

  it("throws on a reused ephemeral key", () => {
    const fixed = secp256k1.utils.randomSecretKey();
    const rs = [0, 1].map(() => ({
      metaAddressURI: generateRandomStealthMetaAddress().stealthMetaAddressURI,
      amount: 5n,
    }));
    expect(() => derivePayRun({ recipients: rs, randomEphemeralKey: () => fixed })).toThrow(/ephemeral key reused/);
  });

  it("throws on a repeated stealth address and on bad amounts", () => {
    const [line] = derivePayRun({
      recipients: [{ metaAddressURI: generateRandomStealthMetaAddress().stealthMetaAddressURI, amount: 9n }],
    });
    const dup: PayRunLine = { ...line!, ephemeralPublicKey: `0x02${"11".repeat(32)}` as Hex };
    expect(() => assertPayRunInvariants([line!, dup])).toThrow(/repeated/);
    const meta = generateRandomStealthMetaAddress().stealthMetaAddressURI;
    expect(() => derivePayRun({ recipients: [{ metaAddressURI: meta, amount: 0n }] })).toThrow(/> 0/);
    expect(() => derivePayRun({ recipients: [{ metaAddressURI: meta, amount: 1n << 80n }] })).toThrow(/2\^80/);
  });
});

describe("chunkLines", () => {
  it("cuts into ceil(n/max) chunks whose sizes differ by at most one", () => {
    for (const n of [1, 349, 350, 351, 700, 701, 1000, 1049, 1051, 5000]) {
      const items = Array.from({ length: n }, (_, i) => i);
      const chunks = chunkLines(items, 350);
      expect(chunks).toHaveLength(Math.ceil(n / 350));
      const sizes = chunks.map((c) => c.length);
      expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThanOrEqual(1);
      expect(Math.max(...sizes)).toBeLessThanOrEqual(350);
      expect(chunks.flat()).toEqual(items); // consecutive, order preserved
    }
  });

  it("never partitions by recipient: two recipients' lines interleave across chunks", () => {
    const rs = ["alice", "bob"].map((id) => ({
      metaAddressURI: generateRandomStealthMetaAddress().stealthMetaAddressURI,
      amount: 40n,
      id,
    }));
    const lines = derivePayRun({ recipients: rs, denominate: (a) => Array.from({ length: 40 }, () => a / 40n) });
    const chunks = chunkLines(lines, 30); // 80 lines -> 3 chunks of 27/27/26
    expect(chunks.map((c) => c.length)).toEqual([27, 27, 26]);
    for (const c of chunks) {
      // Random addresses: each chunk holds lines of both recipients, ascending by address.
      expect(new Set(c.map((l) => l.recipientId)).size).toBe(2);
      for (let i = 1; i < c.length; i++) {
        expect(compareAddresses(c[i - 1]!.stealthAddress, c[i]!.stealthAddress)).toBe(-1);
      }
    }
    // Per-chunk totals are not per-recipient totals.
    const aliceIdx = lines.map((l, i) => (l.recipientId === "alice" ? i : -1)).filter((i) => i >= 0);
    expect(aliceIdx[aliceIdx.length - 1]! - aliceIdx[0]!).toBeGreaterThan(40);
  });
});

function makeRun(n: number): PayRunLine[] {
  const metas = Array.from({ length: 5 }, () => generateRandomStealthMetaAddress().stealthMetaAddressURI);
  return derivePayRun({
    recipients: metas.map((m, i) => ({ metaAddressURI: m, amount: BigInt(n) * 1000n + BigInt(i) })),
    denominate: (a) => {
      const k = BigInt(n / 5);
      const unit = a / k;
      return [...Array.from({ length: Number(k) - 1 }, () => unit), a - unit * (k - 1n)];
    },
  });
}

describe("encodeStealthDisperseCalls", () => {
  it("encodes one exact approve plus one pay per equal chunk that decodes against the ABI", () => {
    const lines = makeRun(20);
    const total = lines.reduce((s, l) => s + l.amount, 0n);
    const out = encodeStealthDisperseCalls({ stealthDisperse: DISPERSE, token: TOKEN, lines, maxLinesPerTx: 7 });
    expect(out.total).toBe(total);
    expect(out.chunkSizes).toEqual([7, 7, 6]);

    const approve = decodeFunctionData({ abi: erc20Abi, data: out.approve.data });
    expect(out.approve.to).toBe(TOKEN);
    expect(approve.functionName).toBe("approve");
    expect(approve.args).toEqual([DISPERSE, total]);

    const decoded: PayRunLine[] = [];
    let cursor = 0;
    for (const call of out.pays) {
      expect(call.to).toBe(DISPERSE);
      const d = decodeFunctionData({ abi: stealthDisperseAbi, data: call.data });
      expect(d.functionName).toBe("pay");
      const [token, packed] = d.args as readonly [Address, readonly { head: bigint; keyX: Hex }[]];
      expect(token).toBe(TOKEN);
      for (const p of packed) {
        const src = lines[cursor++]!;
        const h = decodeHead(p.head);
        expect(h).toEqual({
          stealthAddress: src.stealthAddress,
          amount: src.amount,
          viewTag: src.viewTag,
          keyPrefix: src.keyPrefix,
        });
        expect(p.keyX).toBe(src.keyX);
        decoded.push(src);
      }
    }
    expect(decoded).toEqual(lines);
    // 64 bytes of calldata per line: selector + token + offset + length + 2 words per line.
    const first = out.pays[0]!;
    expect((first.data.length - 2) / 2).toBe(4 + 32 * 3 + 64 * 7);
  });

  it("refuses unsorted runs and chunk caps above 350", () => {
    const lines = makeRun(10);
    const reversed = [...lines].reverse();
    expect(() => encodeStealthDisperseCalls({ stealthDisperse: DISPERSE, token: TOKEN, lines: reversed })).toThrow(/ascending/);
    expect(() =>
      encodeStealthDisperseCalls({ stealthDisperse: DISPERSE, token: TOKEN, lines, maxLinesPerTx: 351 }),
    ).toThrow(/350/);
  });

  it.todo("matches contracts fixed vector"); // Wire to the fixed vector the contracts agent publishes in contracts/PLAN.md.
});

describe("encodeBatchCalls (EIP-5792)", () => {
  it("emits [transfer, announce] pairs in ascending order with 57-byte metadata, per chunk", () => {
    const lines = makeRun(10);
    const batches = encodeBatchCalls({ token: TOKEN, lines, maxLinesPerTx: 4 });
    expect(batches.map((b) => b.calls.length)).toEqual([8, 6, 6]);
    let i = 0;
    for (const { calls } of batches) {
      expect(Object.keys(calls[0]!).sort()).toEqual(["data", "to"]);
      for (let j = 0; j < calls.length; j += 2) {
        const line = lines[i++]!;
        const t = calls[j]!;
        const a = calls[j + 1]!;
        expect(t.to).toBe(TOKEN);
        const td = decodeFunctionData({ abi: erc20Abi, data: t.data });
        expect(td.functionName).toBe("transfer");
        expect(td.args).toEqual([line.stealthAddress, line.amount]);
        expect(a.to).toBe(ANNOUNCER_ADDRESS);
        const ad = decodeFunctionData({ abi: announcerAbi, data: a.data });
        expect(ad.functionName).toBe("announce");
        const [scheme, stealth, eph, metadata] = ad.args as readonly [bigint, Address, Hex, Hex];
        expect(scheme).toBe(1n);
        expect(stealth).toBe(line.stealthAddress);
        expect(eph).toBe(line.ephemeralPublicKey);
        expect(metadata).toBe(buildMetadata57({ viewTag: line.viewTag, token: TOKEN, amount: line.amount }));
      }
    }
    expect(i).toBe(lines.length);
  });
});

describe("estimatePayRunGas", () => {
  it("plans ~42k per line with per-tx totals", () => {
    const lines = makeRun(10);
    const est = estimatePayRunGas(lines, 4);
    expect(est.lineCount).toBe(10);
    expect(est.recipientCount).toBe(5);
    expect(est.txCount).toBe(3);
    expect(est.totalGas).toBe(10n * PAYRUN_GAS_PER_LINE);
    expect(est.perTx.map((t) => t.gas)).toEqual([4n, 3n, 3n].map((n) => n * PAYRUN_GAS_PER_LINE));
    expect(est.perTx.reduce((s, t) => s + t.amount, 0n)).toBe(est.totalAmount);
    // 350 lines stay under the 2^24 per-tx gas cap.
    expect(350n * PAYRUN_GAS_PER_LINE < 1n << 24n).toBe(true);
  });
});
