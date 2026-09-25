import { describe, expect, it, vi } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import { keccak256, stringToHex, type Hex } from "viem";
import {
  createAttestationLookup,
  httpAttestationSource,
  META_ROTATION_TYPES,
  metaRotationDomain,
  soapayLabel,
  type AttestationSource,
  type MetaRotationItem,
} from "../src/lib/attestation.js";
import {
  createMockResolver,
  memoryAttestationStore,
  memoryRotationStore,
  mockAttestationSource,
  mockMetaFor,
  MOCK_ATTESTER,
  simulateRotation,
} from "../src/lib/resolver.js";
import { enrollEmployee, payability, recordChanges, verifyRoster, type Employee } from "../src/lib/roster.js";

const CHAIN = 84532;
const attesterKey: Hex = keccak256(stringToHex("test-attester"));
const attester = privateKeyToAccount(attesterKey);
const impostor = privateKeyToAccount(keccak256(stringToHex("impostor")));

const NAME = "alice.soapay.eth";
const OLD = mockMetaFor(NAME, 0);
const NEW = mockMetaFor(NAME, 1);

async function item(
  signer: typeof attester,
  over: Partial<{ label: string; oldMeta: string; newMeta: string; verifiedAt: bigint }> = {},
): Promise<MetaRotationItem> {
  const m = { label: "alice", oldMeta: OLD, newMeta: NEW, verifiedAt: 1_760_000_000n, ...over };
  const signature = await signer.signTypedData({
    domain: metaRotationDomain(CHAIN),
    types: META_ROTATION_TYPES,
    primaryType: "MetaRotation",
    message: m,
  });
  return { label: m.label, oldMeta: m.oldMeta, newMeta: m.newMeta, verifiedAt: m.verifiedAt.toString(), signature };
}

const source = (items: MetaRotationItem[], responseAttester = attester.address): AttestationSource => async () => ({
  attester: responseAttester,
  items,
});

const lookupWith = (src: AttestationSource | null, pinned: string | undefined = attester.address) =>
  createAttestationLookup({ attester: pinned, chainId: CHAIN, source: src });

describe("MetaRotation attestation check", () => {
  it("accepts a valid attestation from the pinned attester for pin → resolved", async () => {
    const s = await lookupWith(source([await item(attester)]))({ ensName: NAME, oldMeta: OLD, newMeta: NEW });
    expect(s).toEqual({ state: "verified", verifiedAt: 1_760_000_000, attester: attester.address });
  });

  it("accepts non-canonical hex case in the response and the pin", async () => {
    const it0 = await item(attester);
    const upper = { ...it0, newMeta: `st:eth:0x${it0.newMeta.slice("st:eth:0x".length).toUpperCase()}` };
    const s = await lookupWith(source([upper]))({ ensName: NAME, oldMeta: OLD, newMeta: NEW });
    expect(s.state).toBe("verified");
  });

  it("blocks a signature from anyone but the pinned attester, even if the response names them", async () => {
    const s = await lookupWith(source([await item(impostor)], impostor.address))({ ensName: NAME, oldMeta: OLD, newMeta: NEW });
    expect(s).toMatchObject({ state: "invalid", reason: expect.stringMatching(/attester this app trusts/) });
  });

  it("blocks when oldMeta isn't the pinned meta-address", async () => {
    const other = mockMetaFor("mallory.soapay.eth", 0);
    const s = await lookupWith(source([await item(attester, { oldMeta: other })]))({ ensName: NAME, oldMeta: OLD, newMeta: NEW });
    expect(s).toMatchObject({ state: "invalid", reason: expect.stringMatching(/pinned/) });
  });

  it("blocks when newMeta isn't what the name resolves to now", async () => {
    const s = await lookupWith(source([await item(attester, { newMeta: mockMetaFor(NAME, 2) })]))({ ensName: NAME, oldMeta: OLD, newMeta: NEW });
    expect(s).toMatchObject({ state: "invalid", reason: expect.stringMatching(/resolves to/) });
  });

  it("blocks an attestation for another label", async () => {
    const s = await lookupWith(source([await item(attester, { label: "bob" })]))({ ensName: NAME, oldMeta: OLD, newMeta: NEW });
    expect(s.state).toBe("invalid");
  });

  it("blocks a tampered field (signature no longer matches)", async () => {
    const good = await item(attester);
    const s = await lookupWith(source([{ ...good, verifiedAt: "1760000001" }]))({ ensName: NAME, oldMeta: OLD, newMeta: NEW });
    expect(s.state).toBe("invalid");
  });

  it("only the newest item counts", async () => {
    const stale = await item(attester);
    const newest = await item(attester, { oldMeta: NEW, newMeta: mockMetaFor(NAME, 2) });
    const s = await lookupWith(source([newest, stale]))({ ensName: NAME, oldMeta: OLD, newMeta: NEW });
    expect(s.state).toBe("invalid");
  });

  it("blocks when there is no attestation (empty list or 404)", async () => {
    expect((await lookupWith(source([]))({ ensName: NAME, oldMeta: OLD, newMeta: NEW })).state).toBe("missing");
    expect((await lookupWith(async () => null)({ ensName: NAME, oldMeta: OLD, newMeta: NEW })).state).toBe("missing");
  });

  it("blocks when the API is down", async () => {
    const down: AttestationSource = async () => {
      throw new TypeError("fetch failed");
    };
    expect(await lookupWith(down)({ ensName: NAME, oldMeta: OLD, newMeta: NEW })).toMatchObject({ state: "unavailable" });
  });

  it("blocks when no attester is pinned or no API is configured", async () => {
    const src = source([await item(attester)]);
    expect((await lookupWith(src, "")({ ensName: NAME, oldMeta: OLD, newMeta: NEW })).state).toBe("unavailable");
    expect((await lookupWith(src, "not-an-address")({ ensName: NAME, oldMeta: OLD, newMeta: NEW })).state).toBe("unavailable");
    expect((await lookupWith(null)({ ensName: NAME, oldMeta: OLD, newMeta: NEW })).state).toBe("unavailable");
  });

  it("names outside soapay.eth never auto-accept", async () => {
    expect(soapayLabel("alice.soapay.eth")).toBe("alice");
    expect(soapayLabel("a.b.soapay.eth")).toBeNull();
    expect(soapayLabel("alice.eth")).toBeNull();
    expect((await lookupWith(source([await item(attester)]))({ ensName: "alice.eth", oldMeta: OLD, newMeta: NEW })).state).toBe("unavailable");
  });
});

describe("HTTP source", () => {
  it("hits GET /names/:label/attestations and maps 404 and 5xx", async () => {
    const body = { attester: attester.address, items: [await item(attester)] };
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      const u = String(url);
      if (u.endsWith("/names/alice/attestations")) return new Response(JSON.stringify(body), { status: 200 });
      if (u.endsWith("/names/ghost/attestations")) return new Response("{}", { status: 404 });
      return new Response("oops", { status: 502 });
    }) as unknown as typeof fetch;
    const src = httpAttestationSource("http://api.test/", { fetchImpl });
    expect(await src("alice")).toEqual(body);
    expect(await src("ghost")).toBeNull();
    await expect(src("boom")).rejects.toThrow(/502/);
    expect((fetchImpl as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]![0]).toBe("http://api.test/names/alice/attestations");
  });
});

describe("roster: rotation with and without attestation (mock mode wiring)", () => {
  async function setup() {
    const rotations = memoryRotationStore();
    const attestations = memoryAttestationStore();
    const resolve = createMockResolver(rotations, 0);
    const alice = await enrollEmployee(resolve, { ensName: NAME, amount: 1_000_000n }, [], 1);
    const bob = await enrollEmployee(resolve, { ensName: "bob.soapay.eth", amount: 1_000_000n }, [alice], 1);
    const lookup = createAttestationLookup({ attester: MOCK_ATTESTER, chainId: CHAIN, source: mockAttestationSource(attestations) });
    return { rotations, attestations, resolve, lookup, roster: [alice, bob] as Employee[] };
  }

  it("attested rotation → pin moves, badge data set, line payable", async () => {
    const { rotations, attestations, resolve, lookup, roster } = await setup();
    await simulateRotation({ name: NAME, rotations, attestations, attest: true, chainId: CHAIN, now: 1_760_000_000_000 });
    const checks = await verifyRoster(resolve, roster);
    const [alice] = await recordChanges(roster, checks, lookup, 5);
    expect(alice!.pendingChange).toBeUndefined();
    expect(alice!.pin.metaAddressURI).toBe(mockMetaFor(NAME, 1));
    expect(alice!.pin.attested).toMatchObject({ verifiedAt: 1_760_000_000, attester: MOCK_ATTESTER, from: mockMetaFor(NAME, 0) });
    expect(alice!.pinHistory.at(-1)!.reason).toBe("attested");
    expect(payability(alice!, checks.get(alice!.id))).toEqual({ payable: true });
  });

  it("unattested rotation → blocked with the salary-redirect warning", async () => {
    const { rotations, attestations, resolve, lookup, roster } = await setup();
    await simulateRotation({ name: NAME, rotations, attestations, attest: false, chainId: CHAIN });
    const checks = await verifyRoster(resolve, roster);
    const [alice, bob] = await recordChanges(roster, checks, lookup, 5);
    expect(alice!.pin.metaAddressURI).toBe(mockMetaFor(NAME, 0));
    expect(alice!.pendingChange?.attestation.state).toBe("missing");
    expect(payability(alice!, checks.get(alice!.id))).toMatchObject({ payable: false, reason: "changed", message: expect.stringMatching(/salary redirect/) });
    expect(payability(bob!, checks.get(bob!.id))).toEqual({ payable: true });
  });

  it("an attested rotation followed by an unattested one blocks the second", async () => {
    const { rotations, attestations, resolve, lookup, roster } = await setup();
    await simulateRotation({ name: NAME, rotations, attestations, attest: true, chainId: CHAIN });
    await simulateRotation({ name: NAME, rotations, attestations, attest: false, chainId: CHAIN });
    const [alice] = await recordChanges(roster, await verifyRoster(resolve, roster), lookup, 5);
    // Newest attestation covers 0→1, but the name now resolves to 2 from pin 0.
    expect(alice!.pendingChange?.attestation.state).toBe("invalid");
  });
});
