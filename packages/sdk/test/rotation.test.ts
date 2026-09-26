import { describe, expect, it } from "vitest";
import { keccak256, stringToBytes, verifyTypedData } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  attachSessionTypedData,
  metaRotationTypedData,
  rotationClaimTypedData,
  rotationSignal,
  SESSION_LOOKUP_MAX_TTL_SECONDS,
  sessionLookupTypedData,
  sessionSignal,
  signSessionLookup,
  worldIdSignalHash,
} from "../src/rotation.js";

const key = privateKeyToAccount(`0x${"42".repeat(32)}`);
function pub(n: number): string {
  const p = privateKeyToAccount(`0x${n.toString(16).padStart(64, "0")}`).publicKey; // 0x04 || x || y
  return (BigInt(`0x${p.slice(68)}`) % 2n === 0n ? "02" : "03") + p.slice(4, 68);
}
const META_A = `st:eth:0x${pub(11)}${pub(12)}`;
const META_B = `st:eth:0x${pub(13)}${pub(14)}`;

describe("rotation typed data (docs/mvp-spec.md §2.1)", () => {
  it("RotationClaim and MetaRotation use the agreed domains and canonical lowercase meta-addresses", async () => {
    const claim = rotationClaimTypedData({ label: "alice", oldMeta: META_A.toUpperCase().replace("ST:ETH:0X", "st:eth:0x"), newMeta: META_B, deadline: 9n, chainId: 84532 });
    expect(claim.domain).toEqual({ name: "Soapay Names", version: "1", chainId: 84532 });
    expect(claim.message.oldMeta).toBe(META_A);
    const att = metaRotationTypedData({ label: "alice", oldMeta: META_A, newMeta: META_B, verifiedAt: 5n, chainId: 84532 });
    expect(att.domain).toEqual({ name: "Soapay Attestations", version: "1", chainId: 84532 });
    const sig = await key.signTypedData(att);
    expect(await verifyTypedData({ address: key.address, ...att, signature: sig })).toBe(true);
  });

  it("AttachSession signs label, session id and deadline under the Soapay Names domain", async () => {
    const td = attachSessionTypedData({ label: "alice", sessionId: `session_${"ab".repeat(64)}`, deadline: 7n, chainId: 84532 });
    expect(td.primaryType).toBe("AttachSession");
    expect(td.domain.name).toBe("Soapay Names");
    const sig = await key.signTypedData(td);
    expect(await verifyTypedData({ address: key.address, ...td, signature: sig })).toBe(true);
    expect(() => attachSessionTypedData({ label: "alice", sessionId: "nope", deadline: 1n, chainId: 1 })).toThrow(/session_/);
    expect(() => attachSessionTypedData({ label: "A!", sessionId: "session_ab", deadline: 1n, chainId: 1 })).toThrow(/label/);
  });
});

describe("SessionLookup typed data (D-64)", () => {
  it("signs label and deadline under the Soapay Names domain, with a distinct type from AttachSession", async () => {
    const td = sessionLookupTypedData({ label: "alice", deadline: 7n, chainId: 84532 });
    expect(td.primaryType).toBe("SessionLookup");
    expect(td.domain).toEqual({ name: "Soapay Names", version: "1", chainId: 84532 });
    expect(td.types.SessionLookup).toEqual([
      { name: "label", type: "string" },
      { name: "deadline", type: "uint256" },
    ]);
    const sig = await signSessionLookup({ label: "alice", deadline: 7n, chainId: 84532, registrantKey: `0x${"42".repeat(32)}` });
    expect(await verifyTypedData({ address: key.address, ...td, signature: sig })).toBe(true);
    // Bound to the label and the chain.
    expect(await verifyTypedData({ address: key.address, ...sessionLookupTypedData({ label: "bob", deadline: 7n, chainId: 84532 }), signature: sig })).toBe(false);
    expect(await verifyTypedData({ address: key.address, ...sessionLookupTypedData({ label: "alice", deadline: 7n, chainId: 8453 }), signature: sig })).toBe(false);
    expect(SESSION_LOOKUP_MAX_TTL_SECONDS).toBe(3_600);
  });

  it("refuses a bad label, and a key that isn't the registrant", async () => {
    expect(() => sessionLookupTypedData({ label: "A!", deadline: 1n, chainId: 1 })).toThrow(/label/);
    await expect(
      signSessionLookup({ label: "alice", deadline: 1n, chainId: 1, registrantKey: `0x${"42".repeat(32)}`, registrant: `0x${"11".repeat(20)}` }),
    ).rejects.toThrow(/registrant/);
  });
});

describe("World ID signals", () => {
  it("bind sessions to name + registrant and rotations to name + new meta + deadline", () => {
    expect(sessionSignal("alice", key.address)).toBe(`soapay:session:alice:${key.address.toLowerCase()}`);
    expect(rotationSignal("alice", META_B.toUpperCase().replace("ST:ETH:0X", "st:eth:0x"), 9n)).toBe(`soapay:rotate:alice:${META_B}:9`);
  });

  it("hash like IDKit: keccak256 >> 8, hex signals as bytes", () => {
    const s = "soapay:x";
    expect(BigInt(worldIdSignalHash(s))).toBe(BigInt(keccak256(stringToBytes(s))) >> 8n);
    expect(BigInt(worldIdSignalHash("0xdead"))).toBe(BigInt(keccak256("0xdead")) >> 8n);
    expect(worldIdSignalHash(s)).toMatch(/^0x00[0-9a-f]{62}$/);
  });
});
