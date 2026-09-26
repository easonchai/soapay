import { describe, expect, it } from "vitest";
import type { Address, Log } from "viem";
import {
  ERC6538_REGISTRY,
  explorerAddress,
  explorerTx,
  findRegistrationBlock,
  fmtAmount,
  fmtDate,
  fmtUnits,
  short,
  spendStatus,
  sumLiveBalances,
  type RegistrationLogsClient,
} from "../src/index.js";

describe("formatters (ported from CK's M1)", () => {
  it("short keeps both ends", () => {
    expect(short("0x1234567890abcdef1234567890abcdef12345678")).toBe("0x123456…345678");
    expect(short("0x1234567890abcdef1234567890abcdef12345678", 4)).toBe("0x1234…5678");
    expect(short("0x12")).toBe("0x12");
  });

  it("fmtUnits is exact, fmtAmount groups with two decimals", () => {
    expect(fmtUnits(4_200_123_456n, 6)).toBe("4200.123456");
    expect(fmtUnits("1000000", 6)).toBe("1");
    expect(fmtAmount(4_200_000_000n, 6)).toBe("4,200.00");
    expect(fmtAmount("1500000", 6)).toBe("1.50");
  });

  it("fmtDate is UTC day month year", () => {
    expect(fmtDate(Date.UTC(2026, 8, 24, 23, 59))).toBe("24 Sep 2026");
  });

  it("explorer links by chain id", () => {
    expect(explorerTx(84532, "0xabc")).toBe("https://sepolia.basescan.org/tx/0xabc");
    expect(explorerAddress(8453, "0xdef")).toBe("https://basescan.org/address/0xdef");
    expect(explorerTx(1234567, "0xabc")).toBeUndefined();
  });

  it("spendStatus reads the live balance against the amount paid", () => {
    expect(spendStatus(100n, undefined)).toBe("unknown");
    expect(spendStatus(100n, null)).toBe("unknown");
    expect(spendStatus(100n, 0n)).toBe("withdrawn");
    expect(spendStatus(100n, 40n)).toBe("partly spent");
    expect(spendStatus(100n, 100n)).toBe("unspent");
    expect(spendStatus(100n, 150n)).toBe("unspent");
  });

  it("sumLiveBalances ignores unread balances", () => {
    expect(sumLiveBalances([1n, null, undefined, 2n])).toBe(3n);
    expect(sumLiveBalances([])).toBe(0n);
  });
});

describe("findRegistrationBlock", () => {
  const registrant = "0x00000000000000000000000000000000000000aa" as Address;
  const client = (blocks: (bigint | null)[], seen: unknown[] = []): RegistrationLogsClient =>
    ({
      getBlockNumber: async () => 1000n,
      getLogs: async (args: unknown) => {
        seen.push(args);
        return blocks.map((blockNumber) => ({ blockNumber }) as unknown as Log);
      },
    }) as unknown as RegistrationLogsClient;

  it("returns the earliest StealthMetaAddressSet block for the registrant", async () => {
    const seen: unknown[] = [];
    await expect(findRegistrationBlock(client([900n, 450n, null, 700n], seen), registrant, 100n)).resolves.toBe(450n);
    expect(seen[0]).toMatchObject({ address: ERC6538_REGISTRY, args: { registrant, schemeId: 1n }, fromBlock: 100n, toBlock: 1000n });
  });

  it("returns null when never registered", async () => {
    await expect(findRegistrationBlock(client([]), registrant, 0n)).resolves.toBeNull();
  });
});
