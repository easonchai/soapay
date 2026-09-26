import { describe, expect, it } from "vitest";
import { decodeFunctionData, getAddress, size, slice, hexToBigInt, hexToNumber } from "viem";
import {
  ANNOUNCER_ADDRESS,
  compareAddresses,
  erc20Abi,
  generateMnemonic,
  keysFromMnemonic,
  multiSendAbi,
  SAFE_MULTISEND_CALL_ONLY_V141,
} from "@soapay/sdk";
import { planRun } from "../src/lib/run.js";
import { buildSafeExport } from "../src/lib/safeExport.js";

// The Base Sepolia pay token (Soapay mock USDC, D-52).
const USDC = "0x028D969c20b740582428f5043954c380686214Bb" as const;
const SAFE = "0x2222222222222222222222222222222222222222" as const;

/** Unpacks MultiSend's operation|to|value|len|data encoding. */
function unpack(tx: `0x${string}`) {
  const out: { op: number; to: string; value: bigint; data: `0x${string}` }[] = [];
  let at = 0;
  while (at < size(tx)) {
    const op = hexToNumber(slice(tx, at, at + 1));
    const to = getAddress(slice(tx, at + 1, at + 21));
    const value = hexToBigInt(slice(tx, at + 21, at + 53));
    const len = Number(hexToBigInt(slice(tx, at + 53, at + 85)));
    const data = len ? slice(tx, at + 85, at + 85 + len) : "0x";
    out.push({ op, to, value, data });
    at += 85 + len;
  }
  return out;
}

describe("Safe export", () => {
  const recipients = Array.from({ length: 4 }, (_, i) => ({
    employeeId: `e${i}`,
    name: `e${i}.soapay.eth`,
    metaAddressURI: keysFromMnemonic(generateMnemonic()).metaAddressURI,
    amount: BigInt(i + 1) * 1_000_000n,
  }));
  const plan = planRun(recipients, null);
  const [chunk] = buildSafeExport(plan, { token: USDC, chainId: 84532, safeAddress: SAFE, createdAt: 1_700_000_000_000, runLabel: "2026-09-25" });

  it("delegatecalls the pinned MultiSendCallOnly, with only plain inner calls", () => {
    expect(chunk!.multiSend.to).toBe(SAFE_MULTISEND_CALL_ONLY_V141);
    expect(chunk!.multiSend.operation).toBe(1);
    expect(chunk!.multiSend.value).toBe(0n);
    const { functionName, args } = decodeFunctionData({ abi: multiSendAbi, data: chunk!.multiSend.data });
    expect(functionName).toBe("multiSend");
    const inner = unpack(args[0]);
    expect(inner).toHaveLength(8);
    expect(inner.every((c) => c.op === 0 && c.value === 0n)).toBe(true);
    // [transfer, announce] pairs in ascending stealth-address order.
    const transfers = inner.filter((_, i) => i % 2 === 0);
    expect(transfers.every((c) => c.to === getAddress(USDC))).toBe(true);
    expect(inner.filter((_, i) => i % 2 === 1).every((c) => c.to === getAddress(ANNOUNCER_ADDRESS))).toBe(true);
    const tos = transfers.map((c) => decodeFunctionData({ abi: erc20Abi, data: c.data }).args![0] as `0x${string}`);
    for (let i = 1; i < tos.length; i++) expect(compareAddresses(tos[i - 1]!, tos[i]!)).toBe(-1);
    const total = transfers.reduce((s, c) => s + (decodeFunctionData({ abi: erc20Abi, data: c.data }).args![1] as bigint), 0n);
    expect(total).toBe(10_000_000n);
  });

  it("writes a Transaction Builder batch for this Safe and chain", () => {
    const b = chunk!.builder;
    expect(b.chainId).toBe("84532");
    expect(b.meta.createdFromSafeAddress).toBe(getAddress(SAFE));
    expect(b.transactions).toHaveLength(8);
    expect(b.meta.checksum).toMatch(/^0x[0-9a-f]{64}$/);
    expect(chunk!.fileName).toBe("soapay-2026-09-25.json");
    // Plain JSON: serializable as-is (no bigint).
    expect(() => JSON.stringify(b)).not.toThrow();
  });
});
