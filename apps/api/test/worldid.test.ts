import { describe, expect, it, vi } from "vitest";
import { getAddress, verifyTypedData, type Address, type Hash, type Hex, type PrivateKeyAccount } from "viem";
import { attachWorldIdTypedData, nameClaimTypedData, rotationClaimTypedData, rotationSignal, sessionSignal, worldIdSignalHash } from "@soapay/sdk";
import { hashSignal } from "@worldcoin/idkit-core/hashing";
import type { Fetch } from "../src/worldid/portal.js";
import { topUpRegistrant, type L1Funder } from "../src/topup.js";
import { attesterAccount, j, makeTestApp, metaHex, metaUri, NOW, other, registrant } from "./helpers.js";

const CHAIN_ID = 84532;
/** Two humans: each has one stable nullifier on (RP, action `soapay-recovery`). */
const HUMAN_A = `0x${"0a".repeat(32)}`;
const HUMAN_B = `0x${"0b".repeat(32)}`;
const dec = (h: string) => BigInt(h).toString(10);
const REGISTER_SIG = `0x${"12".repeat(65)}` as Hex;

// ---------------------------------------------------------------------------
// Mocked Developer Portal: POST /api/v4/verify/{rp_id}

type PortalMode = "ok" | "reject" | "production" | "down" | "other-nullifier";

function portal() {
  let mode: PortalMode = "ok";
  const calls: { url: string; body: any; headers: Record<string, string> }[] = [];
  const fetch: Fetch = async (url, init) => {
    const body = JSON.parse(String(init?.body));
    calls.push({ url, body, headers: { ...(init?.headers as Record<string, string>) } });
    if (mode === "down") throw new Error("ECONNREFUSED");
    if (mode === "reject") return Response.json({ success: false, code: "invalid_proof", detail: "bad" }, { status: 400 });
    const nullifier = mode === "other-nullifier" ? HUMAN_B : body.responses?.[0]?.nullifier;
    return Response.json({
      success: true,
      action: body.action,
      nullifier,
      environment: mode === "production" ? "production" : body.environment,
      results: [{ identifier: "proof_of_human", success: true, nullifier }],
    });
  };
  return { fetch, calls, setMode: (m: PortalMode) => (mode = m) };
}

/** An IDKit 4.3 one-time (uniqueness) result, `IDKitResultV4`, for a Proof of Human credential. */
function proofResult(o: {
  nonce: string;
  signal: string;
  nullifier?: string;
  environment?: string;
  action?: string;
  identifier?: string;
  schema?: number;
}) {
  return {
    protocol_version: "4.0",
    nonce: o.nonce,
    action: o.action ?? "soapay-recovery",
    environment: o.environment ?? "staging",
    responses: [
      {
        identifier: o.identifier ?? "proof_of_human",
        issuer_schema_id: o.schema ?? 1,
        signal_hash: o.signal === "" ? "0x0" : worldIdSignalHash(o.signal),
        nullifier: o.nullifier ?? HUMAN_A,
        proof: ["0x1", "0x2", "0x3", "0x4", "0x5"],
        expires_at_min: NOW + 86_400,
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Setup helpers

function setup(opts: { env?: Record<string, string>; l1Funder?: L1Funder } = {}) {
  const p = portal();
  const t = makeTestApp({ portalFetch: p.fetch, attester: true, ...(opts.env ? { env: opts.env } : {}), ...(opts.l1Funder ? { l1Funder: opts.l1Funder } : {}) });
  // The registry holds meta 1 for the registrant (checked by POST /names), until a relay lands.
  const registry = new Map<string, Hex>([[registrant.address, metaHex(1)], [other.address, metaHex(3)]]);
  t.client.readContract.mockImplementation(async (a: any) => registry.get(a.args[0]) ?? "0x");
  const rpNonce = async (bind?: string): Promise<string> =>
    (await j(await t.post("/worldid/rp-context", bind ? { bind } : {}))).rp_context.nonce;
  return { ...t, portal: p, registry, rpNonce };
}

type T = ReturnType<typeof setup>;

async function claimBody(opts: { signer?: PrivateKeyAccount; label?: string; meta?: string } = {}) {
  const signer = opts.signer ?? registrant;
  const msg = { label: opts.label ?? "alice", registrant: signer.address, metaAddress: opts.meta ?? metaUri(1), deadline: BigInt(NOW + 600) };
  const signature = await signer.signTypedData(nameClaimTypedData({ ...msg, chainId: CHAIN_ID }));
  return { ...msg, deadline: msg.deadline.toString(), signature };
}

/** Claims `alice` with a World ID link (a Proof of Human proof) made at enrollment. */
async function enrollWithLink(t: T, nullifier = HUMAN_A) {
  const nonce = await t.rpNonce();
  const res = await t.post("/names", {
    ...(await claimBody()),
    worldIdSession: proofResult({ nonce, signal: sessionSignal("alice", registrant.address), nullifier }),
  });
  expect(res.status).toBe(201);
  return j(res);
}

async function rotationBody(
  t: T,
  o: { newMeta?: string; oldMeta?: string; deadline?: bigint; signer?: PrivateKeyAccount; result?: unknown; nullifier?: string; nonce?: string } = {},
) {
  const newMeta = o.newMeta ?? metaUri(2);
  const deadline = o.deadline ?? BigInt(NOW + 600);
  const registrantSig = await (o.signer ?? registrant).signTypedData(
    rotationClaimTypedData({ label: "alice", oldMeta: o.oldMeta ?? metaUri(1), newMeta, deadline, chainId: CHAIN_ID }),
  );
  const result =
    "result" in o
      ? o.result
      : proofResult({
          nonce: o.nonce ?? (await t.rpNonce()),
          signal: rotationSignal("alice", newMeta, deadline),
          ...(o.nullifier ? { nullifier: o.nullifier } : {}),
        });
  return { newMeta, deadline: deadline.toString(), registrantSig, registerSig: REGISTER_SIG, worldIdResult: result };
}

const rotate = (t: T, body: unknown) => t.post("/names/alice/rotation", body);

// ---------------------------------------------------------------------------

describe("World ID config and RP context", () => {
  it("serves public parameters only, with the registered app, RP and action by default", async () => {
    const t = setup({ env: { WORLD_STAGING_VERIFY_TOKEN: "staging-token-test" } });
    const cfg = await j(await t.app.request("/worldid/config"));
    expect(cfg).toEqual({
      enabled: true,
      app_id: "app_0cc7167efe114ac2e0ef7d9827098353",
      rp_id: "rp_3ede5fe1cab9af48",
      environment: "staging",
      action: "soapay-recovery",
      credential: "proof_of_human",
      attach_cooldown_seconds: 259_200,
      attester: attesterAccount.address,
    });
    expect(JSON.stringify(cfg)).not.toMatch(/5555|staging-token-test/);
  });

  it("signs a one-time request for the configured action, and still accepts the old body shape", async () => {
    const t = setup({ env: { WORLD_ACTION: "soapay-recovery-test" } });
    const res = await j(await t.post("/worldid/rp-context", {}));
    expect(res.kind).toBe("uniqueness");
    expect(res.action).toBe("soapay-recovery-test");
    expect(res.rp_context.rp_id).toBe("rp_3ede5fe1cab9af48");
    expect(res.rp_context.nonce).toMatch(/^0x[0-9a-f]+$/i);
    expect(res.rp_context.expires_at - res.rp_context.created_at).toBe(300);
    expect((await t.post("/worldid/rp-context", { kind: "session", bind: "soapay:x" })).status).toBe(200);
    expect((await t.post("/worldid/rp-context", { kind: "uniqueness" })).status).toBe(200);
    expect((await t.post("/worldid/rp-context", { kind: "bogus" })).status).toBe(400);
  });

  it("returns 503 when World ID is disabled", async () => {
    const t = makeTestApp({ attester: true });
    expect((await t.post("/worldid/rp-context", {})).status).toBe(503);
    expect((await j(await t.app.request("/worldid/config"))).enabled).toBe(false);
  });

  it("rate-limits rp-context per IP", async () => {
    const t = setup({ env: { RATE_LIMIT_RP_CONTEXT_PER_IP: "2" } });
    expect((await t.post("/worldid/rp-context", {})).status).toBe(200);
    expect((await t.post("/worldid/rp-context", {})).status).toBe(200);
    expect((await t.post("/worldid/rp-context", {})).status).toBe(429);
  });

  it("hashes signals exactly like IDKit", () => {
    for (const s of [sessionSignal("alice", registrant.address), rotationSignal("alice", metaUri(2), 123n), "0xdeadbeef"]) {
      expect(BigInt(worldIdSignalHash(s))).toBe(BigInt(hashSignal(s)));
    }
  });
});

describe("Developer Portal call", () => {
  it("sends the staging verification token only in staging, and only when configured", async () => {
    const t = setup({ env: { WORLD_STAGING_VERIFY_TOKEN: "staging-token-test" } });
    await enrollWithLink(t);
    expect(t.portal.calls[0]!.headers["x-staging-verification-token"]).toBe("staging-token-test");
    expect(t.portal.calls[0]!.body).toMatchObject({ protocol_version: "4.0", action: "soapay-recovery" }); // forwarded unchanged
    expect(JSON.stringify(t.logs)).not.toContain("staging-token-test");

    const u = setup();
    await enrollWithLink(u);
    expect(u.portal.calls[0]!.headers).not.toHaveProperty("x-staging-verification-token");

    const prod = setup({ env: { WORLD_ENV: "production", WORLD_STAGING_VERIFY_TOKEN: "staging-token-test" } });
    const nonce = await prod.rpNonce();
    const res = await prod.post("/names", {
      ...(await claimBody()),
      worldIdSession: proofResult({ nonce, signal: sessionSignal("alice", registrant.address), environment: "production" }),
    });
    expect(res.status).toBe(201);
    expect(prod.portal.calls[0]!.headers).not.toHaveProperty("x-staging-verification-token");
  });
});

describe("enrollment has no World ID gate", () => {
  it("claims a name and registers without any proof", async () => {
    const t = setup();
    expect((await t.post("/names", await claimBody())).status).toBe(201);
    const reg = await t.post("/register", { registrant: other.address, metaAddress: metaUri(4), signature: REGISTER_SIG });
    expect(reg.status).toBe(200);
    expect(t.portal.calls).toHaveLength(0);
    expect((await j(await t.app.request("/names/alice"))).worldIdSession).toBeNull();
  });

  it("verifies an optional Proof of Human proof at enrollment and links its nullifier to the name", async () => {
    const t = setup();
    const name = await enrollWithLink(t);
    expect(name.worldIdSession).toEqual({ attachedAt: NOW });
    expect(JSON.stringify(name)).not.toContain(dec(HUMAN_A)); // the nullifier is never served
    expect(JSON.stringify(name)).not.toContain(HUMAN_A.slice(2));
    expect(t.portal.calls).toHaveLength(1);
    expect(t.portal.calls[0]!.url).toBe("https://developer.world.org/api/v4/verify/rp_3ede5fe1cab9af48");
    expect(t.worldId!.linkForLabel("alice")).toMatchObject({ nullifier: dec(HUMAN_A), via: "enroll", attached_at: NOW });
  });

  it("stores nothing when the enrollment proof is invalid", async () => {
    const t = setup();
    const nonce = await t.rpNonce();
    // Signal bound to another registrant.
    const res = await t.post("/names", {
      ...(await claimBody()),
      worldIdSession: proofResult({ nonce, signal: sessionSignal("alice", other.address) }),
    });
    expect(res.status).toBe(403);
    expect((await j(res)).error.code).toBe("signal_mismatch");
    expect((await t.app.request("/names/alice")).status).toBe(404);
  });

  it("refuses session proofs (D-58: one-time requests only)", async () => {
    const t = setup();
    const nonce = await t.rpNonce();
    const res = await t.post("/names", {
      ...(await claimBody()),
      worldIdSession: { ...proofResult({ nonce, signal: sessionSignal("alice", registrant.address) }), session_id: `session_${"ab".repeat(64)}` },
    });
    expect(res.status).toBe(403);
    expect((await j(res)).error.code).toBe("proof_malformed");
    expect(t.portal.calls).toHaveLength(0);
  });

  it("lets the same human link several names", async () => {
    const t = setup();
    await enrollWithLink(t);
    const nonce = await t.rpNonce();
    const res = await t.post("/names", {
      ...(await claimBody({ signer: other, label: "bob", meta: metaUri(3) })),
      worldIdSession: proofResult({ nonce, signal: sessionSignal("bob", other.address) }),
    });
    expect(res.status).toBe(201);
    expect(t.worldId!.linkForLabel("bob")?.nullifier).toBe(dec(HUMAN_A));
  });
});

describe("POST /names/:label/session (link later)", () => {
  async function attachBody(t: T, o: { signer?: PrivateKeyAccount; nullifier?: string; label?: string; registrant?: Address } = {}) {
    const nullifier = o.nullifier ?? HUMAN_A;
    const label = o.label ?? "alice";
    const deadline = BigInt(NOW + 600);
    const signature = await (o.signer ?? registrant).signTypedData(attachWorldIdTypedData({ label, nullifier, deadline, chainId: CHAIN_ID }));
    const worldIdResult = proofResult({ nonce: await t.rpNonce(), signal: sessionSignal(label, o.registrant ?? registrant.address), nullifier });
    return { deadline: deadline.toString(), signature, worldIdResult };
  }

  it("links a verified World ID authorised by the registrant", async () => {
    const t = setup();
    expect((await t.post("/names", await claimBody())).status).toBe(201);
    const res = await t.post("/names/alice/session", await attachBody(t));
    expect(res.status).toBe(201);
    expect(await j(res)).toEqual({ label: "alice", attachedAt: NOW, rotationAllowedFrom: NOW + 259_200 });
    expect((await j(await t.app.request("/names/alice"))).worldIdSession).toEqual({ attachedAt: NOW });
    expect(t.worldId!.linkForLabel("alice")).toMatchObject({ nullifier: dec(HUMAN_A), via: "attach" });
  });

  it("refuses a bad AttachWorldId signature before calling World ID", async () => {
    const t = setup();
    await t.post("/names", await claimBody());
    const res = await t.post("/names/alice/session", await attachBody(t, { signer: other }));
    expect(res.status).toBe(401);
    expect((await j(res)).error.code).toBe("bad_signature");
    expect(t.portal.calls).toHaveLength(0);
    expect(t.worldId!.linkForLabel("alice")).toBeUndefined();
  });

  it("refuses a signature over another nullifier (someone else's World ID)", async () => {
    const t = setup();
    await t.post("/names", await claimBody());
    const body = await attachBody(t, { nullifier: HUMAN_A });
    body.worldIdResult = proofResult({ nonce: await t.rpNonce(), signal: sessionSignal("alice", registrant.address), nullifier: HUMAN_B });
    const res = await t.post("/names/alice/session", body);
    expect(res.status).toBe(401);
    expect(t.worldId!.linkForLabel("alice")).toBeUndefined();
  });

  it("never replaces an existing link, but a human may link several names", async () => {
    const t = setup();
    await enrollWithLink(t);
    const again = await t.post("/names/alice/session", await attachBody(t, { nullifier: HUMAN_B }));
    expect(again.status).toBe(409);
    expect((await j(again)).error.code).toBe("session_exists");
    expect(t.worldId!.linkForLabel("alice")?.nullifier).toBe(dec(HUMAN_A));

    expect((await t.post("/names", await claimBody({ signer: other, label: "bob", meta: metaUri(3) }))).status).toBe(201);
    const bob = await t.post("/names/bob/session", await attachBody(t, { signer: other, label: "bob", registrant: other.address }));
    expect(bob.status).toBe(201);
  });

  it("a late link backs rotations only after the cooldown", async () => {
    const t = setup();
    await t.post("/names", await claimBody());
    expect((await t.post("/names/alice/session", await attachBody(t))).status).toBe(201);
    const early = await rotate(t, await rotationBody(t));
    expect(early.status).toBe(409);
    expect((await j(early)).error.code).toBe("session_cooldown");
    t.setNow(NOW + 259_200);
    expect((await rotate(t, await rotationBody(t, { deadline: BigInt(NOW + 259_200 + 600) }))).status).toBe(201);
  });

  it("a legacy session-only row is not a link: rotation refused, linking allowed (with the cooldown)", async () => {
    const t = setup();
    await t.post("/names", await claimBody());
    t.db
      .prepare("INSERT INTO name_sessions (label, session_id, nullifier, attached_at, via) VALUES ('alice', ?, NULL, ?, 'enroll')")
      .run(`session_${"ab".repeat(64)}`, NOW - 10);
    expect((await j(await t.app.request("/names/alice"))).worldIdSession).toBeNull();
    const res = await rotate(t, await rotationBody(t));
    expect(res.status).toBe(409);
    expect((await j(res)).error.code).toBe("no_worldid_link");
    expect((await t.post("/names/alice/session", await attachBody(t))).status).toBe(201);
    expect(t.worldId!.linkForLabel("alice")).toMatchObject({ nullifier: dec(HUMAN_A), via: "attach" });
  });
});

describe("POST /names/:label/rotation", () => {
  it("attests, relays the ERC-6538 re-registration and tops up gas", async () => {
    const sent: { to: Address; value: bigint }[] = [];
    const l1Funder: L1Funder = {
      address: other.address,
      getBalance: async () => 0n,
      estimateFeesPerGas: async () => ({ maxFeePerGas: 10n }),
      sendTransaction: async (a) => {
        sent.push(a);
        return `0x${"ee".repeat(32)}` as Hash;
      },
    };
    const t = setup({ l1Funder });
    await enrollWithLink(t);
    const body = await rotationBody(t);
    const res = await rotate(t, body);
    expect(res.status).toBe(201);
    const out = await j(res);

    // The attestation verifies with viem against the exact §2.1 domain and type.
    expect(out.attester).toBe(attesterAccount.address);
    expect(out.attestation).toMatchObject({ label: "alice", oldMeta: metaUri(1), newMeta: metaUri(2), verifiedAt: String(NOW) });
    const ok = await verifyTypedData({
      address: attesterAccount.address,
      domain: { name: "Soapay Attestations", version: "1", chainId: CHAIN_ID },
      types: {
        MetaRotation: [
          { name: "label", type: "string" },
          { name: "oldMeta", type: "string" },
          { name: "newMeta", type: "string" },
          { name: "verifiedAt", type: "uint256" },
        ],
      },
      primaryType: "MetaRotation",
      message: { label: "alice", oldMeta: metaUri(1), newMeta: metaUri(2), verifiedAt: BigInt(NOW) },
      signature: out.attestation.signature,
    });
    expect(ok).toBe(true);

    // ERC-6538 re-registration for the new meta-address, from the relayer, not counted as /register.
    expect(out.registry).toMatchObject({ status: "pending" });
    const sim = t.client.simulateContract.mock.calls.at(-1)![0];
    expect(sim.functionName).toBe("registerKeysOnBehalf");
    expect(sim.args).toEqual([registrant.address, 1n, REGISTER_SIG, metaHex(2)]);
    expect(t.relayer.writeContract).toHaveBeenCalledTimes(1);
    const reg = t.db.prepare("SELECT meta_bytes, nullifier FROM registrations").all() as any[];
    expect(reg).toEqual([{ meta_bytes: metaHex(2), nullifier: null }]);

    // Gas top-up: need = 150k gas × 10 wei.
    expect(out.topup).toMatchObject({ status: "sent", value: "1500000" });
    expect(sent).toEqual([{ to: registrant.address, value: 1_500_000n }]);

    // The record and the feed follow.
    expect((await j(await t.app.request("/names/alice"))).metaAddress).toBe(metaUri(2));
    const feed = await j(await t.app.request("/names/alice/attestations"));
    expect(feed.attester).toBe(attesterAccount.address);
    expect(feed.items).toHaveLength(1);
    expect(feed.items[0].signature).toBe(out.attestation.signature);
  });

  it("is idempotent: a retry finishes the relay without a second proof", async () => {
    const t = setup();
    await enrollWithLink(t);
    const body = await rotationBody(t);
    expect((await rotate(t, body)).status).toBe(201);
    const portalCalls = t.portal.calls.length;
    const again = await rotate(t, body);
    expect(again.status).toBe(200);
    expect(await j(again)).toMatchObject({ idempotent: true, registry: { status: "success", idempotent: true } });
    expect(t.portal.calls.length).toBe(portalCalls);
    expect(t.relayer.writeContract).toHaveBeenCalledTimes(1);

    // Once the registry holds the new meta-address, the retry reports it.
    t.registry.set(registrant.address, metaHex(2));
    expect((await j(await rotate(t, body))).registry).toEqual({ status: "already_registered" });
  });

  it("lists attestations newest first", async () => {
    const t = setup();
    await enrollWithLink(t);
    expect((await rotate(t, await rotationBody(t))).status).toBe(201);
    t.setNow(NOW + 10);
    expect((await rotate(t, await rotationBody(t, { oldMeta: metaUri(2), newMeta: metaUri(5), deadline: BigInt(NOW + 900) }))).status).toBe(201);
    const items = (await j(await t.app.request("/names/alice/attestations"))).items;
    expect(items.map((i: any) => i.newMeta)).toEqual([metaUri(5), metaUri(2)]);
    expect(items[0].verifiedAt).toBe(String(NOW + 10));
  });

  describe("refusals (no attestation, the sender app falls back to manual approval)", () => {
    const expectRefused = async (t: T, res: Response, status: number, code: string) => {
      expect(res.status).toBe(status);
      expect((await j(res)).error.code).toBe(code);
      expect((await j(await t.app.request("/names/alice/attestations"))).items).toHaveLength(0);
      expect((await j(await t.app.request("/names/alice"))).metaAddress).toBe(metaUri(1));
    };

    it("a name with no World ID link", async () => {
      const t = setup();
      await t.post("/names", await claimBody());
      await expectRefused(t, await rotate(t, await rotationBody(t)), 409, "no_worldid_link");
    });

    it("a different person (another nullifier)", async () => {
      const t = setup();
      await enrollWithLink(t);
      await expectRefused(t, await rotate(t, await rotationBody(t, { nullifier: HUMAN_B })), 403, "human_mismatch");
      expect(t.portal.calls).toHaveLength(1); // refused before the portal call
    });

    it("a portal-verified nullifier that differs from the proof", async () => {
      const t = setup();
      await enrollWithLink(t);
      t.portal.setMode("other-nullifier");
      await expectRefused(t, await rotate(t, await rotationBody(t)), 403, "proof_invalid");
    });

    it("a replayed proof (its single-use nonce is spent)", async () => {
      const t = setup();
      await enrollWithLink(t);
      const first = await rotationBody(t);
      expect((await rotate(t, first)).status).toBe(201);
      // The exact same proof, for the next change: refused.
      const res = await rotate(t, await rotationBody(t, { oldMeta: metaUri(2), newMeta: metaUri(5), result: first.worldIdResult }));
      expect(res.status).toBe(403);
      expect(["request_used", "signal_mismatch"]).toContain((await j(res)).error.code);
    });

    it("a reused RP nonce", async () => {
      const t = setup();
      await enrollWithLink(t);
      const nonce = await t.rpNonce();
      expect((await rotate(t, await rotationBody(t, { nonce }))).status).toBe(201);
      const res = await rotate(t, await rotationBody(t, { nonce, oldMeta: metaUri(2), newMeta: metaUri(5) }));
      expect(res.status).toBe(403);
      expect((await j(res)).error.code).toBe("request_used");
    });

    it("the enrollment proof replayed for a rotation", async () => {
      const t = setup();
      const nonce = await t.rpNonce(rotationSignal("alice", metaUri(2), BigInt(NOW + 600)));
      const enroll = proofResult({ nonce, signal: sessionSignal("alice", registrant.address) });
      expect((await t.post("/names", { ...(await claimBody()), worldIdSession: enroll })).status).toBe(201);
      await expectRefused(t, await rotate(t, await rotationBody(t, { result: enroll })), 403, "request_used");
    });

    it("a proof for another action", async () => {
      const t = setup();
      await enrollWithLink(t);
      const deadline = BigInt(NOW + 600);
      const result = proofResult({ nonce: await t.rpNonce(), signal: rotationSignal("alice", metaUri(2), deadline), action: "soapay-enroll" });
      await expectRefused(t, await rotate(t, await rotationBody(t, { deadline, result })), 403, "action_mismatch");
      expect(t.portal.calls).toHaveLength(1);
    });

    it("an expired deadline", async () => {
      const t = setup();
      await enrollWithLink(t);
      await expectRefused(t, await rotate(t, await rotationBody(t, { deadline: BigInt(NOW) })), 400, "expired");
    });

    it("an expired World ID request", async () => {
      const t = setup();
      await enrollWithLink(t);
      const nonce = await t.rpNonce();
      t.setNow(NOW + 300 + 601);
      await expectRefused(t, await rotate(t, await rotationBody(t, { nonce, deadline: BigInt(NOW + 5000) })), 403, "request_expired");
    });

    it("a nonce this server never issued", async () => {
      const t = setup();
      await enrollWithLink(t);
      await expectRefused(t, await rotate(t, await rotationBody(t, { nonce: `0x${"77".repeat(32)}` })), 403, "unknown_request");
    });

    it("a bad registrant signature", async () => {
      const t = setup();
      await enrollWithLink(t);
      await expectRefused(t, await rotate(t, await rotationBody(t, { signer: other })), 401, "bad_signature");
    });

    it("an environment mismatch (in the result, or reported by the portal)", async () => {
      const t = setup();
      await enrollWithLink(t);
      const nonce = await t.rpNonce();
      const deadline = BigInt(NOW + 600);
      const result = proofResult({ nonce, signal: rotationSignal("alice", metaUri(2), deadline), environment: "production" });
      await expectRefused(t, await rotate(t, await rotationBody(t, { deadline, result })), 403, "environment_mismatch");
      t.portal.setMode("production");
      await expectRefused(t, await rotate(t, await rotationBody(t)), 403, "environment_mismatch");
    });

    it("a cancelled or missing proof", async () => {
      const t = setup();
      await enrollWithLink(t);
      await expectRefused(t, await rotate(t, await rotationBody(t, { result: { error: "user_rejected" } })), 403, "proof_cancelled");
      await expectRefused(t, await rotate(t, await rotationBody(t, { result: undefined })), 403, "proof_missing");
    });

    it("a proof the portal rejects, the wrong credential, and a portal outage", async () => {
      const t = setup();
      await enrollWithLink(t);
      t.portal.setMode("reject");
      await expectRefused(t, await rotate(t, await rotationBody(t)), 403, "proof_invalid");
      t.portal.setMode("ok");
      const deadline = BigInt(NOW + 600);
      const selfie = proofResult({ nonce: await t.rpNonce(), signal: rotationSignal("alice", metaUri(2), deadline), identifier: "selfie", schema: 11 });
      await expectRefused(t, await rotate(t, await rotationBody(t, { deadline, result: selfie })), 403, "wrong_credential");
      t.portal.setMode("down");
      await expectRefused(t, await rotate(t, await rotationBody(t)), 503, "worldid_unavailable");
    });

    it("a registry-rejected registerSig, without burning the proof", async () => {
      const t = setup();
      await enrollWithLink(t);
      const body = await rotationBody(t);
      t.client.simulateContract.mockRejectedValueOnce(new Error("ERC6538Registry__InvalidSignature"));
      await expectRefused(t, await rotate(t, body), 400, "registration_rejected");
      expect((await rotate(t, body)).status).toBe(201); // same proof still usable
    });

    it("rate limits per IP", async () => {
      const t = setup({ env: { RATE_LIMIT_NAMES_PER_IP: "2" } });
      await enrollWithLink(t);
      t.setIp("10.9.9.9");
      await rotate(t, await rotationBody(t, { signer: other }));
      await rotate(t, await rotationBody(t, { signer: other }));
      await expectRefused(t, await rotate(t, await rotationBody(t)), 429, "rate_limited");
    });

    it("World ID or the attester disabled", async () => {
      const t = makeTestApp({ attester: true });
      expect((await t.post("/names/alice/rotation", {})).status).toBe(503);
      const u = makeTestApp({ portalFetch: portal().fetch });
      expect((await u.post("/names/alice/rotation", {})).status).toBe(503);
    });
  });
});

describe("gas top-up", () => {
  function funder(balance: bigint, fee = 10n) {
    const sendTransaction = vi.fn(async (_a: { to: Address; value: bigint }) => `0x${"aa".repeat(32)}` as Hash);
    return { address: other.address, getBalance: async () => balance, estimateFeesPerGas: async () => ({ maxFeePerGas: fee }), sendTransaction };
  }
  const who = getAddress(registrant.address);

  it("sends only the shortfall, capped at TOPUP_CAP_WEI", async () => {
    const t = makeTestApp({ env: { TOPUP_CAP_WEI: "1000000" } });
    const f = funder(400_000n);
    expect(await topUpRegistrant({ ...t.deps, config: t.config, l1Funder: f } as any, who)).toMatchObject({ status: "sent", value: "1000000" });
    const g = funder(1_000_000n);
    expect(await topUpRegistrant({ ...t.deps, config: t.config, l1Funder: g } as any, who)).toMatchObject({ status: "sent", value: "500000" });
  });

  it("skips a funded registrant, and when not configured", async () => {
    const t = makeTestApp();
    const f = funder(10n ** 18n);
    expect(await topUpRegistrant({ ...t.deps, config: t.config, l1Funder: f } as any, who)).toEqual({ status: "skipped", reason: "sufficient_balance" });
    expect(f.sendTransaction).not.toHaveBeenCalled();
    expect(await topUpRegistrant({ ...t.deps, config: t.config, l1Funder: undefined } as any, who)).toEqual({ status: "skipped", reason: "not_configured" });
  });

  it("rate-limits per registrant and globally per day", async () => {
    const t = makeTestApp({ env: { TOPUP_PER_REGISTRANT_PER_DAY: "1", TOPUP_PER_DAY: "2" } });
    const f = funder(0n);
    const d = { ...t.deps, config: t.config, l1Funder: f } as any;
    expect((await topUpRegistrant(d, who)).status).toBe("sent");
    expect(await topUpRegistrant(d, who)).toEqual({ status: "skipped", reason: "rate_limited" });
    expect((await topUpRegistrant(d, getAddress(other.address))).status).toBe("sent");
    expect(await topUpRegistrant(d, getAddress(attesterAccount.address))).toEqual({ status: "skipped", reason: "rate_limited" });
    expect(f.sendTransaction).toHaveBeenCalledTimes(2);
  });

  it("never throws when the send fails", async () => {
    const t = makeTestApp();
    const f = { ...funder(0n), sendTransaction: async () => Promise.reject(new Error("nonce too low")) };
    expect(await topUpRegistrant({ ...t.deps, config: t.config, l1Funder: f } as any, who)).toEqual({ status: "failed", reason: "top-up transaction failed" });
  });
});

describe("proofs without a signal hash (bound through the request instead, D-57)", () => {
  it("accepts a proof whose single-use request was bound to this exact signal", async () => {
    const t = setup();
    const nonce = await t.rpNonce(sessionSignal("alice", registrant.address));
    const res = await t.post("/names", { ...(await claimBody()), worldIdSession: proofResult({ nonce, signal: "" }) });
    expect(res.status).toBe(201);
  });

  it("refuses one bound to a different signal, or not bound at all", async () => {
    const t = setup();
    const other = await t.rpNonce(sessionSignal("mallory", registrant.address));
    const a = await t.post("/names", { ...(await claimBody()), worldIdSession: proofResult({ nonce: other, signal: "" }) });
    expect(a.status).toBe(403);
    expect((await j(a)).error.code).toBe("signal_mismatch");
    const unbound = await t.rpNonce();
    const b = await t.post("/names", { ...(await claimBody()), worldIdSession: proofResult({ nonce: unbound, signal: "" }) });
    expect(b.status).toBe(403);
    expect((await j(b)).error.code).toBe("signal_mismatch");
  });
});

describe("link then rotate: same human accepted, another human refused", () => {
  it("rotates twice with the same nullifier and refuses another person in between", async () => {
    const t = setup();
    await enrollWithLink(t);
    expect((await rotate(t, await rotationBody(t))).status).toBe(201);
    const mallory = await rotate(t, await rotationBody(t, { oldMeta: metaUri(2), newMeta: metaUri(5), nullifier: HUMAN_B }));
    expect(mallory.status).toBe(403);
    expect((await j(mallory)).error.code).toBe("human_mismatch");
    t.setNow(NOW + 5);
    expect((await rotate(t, await rotationBody(t, { oldMeta: metaUri(2), newMeta: metaUri(5), deadline: BigInt(NOW + 900) }))).status).toBe(201);
    const rows = t.db.prepare("SELECT session_nullifier FROM attestations").all() as { session_nullifier: string }[];
    expect(new Set(rows.map((r) => r.session_nullifier)).size).toBe(2); // one spent request nonce per proof
  });
});
