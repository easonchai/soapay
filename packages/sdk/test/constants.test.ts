import { describe, expect, it } from "vitest";
import { toFunctionSelector, toEventSelector } from "viem";
import {
  ERC5564AnnouncerAbi,
  ERC5564_CONTRACT_ADDRESS,
  ERC5564_StartBlocks,
  ERC6538RegistryAbi,
  ERC6538_CONTRACT_ADDRESS,
  VALID_SCHEME_ID,
} from "@scopelift/stealth-address-sdk";
import { ANNOUNCER_ADDRESS, CHAINS, REGISTRY_ADDRESS, SCHEME_ID, announcerAbi, registryAbi } from "../src/index.js";

// constants.ts / abis.ts are hand-written so plain Node can load them;
// these tests pin them to the ScopeLift source of truth.
const signatures = (abi: readonly { type: string }[]) =>
  abi
    .filter((x) => x.type === "function" || x.type === "event")
    .map((x) => (x.type === "function" ? toFunctionSelector(x as never) : toEventSelector(x as never)));

describe("constants mirror ScopeLift", () => {
  it("addresses, scheme id and start blocks", () => {
    expect(ANNOUNCER_ADDRESS).toBe(ERC5564_CONTRACT_ADDRESS);
    expect(REGISTRY_ADDRESS).toBe(ERC6538_CONTRACT_ADDRESS);
    expect(SCHEME_ID).toBe(VALID_SCHEME_ID.SCHEME_ID_1);
    expect(CHAINS[8453].announcerStartBlock).toBe(BigInt(ERC5564_StartBlocks.BASE));
    expect(CHAINS[84532].announcerStartBlock).toBe(BigInt(ERC5564_StartBlocks.BASE_SEPOLIA));
  });

  it("hand-written ABIs are subsets of ScopeLift's", () => {
    const upstreamAnn = new Set(signatures(ERC5564AnnouncerAbi as never));
    for (const s of signatures(announcerAbi)) expect(upstreamAnn.has(s)).toBe(true);
    // ScopeLift's ABI omits NonceIncremented; its topic is present in the deployed
    // registry bytecode on Base (checked 2026-09-25), so it is allowed here.
    const upstreamReg = new Set([
      ...signatures(ERC6538RegistryAbi as never),
      toEventSelector("NonceIncremented(address,uint256)"),
    ]);
    for (const s of signatures(registryAbi)) expect(upstreamReg.has(s)).toBe(true);
  });
});
