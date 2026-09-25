import { describe, expect, it, vi } from "vitest";
import {
  ClusterGraph,
  SpendManyError,
  generateMnemonic,
  keysFromMnemonic,
  nameClaimDomain,
  planSpend,
  recoverRegisterKeysSigner,
  type SpendResult,
} from "@soapay/sdk";
import { recoverTypedDataAddress, type Address, type Hex } from "viem";
import { createApi } from "../src/api/client.js";
import { attachSessionTypedData } from "../src/features/recovery/attach.js";
import { rotationClaimTypedData } from "../src/features/rotation/claim.js";
import { finishRotation, prepareRotation, submitRotation } from "../src/features/rotation/flow.js";
import { keyRing } from "../src/features/rotation/keys.js";
import { createMockEnsWriter } from "../src/services/mock.js";
import { executeSpend, type SpendDraft } from "../src/spend/flow.js";
import { rotateSignal } from "../src/worldid/types.js";

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
    expect(d.signal).toBe(rotateSignal("alex", d.newMeta, 1_000n + 1_800n));
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
    const res = await submitRotation({ api, registry, chainId, draft: d, registrant: ring.current, worldId: { session: { session_id: "s" } } });
    expect(url).toBe("https://api.test/names/alex/rotation");
    expect(res.attestation?.label).toBe("alex");
    expect(body.worldIdResult).toEqual({ session_id: "s" });
    const claimSigner = await recoverTypedDataAddress({
      ...rotationClaimTypedData({ label: "alex", oldMeta: d.oldMeta, newMeta: d.newMeta, deadline: d.deadline, chainId }),
      signature: body.registrantSig as Hex,
    });
    expect(claimSigner).toBe(ring.current.registrantAddress);
    const regSigner = await recoverRegisterKeysSigner({ metaAddressURI: d.newMeta, chainId, nonce: 7n, signature: body.registerSig as Hex });
    expect(regSigner).toBe(ring.current.registrantAddress);
  });

  it("never sends a placeholder World ID result", async () => {
    const d = prepareRotation({ mnemonic: m, label: "alex", currentGeneration: 0, oldMeta: ring.current.metaAddressURI });
    let body: Record<string, unknown> = {};
    const api = createApi("https://api.test", async (_u, init) => {
      body = JSON.parse(String(init?.body));
      return new Response("{}", { status: 200 });
    });
    await submitRotation({ api, registry: { readContract: async () => 0n } as never, chainId, draft: d, registrant: ring.current, worldId: { placeholder: true } });
    expect("worldIdResult" in body).toBe(false);
  });

  it("finishRotation writes the canonical new meta via the ENS writer", async () => {
    const ens = createMockEnsWriter();
    const spy = vi.spyOn(ens, "setStealthRecord");
    await finishRotation({ ens, name: "alex.soapay.eth", newMeta: "ST:ETH:0xABC", registrantKey: ring.current.registrantKey });
    expect(spy).toHaveBeenCalledWith({ name: "alex.soapay.eth", metaAddress: "st:eth:0xabc", registrantKey: ring.current.registrantKey });
  });

  it("AttachSession uses the Soapay Names domain", () => {
    const td = attachSessionTypedData({ label: "alex", sessionId: "s", deadline: 1n, chainId });
    expect(td.domain).toEqual(nameClaimDomain(chainId));
    expect(td.types.AttachSession.map((f) => f.name)).toEqual(["label", "sessionId", "deadline"]);
  });
});
