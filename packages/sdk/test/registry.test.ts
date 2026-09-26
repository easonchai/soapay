import { afterEach, describe, expect, it } from "vitest";
import { defineChain } from "viem";
import { base, baseSepolia } from "viem/chains";
import {
  assertCompliant,
  assetCapabilities,
  ComplianceError,
  erc20Asset,
  getChain,
  listChains,
  noopComplianceHook,
  registerChain,
  resetChainRegistry,
  resolveAsset,
  STEALTH_DISPERSE_BASE_SEPOLIA,
  UnknownChainError,
} from "../src/registry.js";
import { ANNOUNCER_ADDRESS, CHAINS, REGISTRY_ADDRESS } from "../src/constants.js";

const other = defineChain({
  id: 424242,
  name: "Other",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["http://localhost:8545"] } },
});

afterEach(() => resetChainRegistry());

describe("chain registry", () => {
  it("pre-registers Base and Base Sepolia from CHAINS with canonical singletons", () => {
    expect(listChains().map((c) => c.id).sort()).toEqual([base.id, baseSepolia.id].sort());
    const s = getChain(baseSepolia.id);
    expect(s.announcer).toBe(ANNOUNCER_ADDRESS);
    expect(s.registry).toBe(REGISTRY_ADDRESS);
    expect(s.announcerStartBlock).toBe(CHAINS[baseSepolia.id].announcerStartBlock);
    expect(s.stealthDisperse).toBe(STEALTH_DISPERSE_BASE_SEPOLIA);
    expect(resolveAsset(base.id, "usdc")).toMatchObject({ kind: "erc20", address: CHAINS[base.id].usdc, decimals: 6 });
  });

  it("registers any EVM chain with canonical defaults", () => {
    expect(() => getChain(other.id)).toThrow(UnknownChainError);
    const c = registerChain({ chain: other, assets: { tok: erc20Asset("0x00000000000000000000000000000000000000aa") } });
    expect(getChain(other.id)).toBe(c);
    expect(c.announcer).toBe(ANNOUNCER_ADDRESS);
    expect(c.announcerStartBlock).toBe(0n);
    expect(c.stealthDisperse).toBeUndefined();
    expect(resolveAsset(other.id, "TOK").kind).toBe("erc20");
    expect(() => resolveAsset(other.id, "nope")).toThrow(/no asset/);
    expect(resolveAsset(other.id, "0x00000000000000000000000000000000000000bb")).toMatchObject({ kind: "erc20" });
  });
});

describe("assets and compliance", () => {
  it("reports ERC-20 as the only supported kind", () => {
    expect(assetCapabilities("erc20")).toMatchObject({ distribute: true, scan: true, spend: true });
    for (const k of ["native", "erc721", "erc1155"] as const) {
      const c = assetCapabilities(k);
      expect(c.distribute).toBe(false);
      expect(c.reason).toBeTruthy();
    }
  });

  it("noop hook allows; refusals are all listed", async () => {
    const asset = erc20Asset("0x00000000000000000000000000000000000000aa");
    const a = "0x00000000000000000000000000000000000000A1" as const;
    const b = "0x00000000000000000000000000000000000000b2" as const;
    await expect(assertCompliant(noopComplianceHook, [a, b], asset)).resolves.toBeUndefined();
    const err = await assertCompliant({ canReceive: () => ({ allowed: false, reason: "kyc" }) }, [a, b], asset).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ComplianceError);
    expect((err as ComplianceError).refused).toHaveLength(2);
  });
});
