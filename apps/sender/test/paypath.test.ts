import { describe, expect, it } from "vitest";
import { atomicSupport, classifyAccountCode, selectPayPath, type PayPathInput } from "../src/lib/paypath.js";

const DISPERSE = "0x1111111111111111111111111111111111111111" as const;
const base: PayPathInput = {
  chainId: 84532,
  capabilities: undefined,
  accountKind: "eoa",
  stealthDisperse: DISPERSE,
  disperseDeployed: true,
};

describe("atomicSupport", () => {
  it.each([
    [{ atomic: { status: "supported" } }, "supported"],
    [{ atomic: { status: "ready" } }, "ready"],
    [{ atomic: { status: "unsupported" } }, "unsupported"],
    [{ 84532: { atomic: { status: "supported" } } }, "supported"],
    [{ "0x14a34": { atomic: { status: "ready" } } }, "ready"],
    [{ 8453: { atomic: { status: "supported" } } }, "unsupported"], // other chain only
    [{ "0x14a34": { atomicBatch: { supported: true } } }, "supported"], // legacy shape
    [{ paymasterService: { supported: true } }, "unsupported"],
    [undefined, "unknown"],
  ])("%j → %s", (caps, expected) => expect(atomicSupport(caps, 84532)).toBe(expected));
});

describe("selectPayPath", () => {
  it("smart account with atomic support → EIP-5792 batch", () => {
    const p = selectPayPath({ ...base, accountKind: "contract", capabilities: { 84532: { atomic: { status: "supported" } } } });
    expect(p.kind).toBe("batch");
  });

  it("EOA whose wallet can upgrade via 7702 ('ready') → batch, even with StealthDisperse available", () => {
    const p = selectPayPath({ ...base, capabilities: { atomic: { status: "ready" } } });
    expect(p.kind).toBe("batch");
    expect(p.reason).toMatch(/7702/);
  });

  it("plain EOA without batching → StealthDisperse", () => {
    expect(selectPayPath({ ...base, capabilities: { atomic: { status: "unsupported" } } }).kind).toBe("disperse");
    expect(selectPayPath(base).kind).toBe("disperse"); // no wallet_getCapabilities at all
  });

  it("plain EOA without StealthDisperse deployed → no path, explained", () => {
    const p = selectPayPath({ ...base, stealthDisperse: null, disperseDeployed: false });
    expect(p.kind).toBe("none");
    expect(p.reason).toMatch(/isn't deployed/);
    const q = selectPayPath({ ...base, disperseDeployed: false });
    expect(q.reason).toMatch(/no code/);
  });

  it("Safe → export, regardless of capabilities", () => {
    const p = selectPayPath({ ...base, accountKind: "safe", capabilities: { atomic: { status: "supported" } } });
    expect(p.kind).toBe("safe");
    expect(p.reason).toMatch(/MultiSendCallOnly/);
  });
});

describe("classifyAccountCode", () => {
  it("distinguishes EOAs, 7702-delegated EOAs, Safes and other contracts", () => {
    expect(classifyAccountCode(undefined, false)).toBe("eoa");
    expect(classifyAccountCode("0x", false)).toBe("eoa");
    expect(classifyAccountCode("0xef0100e6cae83bde06e4c305530e199d7217f42808555b", false)).toBe("delegated-eoa");
    expect(classifyAccountCode("0x6080604052", true)).toBe("safe");
    expect(classifyAccountCode("0x6080604052", false)).toBe("contract");
  });
});
