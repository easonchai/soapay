import { describe, expect, it } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import {
  applyPinDecision,
  checkMetaPin,
  emptyPinBook,
  httpRotationAttestationSource,
  parsePinBook,
  pinKey,
  rotationAttestationLookup,
  soapayLabel,
  verifyRotationAttestation,
  type RotationAttestationSource,
} from "../src/pins.js";
import { metaRotationTypedData, type MetaRotationAttestation } from "../src/rotation.js";

const attester = privateKeyToAccount(`0x${"a1".repeat(32)}`);
const stranger = privateKeyToAccount(`0x${"b2".repeat(32)}`);
function pub(n: number): string {
  const p = privateKeyToAccount(`0x${n.toString(16).padStart(64, "0")}`).publicKey;
  return (BigInt(`0x${p.slice(68)}`) % 2n === 0n ? "02" : "03") + p.slice(4, 68);
}
const META_A = `st:eth:0x${pub(11)}${pub(12)}`;
const META_B = `st:eth:0x${pub(13)}${pub(14)}`;
const META_C = `st:eth:0x${pub(15)}${pub(16)}`;
const CHAIN = 84532;

async function attest(signer: typeof attester, label: string, oldMeta: string, newMeta: string, verifiedAt = 1_700_000_000n): Promise<MetaRotationAttestation> {
  const signature = await signer.signTypedData(metaRotationTypedData({ label, oldMeta, newMeta, verifiedAt, chainId: CHAIN }));
  return { label, oldMeta, newMeta, verifiedAt: verifiedAt.toString(), signature };
}

function source(items: Record<string, MetaRotationAttestation[]>): RotationAttestationSource {
  return async (label) => (items[label]?.length ? { attester: stranger.address, items: items[label]! } : null);
}

describe("rotation attestations (the sender app's check, D-13)", () => {
  it("soapayLabel only accepts direct children of the parent", () => {
    expect(soapayLabel("Alice.Soapay.eth")).toBe("alice");
    expect(soapayLabel("a.b.soapay.eth")).toBeNull();
    expect(soapayLabel("alice.eth")).toBeNull();
  });

  it("verifies exactly pinned → current, signed by the pinned attester", async () => {
    const item = await attest(attester, "alice", META_A, META_B);
    const base = { item, label: "alice", oldMeta: META_A, newMeta: META_B, attester: attester.address, chainId: CHAIN };
    expect(await verifyRotationAttestation(base)).toEqual({ state: "verified", verifiedAt: 1_700_000_000, attester: attester.address });
    expect((await verifyRotationAttestation({ ...base, newMeta: META_C })).state).toBe("invalid");
    expect((await verifyRotationAttestation({ ...base, oldMeta: META_C })).state).toBe("invalid");
    expect((await verifyRotationAttestation({ ...base, label: "bob" })).state).toBe("invalid");
    expect((await verifyRotationAttestation({ ...base, attester: stranger.address })).state).toBe("invalid");
    expect((await verifyRotationAttestation({ ...base, chainId: 1 })).state).toBe("invalid");
  });

  it("lookup ignores the API's attester field and fails closed", async () => {
    const forged = await attest(stranger, "alice", META_A, META_B);
    const good = await attest(attester, "alice", META_A, META_B);
    const lookup = (items: Record<string, MetaRotationAttestation[]>, pinned: string | null = attester.address) =>
      rotationAttestationLookup({ attester: pinned ?? undefined, chainId: CHAIN, source: source(items) });
    const q = { ensName: "alice.soapay.eth", oldMeta: META_A, newMeta: META_B };
    expect((await lookup({ alice: [good] })(q)).state).toBe("verified");
    expect((await lookup({ alice: [forged] })(q)).state).toBe("invalid");
    expect((await lookup({})(q)).state).toBe("missing");
    expect((await lookup({ alice: [good] }, null)(q)).state).toBe("unavailable");
    expect((await lookup({ alice: [good] })({ ...q, ensName: "alice.eth" })).state).toBe("unavailable");
    const down = rotationAttestationLookup({ attester: attester.address, chainId: CHAIN, source: async () => { throw new Error("ECONNREFUSED"); } });
    expect(await down(q)).toMatchObject({ state: "unavailable", reason: expect.stringContaining("ECONNREFUSED") });
  });

  it("http source maps 404 to null and rejects odd shapes", async () => {
    const f = (status: number, body: unknown) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
    expect(await httpRotationAttestationSource("http://api/", { fetchImpl: f(404, {}) })("alice")).toBeNull();
    await expect(httpRotationAttestationSource("http://api", { fetchImpl: f(200, { nope: 1 }) })("alice")).rejects.toThrow(/shape/);
    await expect(httpRotationAttestationSource("http://api", { fetchImpl: f(500, {}) })("alice")).rejects.toThrow(/500/);
  });
});

describe("pin book (D-05, D-49)", () => {
  const lookup = (items: Record<string, MetaRotationAttestation[]>) => rotationAttestationLookup({ attester: attester.address, chainId: CHAIN, source: source(items) });

  it("pins on first resolve, then passes while unchanged", async () => {
    const d = await checkMetaPin({ identifier: "alice.soapay.eth", pin: undefined, resolvedMeta: META_A });
    expect(d).toEqual({ state: "new" });
    const book = applyPinDecision(emptyPinBook(), { identifier: "Alice.soapay.eth", resolved: { metaAddressURI: META_A, source: "ens" }, decision: d, now: 5 });
    const pin = book.pins[pinKey("alice.soapay.eth")]!;
    expect(pin).toMatchObject({ metaAddressURI: META_A, source: "ens", pinnedAt: 5 });
    expect(pin.history).toEqual([{ metaAddressURI: META_A, at: 5, reason: "pinned" }]);
    expect(await checkMetaPin({ identifier: "alice.soapay.eth", pin, resolvedMeta: META_A.toUpperCase().replace("ST:ETH:0X", "st:eth:0x") })).toEqual({ state: "ok" });
    expect(parsePinBook(JSON.stringify(book))).toEqual(book);
  });

  it("blocks a change without an attestation, moves the pin with one, or on explicit acceptance", async () => {
    const book = applyPinDecision(emptyPinBook(), { identifier: "alice.soapay.eth", resolved: { metaAddressURI: META_A }, decision: { state: "new" }, now: 1 });
    const pin = book.pins["alice.soapay.eth"]!;

    const blocked = await checkMetaPin({ identifier: "alice.soapay.eth", pin, resolvedMeta: META_B, lookup: lookup({}) });
    expect(blocked).toMatchObject({ state: "blocked", from: META_A, to: META_B, attestation: { state: "missing" } });
    expect(applyPinDecision(book, { identifier: "alice.soapay.eth", resolved: { metaAddressURI: META_B }, decision: blocked, now: 2 })).toBe(book);

    // An attestation for a different transition doesn't count (stolen key rotating to META_C).
    const wrong = await checkMetaPin({ identifier: "alice.soapay.eth", pin, resolvedMeta: META_C, lookup: lookup({ alice: [await attest(attester, "alice", META_A, META_B)] }) });
    expect(wrong).toMatchObject({ state: "blocked", attestation: { state: "invalid" } });

    const rotated = await checkMetaPin({ identifier: "alice.soapay.eth", pin, resolvedMeta: META_B, lookup: lookup({ alice: [await attest(attester, "alice", META_A, META_B)] }) });
    expect(rotated).toMatchObject({ state: "rotated", from: META_A, attester: attester.address });
    const moved = applyPinDecision(book, { identifier: "alice.soapay.eth", resolved: { metaAddressURI: META_B }, decision: rotated, now: 3 });
    expect(moved.pins["alice.soapay.eth"]!.metaAddressURI).toBe(META_B);
    expect(moved.pins["alice.soapay.eth"]!.history.map((h) => h.reason)).toEqual(["pinned", "rotated-world-id"]);

    const accepted = await checkMetaPin({ identifier: "alice.soapay.eth", pin, resolvedMeta: META_C, lookup: lookup({}), acceptChange: true });
    expect(accepted).toMatchObject({ state: "accepted", from: META_A, attestation: { state: "missing" } });
    expect(applyPinDecision(book, { identifier: "alice.soapay.eth", resolved: { metaAddressURI: META_C }, decision: accepted, now: 4 }).pins["alice.soapay.eth"]!.history.at(-1)!.reason).toBe("accepted-by-payer");
  });

  it("rejects malformed pin files", () => {
    expect(() => parsePinBook("nope")).toThrow(/JSON/);
    expect(() => parsePinBook(JSON.stringify({ version: 2, pins: {} }))).toThrow(/shape/);
    expect(() => parsePinBook(JSON.stringify({ version: 1, pins: { a: {} } }))).toThrow(/metaAddressURI/);
  });
});
