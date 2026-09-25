import { describe, expect, it } from "vitest";
import { decodeFunctionData, encodeFunctionData, keccak256, parseAbi, stringToHex, toFunctionSelector, type Address, type Hex } from "viem";
import {
  SAFE_MULTISEND_CALL_ONLY_V141,
  encodeMultiSendTransactions,
  encodeSafeMultiSendCallOnly,
  multiSendAbi,
  type SafeCall,
  serializeForChecksum,
  toSafeTxBuilderJson,
} from "../src/safe.js";

const USDC: Address = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
const ALICE: Address = "0x1111111111111111111111111111111111111111";
const erc20 = parseAbi(["function transfer(address to, uint256 amount) returns (bool)"]);
const transferData = encodeFunctionData({ abi: erc20, functionName: "transfer", args: [ALICE, 500_000_000n] });

const word = (hex: string) => hex.padStart(64, "0");

describe("encodeSafeMultiSendCallOnly", () => {
  it("uses the multiSend(bytes) selector from the Safe contracts", () => {
    expect(toFunctionSelector("function multiSend(bytes transactions)")).toBe("0x8d80ff0a");
  });

  it("matches a hand-assembled vector for one USDC transfer", () => {
    // Packed tx per Safe MultiSend.sol: uint8 op | address to | uint256 value | uint256 len | bytes data
    const packed =
      "00" +
      USDC.slice(2).toLowerCase() +
      word("0") +
      word((68).toString(16)) +
      "a9059cbb" +
      word(ALICE.slice(2)) +
      word((500_000_000).toString(16));
    expect(packed.length / 2).toBe(153);
    const expected =
      "0x8d80ff0a" + word("20") + word((153).toString(16)) + packed + "00".repeat(160 - 153);

    const tx = encodeSafeMultiSendCallOnly([{ to: USDC, data: transferData }]);
    expect(tx.data.toLowerCase()).toBe(expected);
    expect(tx.to).toBe(SAFE_MULTISEND_CALL_ONLY_V141);
    expect(tx.value).toBe(0n);
    // The Safe must delegatecall MultiSendCallOnly so inner calls come from the Safe.
    expect(tx.operation).toBe(1);
  });

  it("packs several calls back to back, including value and empty data", () => {
    const calls: SafeCall[] = [
      { to: USDC, data: transferData },
      { to: ALICE, value: 7n, data: "0x" as Hex },
    ];
    const packed = encodeMultiSendTransactions(calls);
    const second = "00" + ALICE.slice(2) + word("7") + word("0");
    expect(packed.toLowerCase().endsWith(second)).toBe(true);
    expect((packed.length - 2) / 2).toBe(153 + 85);
    const { args } = decodeFunctionData({ abi: multiSendAbi, data: encodeSafeMultiSendCallOnly(calls).data });
    expect(args[0]).toBe(packed);
  });

  it("rejects delegatecall anywhere", () => {
    expect(() => encodeSafeMultiSendCallOnly([{ to: USDC, data: transferData, operation: 1 }])).toThrow(/delegatecall/);
    expect(() =>
      encodeSafeMultiSendCallOnly([
        { to: USDC, data: transferData },
        { to: USDC, data: transferData, operation: 1 },
      ]),
    ).toThrow(/call 1/);
    expect(() =>
      toSafeTxBuilderJson([{ to: USDC, data: transferData, operation: 1 }], {
        chainId: 84532,
        safeAddress: ALICE,
        name: "x",
      }),
    ).toThrow(/delegatecall/);
  });

  it("rejects empty batches, bad addresses and malformed data", () => {
    expect(() => encodeSafeMultiSendCallOnly([])).toThrow();
    expect(() => encodeSafeMultiSendCallOnly([{ to: "0x1234", data: "0x" }])).toThrow(/address/);
    expect(() => encodeSafeMultiSendCallOnly([{ to: USDC, data: "0xabc" as Hex }])).toThrow(/data/);
  });
});

describe("toSafeTxBuilderJson", () => {
  it("produces a Transaction Builder batch with raw calls", () => {
    const batch = toSafeTxBuilderJson([{ to: USDC, data: transferData }, { to: ALICE, value: 1n, data: "0x" }], {
      chainId: 8453,
      safeAddress: ALICE,
      name: "Payroll 2026-09",
      createdAt: 1_758_800_000_000,
    });
    expect(batch.version).toBe("1.0");
    expect(batch.chainId).toBe("8453");
    expect(batch.meta.createdFromSafeAddress).toBe(ALICE);
    expect(batch.transactions).toEqual([
      { to: USDC, value: "0", data: transferData, contractMethod: null, contractInputsValues: null },
      { to: ALICE, value: "1", data: "0x", contractMethod: null, contractInputsValues: null },
    ]);
    // Round-trips through JSON and the checksum validates as tx-builder's validateChecksum does.
    const parsed = JSON.parse(JSON.stringify(batch));
    const { checksum, ...metaWithoutChecksum } = parsed.meta;
    const recomputed = keccak256(
      stringToHex(serializeForChecksum({ ...parsed, meta: { ...metaWithoutChecksum, name: null } })),
    );
    expect(recomputed).toBe(checksum);
    // The name is excluded from the checksum.
    const renamed = toSafeTxBuilderJson([{ to: USDC, data: transferData }, { to: ALICE, value: 1n, data: "0x" }], {
      chainId: 8453,
      safeAddress: ALICE,
      name: "other",
      createdAt: 1_758_800_000_000,
    });
    expect(renamed.meta.checksum).toBe(batch.meta.checksum);
  });

  it("serializes like tx-builder's serializeJSONObject", () => {
    expect(serializeForChecksum({ b: 1, a: [true, null, "x"] })).toBe('{["a","b"][true,null,"x"],1,}');
  });
});
