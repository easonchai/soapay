import { describe, expect, it } from "vitest";
import { keccak256, stringToBytes, verifyTypedData } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  attachSessionTypedData,
  attachWorldIdTypedData,
  WORLD_ID_ACTION,
  worldIdNullifierOf,
  metaRotationTypedData,
  rotationClaimTypedData,
  rotationSignal,
  sessionSignal,
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

  it("AttachWorldId signs label, nullifier (uint256) and deadline under the Soapay Names domain (D-58)", async () => {
    const nullifier = `0x${"0a".repeat(32)}`;
    const td = attachWorldIdTypedData({ label: "alice", nullifier, deadline: 7n, chainId: 84532 });
    expect(td.primaryType).toBe("AttachWorldId");
    expect(td.domain).toEqual({ name: "Soapay Names", version: "1", chainId: 84532 });
    expect(td.message.nullifier).toBe(BigInt(nullifier));
    // Hex, decimal and bigint forms of the same nullifier sign the same message.
    const sig = await key.signTypedData(td);
    for (const n of [BigInt(nullifier), BigInt(nullifier).toString(10)]) {
      expect(await verifyTypedData({ address: key.address, ...attachWorldIdTypedData({ label: "alice", nullifier: n, deadline: 7n, chainId: 84532 }), signature: sig })).toBe(true);
    }
    expect(() => attachWorldIdTypedData({ label: "alice", nullifier: "nope", deadline: 1n, chainId: 1 })).toThrow(/nullifier/);
    expect(() => attachWorldIdTypedData({ label: "A!", nullifier: 1n, deadline: 1n, chainId: 1 })).toThrow(/label/);
  });

  it("worldIdNullifierOf reads the Proof of Human nullifier from an IDKit v4 result", () => {
    const result = {
      protocol_version: "4.0",
      action: WORLD_ID_ACTION,
      responses: [
        { identifier: "selfie", issuer_schema_id: 11, nullifier: "0x01" },
        { identifier: "proof_of_human", issuer_schema_id: 1, nullifier: "0x0a" },
      ],
    };
    expect(WORLD_ID_ACTION).toBe("soapay-recovery");
    expect(worldIdNullifierOf(result)).toBe(10n);
    expect(worldIdNullifierOf({ session_id: "session_ab", responses: [] })).toBeUndefined();
    expect(worldIdNullifierOf(undefined)).toBeUndefined();
    expect(worldIdNullifierOf({ responses: [{ identifier: "proof_of_human", issuer_schema_id: 1, nullifier: "zz" }] })).toBeUndefined();
  });

  it("AttachSession (deprecated) signs label, session id and deadline under the Soapay Names domain", async () => {
    const td = attachSessionTypedData({ label: "alice", sessionId: `session_${"ab".repeat(64)}`, deadline: 7n, chainId: 84532 });
    expect(td.primaryType).toBe("AttachSession");
    expect(td.domain.name).toBe("Soapay Names");
    const sig = await key.signTypedData(td);
    expect(await verifyTypedData({ address: key.address, ...td, signature: sig })).toBe(true);
    expect(() => attachSessionTypedData({ label: "alice", sessionId: "nope", deadline: 1n, chainId: 1 })).toThrow(/session_/);
    expect(() => attachSessionTypedData({ label: "A!", sessionId: "session_ab", deadline: 1n, chainId: 1 })).toThrow(/label/);
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
