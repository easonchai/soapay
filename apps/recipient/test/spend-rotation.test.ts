import { describe, expect, it, vi } from "vitest";
import {
  ClusterGraph,
  SpendManyError,
  generateMnemonic,
  keysFromMnemonic,
  attachWorldIdTypedData,
  nameClaimDomain,
  planSpend,
  recoverRegisterKeysSigner,
  rotationClaimTypedData,
  rotationSignal,
  worldIdNullifierOf,
  type SpendResult,
} from "@soapay/sdk";
import { recoverTypedDataAddress, type Address, type Hex } from "viem";
import { createApi } from "../src/api/client.js";
import { attachSession } from "../src/features/recovery/attach.js";
import { finishRotation, prepareRotation, submitRotation } from "../src/features/rotation/flow.js";
import { keyRing } from "../src/features/rotation/keys.js";
import { createMockEnsWriter, createMockFetch } from "../src/services/mock.js";
import { executeSpend, type SpendDraft } from "../src/spend/flow.js";
import { MOCK_IDENTITY, mockNullifier, mockProofResult } from "../src/worldid/MockHumanCheck.js";
import { worldIdLinkOf } from "../src/worldid/types.js";
import { rotationPathOf, sessionCooldownUntil } from "../src/hooks/useRotation.js";

const A = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as Address;
const B = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" as Address;
const C = "0xcccccccccccccccccccccccccccccccccccccccc" as Address;
const TO = "0x1111111111111111111111111111111111111111" as Address;

describe("executeSpend partial failure", () => {
  it("links only the sources that actually sent", async () => {
    const g = new ClusterGraph();
    for (const a of [A, B, C]) g.addStealth(a);
    const plan = planSpend(g, { from: [A, B, C], to: TO, override: true });
    const parts = [A, B, C].map((address) => ({ address, amount: 10n, fee: 1n }));
    const draft: SpendDraft = {
      to: TO,
      amount: 30n,
      suggestion: { from: [A, B, C], clusterIds: [A, B, C], merges: 2, total: 33n, sufficient: true },
      quotes: [],
      allocation: { parts, receive: 30n, fees: 3n, debit: 33n, sufficient: true, maxReceivable: 30n },
      plan,
      keys: new Map([A, B, C].map((a) => [a.toLowerCase(), ("0x" + "11".repeat(32)) as Hex])),
    };
    const sent: SpendResult = { from: A, userOpHash: "0x01", txHash: "0x02", delegated: true, amount: 10n, feeEstimate: 1n };
    const outcome = await executeSpend({
      graph: g,
      draft,
      spend: { sendAll: vi.fn(async () => Promise.reject(new SpendManyError([sent], 1, new Error("AA21")))) },
      now: 1,
    });
    expect(outcome.failure).toEqual({ index: 1, from: B, message: "AA21" });
    expect(outcome.record.parts).toHaveLength(1);
    expect(outcome.record.failed?.from).toBe(B);
    // A is linked to the destination; B and C were never sent, so they stay separate.
    expect(outcome.graph.clusterOf(A)).toBe(outcome.graph.clusterOf(TO));
    expect(outcome.graph.clusterOf(B)).not.toBe(outcome.graph.clusterOf(A));
    expect(outcome.graph.clusterOf(C)).not.toBe(outcome.graph.clusterOf(B));
  });

  it("refuses a blocked plan", async () => {
    const draft = { plan: { decision: "block" } } as unknown as SpendDraft;
    await expect(executeSpend({ graph: new ClusterGraph(), draft, spend: { sendAll: vi.fn() } })).rejects.toThrow(/blocked/);
  });
});

describe("rotation", () => {
  const m = generateMnemonic();
  const ring = keyRing(m, 0, keysFromMnemonic(m));
  const chainId = 84532;

  it("prepareRotation moves to the next generation and binds the World ID signal to the deadline", () => {
    const d = prepareRotation({ mnemonic: m, label: "alex", currentGeneration: 0, oldMeta: ring.current.metaAddressURI, now: 1_000_000 });
    expect(d.generation).toBe(1);
    expect(d.newMeta).not.toBe(d.oldMeta);
    expect(d.newMeta).toBe(keyRing(m, 1).current.metaAddressURI.toLowerCase());
    expect(d.signal).toBe(rotationSignal("alex", d.newMeta, 1_000n + 1_800n));
    expect(d.signal).toBe(`soapay:rotate:alex:${d.newMeta}:2800`);
  });

  it("submitRotation posts a RotationClaim and a registerKeysOnBehalf for the new meta, both by the gen-0 registrant", async () => {
    const d = prepareRotation({ mnemonic: m, label: "alex", currentGeneration: 0, oldMeta: ring.current.metaAddressURI });
    let body: Record<string, unknown> = {};
    let url = "";
    const api = createApi("https://api.test", async (u, init) => {
      url = u;
      body = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ attestation: { label: "alex" } }), { status: 200 });
    });
    const registry = { readContract: async () => 7n } as never;
    const idkit = mockProofResult({ signal: rotationSignal("alex", d.newMeta, d.deadline) });
    const res = await submitRotation({ api, registry, chainId, draft: d, registrant: ring.current, worldId: idkit });
    expect(url).toBe("https://api.test/names/alex/rotation");
    expect(res.attestation?.label).toBe("alex");
    // The IDKit result is forwarded unchanged.
    expect(body.worldIdResult).toEqual(idkit);
    const claimSigner = await recoverTypedDataAddress({
      ...rotationClaimTypedData({ label: "alex", oldMeta: d.oldMeta, newMeta: d.newMeta, deadline: d.deadline, chainId }),
      signature: body.registrantSig as Hex,
    });
    expect(claimSigner).toBe(ring.current.registrantAddress);
    const regSigner = await recoverRegisterKeysSigner({ metaAddressURI: d.newMeta, chainId, nonce: 7n, signature: body.registerSig as Hex });
    expect(regSigner).toBe(ring.current.registrantAddress);
  });

  it("attachSession signs the SDK AttachWorldId typed data over the proof's nullifier and returns the cooldown", async () => {
    let body: Record<string, unknown> = {};
    const api = createApi("https://api.test", async (_u, init) => {
      body = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ label: "alex", attachedAt: 10, rotationAllowedFrom: 10 + 72 * 3600 }), { status: 201 });
    });
    const result = mockProofResult({ signal: "soapay:session:alex:0x1" });
    const res = await attachSession({ api, chainId, label: "alex", result, registrantKey: ring.current.registrantKey, now: 0 });
    expect(res.rotationAllowedFrom).toBe(10 + 72 * 3600);
    expect(body.worldIdResult).toEqual(result); // forwarded unchanged
    const signer = await recoverTypedDataAddress({
      ...attachWorldIdTypedData({ label: "alex", nullifier: mockNullifier(), deadline: BigInt(body.deadline as string), chainId }),
      signature: body.signature as Hex,
    });
    expect(signer).toBe(ring.current.registrantAddress);
    await expect(attachSession({ api, chainId, label: "alex", result: {}, registrantKey: ring.current.registrantKey })).rejects.toThrow(/nullifier/);
  });

  it("rotation is attested only with a World ID link (nullifier) past its cooldown", () => {
    const name = { label: "alex", name: "alex.soapay.eth", at: 0 };
    expect(rotationPathOf({ name })).toBe("manual");
    // A legacy session id (D-16/D-57) no longer backs a rotation.
    expect(rotationPathOf({ name, recovery: { kind: "world-id", at: 0, sessionId: "session_ab", attachedTo: "alex" } })).toBe("manual");
    const rec = { kind: "world-id" as const, at: 0, nullifier: mockNullifier(), attachedTo: "alex" };
    expect(rotationPathOf({ name, recovery: rec })).toBe("attested");
    const late = { ...rec, rotationAllowedFrom: 1_000 };
    expect(rotationPathOf({ name, recovery: late }, 999_000)).toBe("manual");
    expect(sessionCooldownUntil({ name, recovery: late }, 999_000)).toBe(1_000_000);
    expect(rotationPathOf({ name, recovery: late }, 1_000_000)).toBe("attested");
    expect(rotationPathOf({ name, recovery: { ...rec, attachedTo: "other" } })).toBe("manual");
  });

  it("the mock HumanCheck returns IDKit-shaped one-time results with a deterministic nullifier per identity", () => {
    const created = mockProofResult({ signal: "soapay:session:alex:0x1" });
    expect(created).toMatchObject({ protocol_version: "4.0", action: "soapay-recovery" });
    expect(created).not.toHaveProperty("session_id");
    const again = mockProofResult({ signal: "soapay:rotate:alex" });
    expect(worldIdNullifierOf(again)).toBe(worldIdNullifierOf(created)); // same person, same nullifier
    expect(worldIdLinkOf(created)).toBe(mockNullifier(MOCK_IDENTITY));
    expect(worldIdNullifierOf(mockProofResult({ signal: "x" }, "someone-else"))).not.toBe(worldIdNullifierOf(created));
  });

  it("the mock API links the nullifier and rotates only for the same human", async () => {
    const f = createMockFetch(chainId);
    const keys = ring.current;
    await f("https://api.test/register", { method: "POST", body: JSON.stringify({ registrant: keys.registrantAddress, metaAddress: keys.metaAddressURI }) });
    const claim = { label: "alexmock", registrant: keys.registrantAddress, metaAddress: keys.metaAddressURI, deadline: "9999999999", signature: "0x" };
    const linked = await f("https://api.test/names", { method: "POST", body: JSON.stringify({ ...claim, worldIdSession: mockProofResult({ signal: "s" }) }) });
    expect(linked.status).toBe(201);
    const body = (worldIdResult: unknown) => ({
      method: "POST",
      body: JSON.stringify({ newMeta: "st:eth:0x01", deadline: "9999999999", registrantSig: "0x1", registerSig: "0x2", worldIdResult }),
    });
    const other = await f("https://api.test/names/alexmock/rotation", body(mockProofResult({ signal: "r" }, "someone-else")));
    expect(other.status).toBe(403);
    expect((await other.json()).error.code).toBe("human_mismatch");
    const same = await f("https://api.test/names/alexmock/rotation", body(mockProofResult({ signal: "r" })));
    expect(same.status).toBe(201);
  });

  it("finishRotation writes the canonical new meta via the ENS writer", async () => {
    const ens = createMockEnsWriter();
    const spy = vi.spyOn(ens, "setStealthRecord");
    await finishRotation({ ens, name: "alex.soapay.eth", newMeta: "ST:ETH:0xABC", registrantKey: ring.current.registrantKey });
    expect(spy).toHaveBeenCalledWith({ name: "alex.soapay.eth", metaAddress: "st:eth:0xabc", registrantKey: ring.current.registrantKey });
  });

  it("AttachWorldId uses the Soapay Names domain", () => {
    const td = attachWorldIdTypedData({ label: "alex", nullifier: mockNullifier(), deadline: 1n, chainId });
    expect(td.domain).toEqual(nameClaimDomain(chainId));
    expect(td.types.AttachWorldId.map((f) => f.name)).toEqual(["label", "nullifier", "deadline"]);
    expect(td.message.nullifier).toBe(BigInt(mockNullifier()));
  });
});
