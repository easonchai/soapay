import { describe, expect, it } from "vitest";
import type { Address, Hex } from "viem";
import { keysFromMnemonic } from "../src/keys.js";
import { REGISTRY_ADDRESS, SCHEME_ID, TEXT_KEY_REGISTRANT, TEXT_KEY_STEALTH } from "../src/constants.js";
import type { RegistryReader } from "../src/registration.js";
import {
  MetaMismatch,
  NameNotFound,
  NotRegistered,
  SoapayNameError,
  pinnedMetaChanged,
  resolveStealthMeta,
  type EnsTextReader,
} from "../src/names.js";

const MNEMONIC =
  "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
const alice = keysFromMnemonic(MNEMONIC);
const mallory = keysFromMnemonic(MNEMONIC, "mallory");
const aliceBytes = alice.metaAddressURI.slice("st:eth:".length) as Hex;

function ensClient(records: Record<string, Record<string, string>>) {
  const calls: { name: string; key: string }[] = [];
  const client: EnsTextReader = {
    async getEnsText({ name, key }) {
      calls.push({ name, key });
      return records[name]?.[key] ?? null;
    },
  };
  return { client, calls };
}

function baseClient(registry: Record<string, Hex>) {
  const calls: unknown[] = [];
  const client: RegistryReader = {
    async readContract(args) {
      calls.push(args);
      const [registrant] = (args.args ?? []) as [Address];
      return registry[registrant.toLowerCase()] ?? "0x";
    },
  };
  return { client, calls };
}

const aliceRecords = {
  "alice.soapay.eth": {
    [TEXT_KEY_STEALTH]: alice.metaAddressURI,
    [TEXT_KEY_REGISTRANT]: alice.registrantAddress,
  },
};

describe("resolveStealthMeta", () => {
  it("text keys match constants.ts", async () => {
    const ens = ensClient(aliceRecords);
    const base = baseClient({ [alice.registrantAddress.toLowerCase()]: aliceBytes });
    await resolveStealthMeta({ ensClient: ens.client, baseClient: base.client, name: "alice.soapay.eth" });
    expect(ens.calls.map((c) => c.key).sort()).toEqual([TEXT_KEY_REGISTRANT, TEXT_KEY_STEALTH].sort());
  });

  it("resolves, normalises the name and cross-checks the registry", async () => {
    const ens = ensClient(aliceRecords);
    const base = baseClient({ [alice.registrantAddress.toLowerCase()]: aliceBytes });
    const out = await resolveStealthMeta({ ensClient: ens.client, baseClient: base.client, name: "Alice.Soapay.ETH" });
    expect(out).toEqual({ metaAddressURI: alice.metaAddressURI, registrant: alice.registrantAddress });
    expect(ens.calls.every((c) => c.name === "alice.soapay.eth")).toBe(true);
    expect(base.calls).toHaveLength(1);
    expect(base.calls[0]).toMatchObject({
      address: REGISTRY_ADDRESS,
      functionName: "stealthMetaAddressOf",
      args: [alice.registrantAddress, BigInt(SCHEME_ID)],
    });
  });

  it("accepts a raw-bytes text record and upper-case registry bytes", async () => {
    const ens = ensClient({ "alice.soapay.eth": { stealth: aliceBytes, "soapay:registrant": alice.registrantAddress } });
    const base = baseClient({ [alice.registrantAddress.toLowerCase()]: `0x${aliceBytes.slice(2).toUpperCase()}` });
    const out = await resolveStealthMeta({ ensClient: ens.client, baseClient: base.client, name: "alice.soapay.eth" });
    expect(out.metaAddressURI).toBe(alice.metaAddressURI);
  });

  it("NameNotFound when records are missing or malformed", async () => {
    const base = baseClient({ [alice.registrantAddress.toLowerCase()]: aliceBytes });
    const cases: Record<string, string>[] = [
      {},
      { stealth: alice.metaAddressURI },
      { "soapay:registrant": alice.registrantAddress },
      { stealth: alice.metaAddressURI, "soapay:registrant": "not-an-address" },
      { stealth: "st:eth:0xdead", "soapay:registrant": alice.registrantAddress },
    ];
    for (const rec of cases) {
      const ens = ensClient({ "bob.soapay.eth": rec });
      const p = resolveStealthMeta({ ensClient: ens.client, baseClient: base.client, name: "bob.soapay.eth" });
      await expect(p).rejects.toBeInstanceOf(NameNotFound);
      await expect(p).rejects.toMatchObject({ code: "NameNotFound", ensName: "bob.soapay.eth" });
    }
  });

  it("NotRegistered when the registrant has no ERC-6538 entry", async () => {
    const ens = ensClient(aliceRecords);
    const base = baseClient({});
    const p = resolveStealthMeta({ ensClient: ens.client, baseClient: base.client, name: "alice.soapay.eth" });
    await expect(p).rejects.toBeInstanceOf(NotRegistered);
    await expect(p).rejects.toBeInstanceOf(SoapayNameError);
  });

  it("MetaMismatch when ENS points somewhere the registry does not (hijacked record)", async () => {
    const ens = ensClient({
      "alice.soapay.eth": { stealth: mallory.metaAddressURI, "soapay:registrant": alice.registrantAddress },
    });
    const base = baseClient({ [alice.registrantAddress.toLowerCase()]: aliceBytes });
    const p = resolveStealthMeta({ ensClient: ens.client, baseClient: base.client, name: "alice.soapay.eth" });
    await expect(p).rejects.toBeInstanceOf(MetaMismatch);
    await expect(p).rejects.toMatchObject({ code: "MetaMismatch", registryValue: aliceBytes });
  });

  it("rejects names that do not normalise", async () => {
    const ens = ensClient(aliceRecords);
    const base = baseClient({});
    await expect(
      resolveStealthMeta({ ensClient: ens.client, baseClient: base.client, name: "al ice.soapay.eth" }),
    ).rejects.toThrow();
    expect(ens.calls).toHaveLength(0);
  });
});

describe("pinnedMetaChanged", () => {
  it("is false for the same meta-address in any encoding", () => {
    expect(pinnedMetaChanged(alice.metaAddressURI, alice.metaAddressURI)).toBe(false);
    expect(pinnedMetaChanged(alice.metaAddressURI, aliceBytes)).toBe(false);
    expect(pinnedMetaChanged(alice.metaAddressURI, `st:eth:0x${aliceBytes.slice(2).toUpperCase()}`)).toBe(false);
  });

  it("is true when it changed or is malformed", () => {
    expect(pinnedMetaChanged(alice.metaAddressURI, mallory.metaAddressURI)).toBe(true);
    expect(pinnedMetaChanged(alice.metaAddressURI, "")).toBe(true);
    expect(pinnedMetaChanged("garbage", alice.metaAddressURI)).toBe(true);
  });
});
