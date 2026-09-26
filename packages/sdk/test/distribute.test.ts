import { describe, expect, it } from "vitest";
import { generateRandomStealthMetaAddress } from "@scopelift/stealth-address-sdk";
import { decodeFunctionData, type Address } from "viem";
import {
  checkDistributionCompliance,
  denominated,
  dividend,
  encodeDistribution,
  executeDistribution,
  grant,
  payroll,
  planDistribution,
  proRata,
  vestedAmount,
  vesting,
  vestingSchedule,
  type Holder,
  type VestingSchedule,
} from "../src/distribute.js";
import { ComplianceError, erc20Asset, nativeAsset, UnsupportedAssetError } from "../src/registry.js";
import { erc20Abi } from "../src/abis.js";

const USDC = erc20Asset("0x036CbD53842c5426634e7929541eC2318f3dCF7e", { symbol: "USDC", decimals: 6 });
const DISPERSE = "0x00000000000000000000000000000000DeaDBeef" as Address;
const meta = () => generateRandomStealthMetaAddress().stealthMetaAddressURI;

describe("proRata", () => {
  it("sums to exactly the total and follows the largest remainder", () => {
    expect(proRata([1n, 1n, 1n], 100n)).toEqual([34n, 33n, 33n]);
    expect(proRata([2n, 1n], 10n)).toEqual([7n, 3n]);
    expect(proRata([0n, 5n], 7n)).toEqual([0n, 7n]);
    expect(proRata([1n, 2n, 3n], 0n)).toEqual([0n, 0n, 0n]);
  });

  it("is exact over many inputs, each share within one unit of its floor", () => {
    for (let t = 0; t < 200; t++) {
      const n = 1 + (t % 17);
      const holdings: bigint[] = Array.from({ length: n }, (_, i) => BigInt((t * 7919 + i * 104729) % 100_003));
      if (!holdings.some((h) => h > 0n)) holdings[0] = 1n;
      const total = BigInt(t * 1_000_003 + 1);
      const shares = proRata(holdings, total);
      expect(shares.reduce((s, x) => s + x, 0n)).toBe(total);
      const H = holdings.reduce((s, x) => s + x, 0n);
      shares.forEach((s, i) => {
        const floor = (total * holdings[i]!) / H;
        expect(s === floor || s === floor + 1n).toBe(true);
      });
    }
  });

  it("rejects bad input", () => {
    expect(() => proRata([0n, 0n], 10n)).toThrow(/total holdings/);
    expect(() => proRata([-1n, 2n], 10n)).toThrow(/>= 0/);
    expect(() => proRata([1n], -1n)).toThrow(/total/);
  });
});

describe("presets", () => {
  it("dividend drops zero shares and still sums to the total", () => {
    const holders: Holder[] = [
      { metaAddressURI: meta(), holdings: 1_000_000n, id: "whale" },
      { metaAddressURI: meta(), holdings: 1n, id: "dust" },
      { metaAddressURI: meta(), holdings: 999_999n, id: "b" },
    ];
    const d = dividend(holders, 1000n);
    expect(d.kind).toBe("dividend");
    expect(d.allocations.reduce((s, x) => s + x, 0n)).toBe(1000n);
    expect(d.recipients.map((r) => r.id)).toEqual(["whale", "b"]);
    expect(d.recipients.reduce((s, r) => s + r.amount, 0n)).toBe(1000n);
    expect(d.warnings[0]).toMatch(/dust/);
  });

  it("payroll and grant validate amounts; grant checks the budget", () => {
    expect(() => payroll([{ metaAddressURI: meta(), amount: 0n }])).toThrow(/> 0/);
    const awards = [
      { metaAddressURI: meta(), amount: 60n },
      { metaAddressURI: meta(), amount: 30n },
    ];
    expect(grant(awards, { budget: 100n }).warnings).toEqual(["10 of the budget is unallocated"]);
    expect(() => grant(awards, { budget: 50n })).toThrow(/exceed/);
  });

  it("vesting schedule releases exactly the total, with a cliff", () => {
    const s: VestingSchedule = { total: 1_000_000n, start: 0, cliff: 90, duration: 360, period: 30 };
    const releases = vestingSchedule(s);
    expect(releases.reduce((a, r) => a + r.amount, 0n)).toBe(1_000_000n);
    expect(releases[0]).toEqual({ index: 0, at: 90, amount: 250_000n });
    expect(releases.at(-1)!.at).toBe(360);
    expect(vestedAmount(s, 89)).toBe(0n);
    expect(vestedAmount(s, 119)).toBe(250_000n);
    expect(vestedAmount(s, 10_000)).toBe(1_000_000n);
  });

  it("vesting schedule handles a duration that is not a multiple of the period", () => {
    const s: VestingSchedule = { total: 7n, start: 100, duration: 100, period: 30 };
    const releases = vestingSchedule(s);
    expect(releases.map((r) => r.at)).toEqual([130, 160, 190, 200]);
    expect(releases.reduce((a, r) => a + r.amount, 0n)).toBe(7n);
  });

  it("vesting tranche pays what is newly vested", () => {
    const schedule: VestingSchedule = { total: 1200n, start: 0, duration: 12, period: 1 };
    const t = vesting(
      [
        { metaAddressURI: meta(), schedule, released: 300n, id: "a" },
        { metaAddressURI: meta(), schedule, released: 600n, id: "b" },
      ],
      6,
    );
    expect(t.recipients).toHaveLength(1);
    expect(t.recipients[0]).toMatchObject({ id: "a", amount: 300n });
    expect(() => vesting([{ metaAddressURI: meta(), schedule, released: 700n }], 6)).toThrow(/released more/);
  });
});

describe("planDistribution", () => {
  it("wraps derivePayRun: sorted lines, chunks, estimate, exact approval", () => {
    const recipients = Array.from({ length: 12 }, (_, i) => ({ metaAddressURI: meta(), amount: BigInt(1000 + i), id: `r${i}` }));
    const plan = planDistribution({ ...payroll(recipients), asset: USDC, maxLinesPerTx: 5 });
    expect(plan.kind).toBe("payroll");
    expect(plan.lines).toHaveLength(12);
    expect(plan.chunks.map((c) => c.length)).toEqual([4, 4, 4]);
    expect(plan.total).toBe(recipients.reduce((s, r) => s + r.amount, 0n));
    expect(plan.estimate.txCount).toBe(3);
    expect(plan.warnings).toEqual([]);
    for (let i = 1; i < plan.lines.length; i++) {
      expect(BigInt(plan.lines[i]!.stealthAddress) > BigInt(plan.lines[i - 1]!.stealthAddress)).toBe(true);
    }
    const enc = encodeDistribution(plan, { via: "disperse", stealthDisperse: DISPERSE });
    if (enc.via !== "disperse") throw new Error("unreachable");
    const approve = decodeFunctionData({ abi: erc20Abi, data: enc.approve.data });
    expect(approve.args).toEqual([DISPERSE, plan.total]);
    expect(enc.pays).toHaveLength(3);
    const batch = encodeDistribution(plan, { via: "batch" });
    if (batch.via !== "batch") throw new Error("unreachable");
    expect(batch.batches.map((b) => b.calls.length)).toEqual([8, 8, 8]);
  });

  it("splits with denominations and warns on small sets", () => {
    const plan = planDistribution({ recipients: [{ metaAddressURI: meta(), amount: 250n }], asset: USDC, split: denominated(100n) });
    expect(plan.lines.map((l) => l.amount).sort()).toEqual([100n, 100n, 50n].sort());
    expect(plan.warnings.join()).toMatch(/identify/);
  });

  it("refuses unsupported assets with a clear error", () => {
    expect(() => planDistribution({ recipients: [{ metaAddressURI: meta(), amount: 1n }], asset: nativeAsset() })).toThrow(UnsupportedAssetError);
    expect(() =>
      planDistribution({ recipients: [{ metaAddressURI: meta(), amount: 1n }], asset: { kind: "erc1155", address: DISPERSE, tokenId: 1n } }),
    ).toThrow(/ERC-1155/);
  });

  it("runs a compliance hook over every stealth address", async () => {
    const plan = planDistribution({
      recipients: [
        { metaAddressURI: meta(), amount: 1n },
        { metaAddressURI: meta(), amount: 2n },
      ],
      asset: USDC,
    });
    const refused = plan.lines[0]!.stealthAddress;
    await expect(
      checkDistributionCompliance(plan, { canReceive: (a) => (a === refused ? { allowed: false, reason: "not on allowlist" } : { allowed: true }) }),
    ).rejects.toThrow(ComplianceError);
    await expect(checkDistributionCompliance(plan, { canReceive: async () => ({ allowed: true }) })).resolves.toBeUndefined();
  });

  it("executeDistribution sends approve then each pay, waiting for receipts", async () => {
    const recipients = Array.from({ length: 4 }, () => ({ metaAddressURI: meta(), amount: 5n }));
    const plan = planDistribution({ recipients, asset: USDC, maxLinesPerTx: 2 });
    const enc = encodeDistribution(plan, { via: "disperse", stealthDisperse: DISPERSE });
    if (enc.via !== "disperse") throw new Error("unreachable");
    const sent: string[] = [];
    let n = 0;
    const res = await executeDistribution({
      encoded: enc,
      wallet: {
        sendTransaction: async (tx) => {
          sent.push(tx.to);
          return `0x${(++n).toString(16).padStart(64, "0")}`;
        },
      },
      publicClient: { waitForTransactionReceipt: async () => ({ status: "success" }) },
    });
    expect(sent).toEqual([USDC.address, DISPERSE, DISPERSE]);
    expect(res.payHashes).toHaveLength(2);
    await expect(
      executeDistribution({
        encoded: enc,
        wallet: { sendTransaction: async () => `0x${"00".repeat(32)}` },
        publicClient: { waitForTransactionReceipt: async () => ({ status: "reverted" }) },
      }),
    ).rejects.toThrow(/approve tx .* reverted/);
  });
});
