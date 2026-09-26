import { describe, expect, it } from "vitest";
import { encodeAbiParameters, encodeEventTopics, getAddress, type Address, type Hex } from "viem";
import { generateRandomStealthMetaAddress } from "@scopelift/stealth-address-sdk";
import { announcerAbi, erc20Abi } from "../src/abis.js";
import { ANNOUNCER_ADDRESS } from "../src/constants.js";
import { markOwnLines, payRunBatchFromReceipt, fetchPayRunBatch, type BatchReceipt, type ReceiptLog } from "../src/batch.js";
import { buildMetadata77, compareAddresses, derivePayRun } from "../src/payrun.js";
import { scanAnnouncements, type AnnouncementRecord } from "../src/scan.js";
import { splitIntoDenominations } from "../src/denominations.js";

const USDC = getAddress("0x036CbD53842c5426634e7929541eC2318f3dCF7e");
const DISPERSE = getAddress("0x6B7a1cC570Af2DDd427DA694351438F0FE8039CA");
const EMPLOYER = getAddress("0x7757a7c9f4ed02a02353a7929cfb399e9286f52c");
const TX: Hex = `0x${"24".repeat(32)}`;
const UNIT = 1_000_000n;

function transferLog(from: Address, to: Address, value: bigint, logIndex: number, token: Address = USDC): ReceiptLog {
  return {
    address: token,
    topics: encodeEventTopics({ abi: erc20Abi, eventName: "Transfer", args: { from, to } }) as Hex[],
    data: encodeAbiParameters([{ type: "uint256" }], [value]),
    logIndex,
  };
}

function announcementLog(stealth: Address, eph: Hex, metadata: Hex, logIndex: number, schemeId = 1n, emitter: Address = ANNOUNCER_ADDRESS): ReceiptLog {
  return {
    address: emitter,
    topics: encodeEventTopics({ abi: announcerAbi, eventName: "Announcement", args: { schemeId, stealthAddress: stealth, caller: DISPERSE } }) as Hex[],
    data: encodeAbiParameters([{ type: "bytes" }, { type: "bytes" }], [eph, metadata]),
    logIndex,
  };
}

/** A StealthDisperse-shaped receipt: per line, transferFrom then announce; lines ascending by address. */
function payRun() {
  const me = generateRandomStealthMetaAddress();
  const coworker = generateRandomStealthMetaAddress();
  const lines = derivePayRun({
    recipients: [
      { metaAddressURI: me.stealthMetaAddressURI, amount: 1_250n * UNIT, id: "me" },
      { metaAddressURI: coworker.stealthMetaAddressURI, amount: 900n * UNIT, id: "coworker" },
    ],
    denominate: (a) => splitIntoDenominations(a, 500n * UNIT).chunks,
  }).sort((a, b) => compareAddresses(a.stealthAddress, b.stealthAddress));
  const logs: ReceiptLog[] = [];
  lines.forEach((l) => {
    logs.push(transferLog(EMPLOYER, l.stealthAddress, l.amount, logs.length));
    logs.push(
      announcementLog(
        l.stealthAddress,
        l.ephemeralPublicKey,
        buildMetadata77({ viewTag: l.viewTag, token: USDC, amount: l.amount, payer: EMPLOYER }),
        logs.length,
      ),
    );
  });
  const receipt: BatchReceipt = { transactionHash: TX, blockNumber: 47_300_000n, from: EMPLOYER, to: DISPERSE, status: "success", logs };
  return { me, coworker, lines, receipt };
}

describe("payRunBatchFromReceipt", () => {
  it("rebuilds every line with amounts from Transfer logs, in announcement order", () => {
    const { lines, receipt } = payRun();
    const batch = payRunBatchFromReceipt(receipt, { token: USDC });
    // 1,250 → 500 + 500 + 250; 900 → 500 + 400.
    expect(batch.lines).toHaveLength(5);
    expect(batch.lines.map((l) => l.stealthAddress)).toEqual(lines.map((l) => l.stealthAddress));
    expect(batch.lines.map((l) => l.amount)).toEqual(lines.map((l) => l.amount));
    expect(batch.total).toBe(2_150n * UNIT);
    expect(batch.unfunded).toBe(0);
    expect(batch.lines.every((l) => l.payer === EMPLOYER && l.caller === DISPERSE)).toBe(true);
    expect(batch.lines.map((l) => l.index)).toEqual([0, 1, 2, 3, 4]);
    expect(batch).toMatchObject({ txHash: TX, from: EMPLOYER, to: DISPERSE, token: USDC });
  });

  it("marks only the viewer's lines, found by scanning with their viewing key; one person can own several lines", () => {
    const { me, receipt } = payRun();
    const batch = payRunBatchFromReceipt(receipt, { token: USDC });
    const anns: AnnouncementRecord[] = batch.lines.map((l) => ({
      blockNumber: batch.blockNumber,
      txHash: batch.txHash,
      logIndex: l.logIndex,
      stealthAddress: l.stealthAddress,
      caller: l.caller,
      ephemeralPubKey: l.ephemeralPubKey,
      metadata: l.metadata,
    }));
    const mine = scanAnnouncements(anns, me).map((m) => m.announcement.stealthAddress);
    const owned = markOwnLines(batch, mine);
    expect(owned.mineCount).toBe(3);
    expect(owned.mineTotal).toBe(1_250n * UNIT);
    expect(owned.lines.filter((l) => l.mine)).toHaveLength(3);
    expect(owned.lines.filter((l) => !l.mine)).toHaveLength(2);
    // Nobody else's key: nothing lights up.
    expect(markOwnLines(batch, []).mineCount).toBe(0);
  });

  it("ignores other schemes, other emitters and other tokens; never trusts the metadata amount", () => {
    const { receipt } = payRun();
    const fake = getAddress("0x00000000000000000000000000000000000fa4e1");
    const stranger = getAddress("0x000000000000000000000000000000000000beef");
    const eph = `0x02${"11".repeat(32)}` as Hex;
    const lying = buildMetadata77({ viewTag: 1, token: USDC, amount: 10_000n * UNIT, payer: EMPLOYER });
    const extra: ReceiptLog[] = [
      announcementLog(stranger, eph, lying, 100), // announced, but no USDC moved to it
      announcementLog(fake, eph, lying, 101, 2n), // scheme 2
      announcementLog(fake, eph, lying, 102, 1n, stranger), // not the canonical Announcer
      transferLog(EMPLOYER, fake, 1n, 103, stranger), // another token
    ];
    const batch = payRunBatchFromReceipt({ ...receipt, logs: [...receipt.logs, ...extra] }, { token: USDC });
    expect(batch.lines).toHaveLength(6);
    const last = batch.lines[5]!;
    expect(last.stealthAddress).toBe(stranger);
    expect(last.amount).toBeNull();
    expect(batch.unfunded).toBe(1);
    expect(batch.total).toBe(2_150n * UNIT);
  });

  it("sums several transfers to the same address", () => {
    const { receipt, lines } = payRun();
    const first = lines[0]!;
    const batch = payRunBatchFromReceipt({ ...receipt, logs: [...receipt.logs, transferLog(EMPLOYER, first.stealthAddress, 7n, 99)] }, { token: USDC });
    expect(batch.lines[0]!.amount).toBe(first.amount + 7n);
  });

  it("fetchPayRunBatch reads the receipt and uses the chain's USDC", async () => {
    const { receipt } = payRun();
    let asked: Hex | undefined;
    const client = {
      getTransactionReceipt: async ({ hash }: { hash: Hex }) => {
        asked = hash;
        return receipt;
      },
    } as unknown as Parameters<typeof fetchPayRunBatch>[0]["client"];
    const batch = await fetchPayRunBatch({ client, txHash: TX, chainId: 84532 });
    expect(asked).toBe(TX);
    expect(batch.lines).toHaveLength(5);
  });
});
