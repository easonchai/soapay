import { describe, expect, it, vi } from "vitest";
import { getAddress, verifyTypedData, type Address, type Hash, type Hex, type PrivateKeyAccount } from "viem";
import { attachSessionTypedData, nameClaimTypedData, rotationClaimTypedData, rotationSignal, sessionSignal, worldIdSignalHash } from "@soapay/sdk";
import { hashSignal } from "@worldcoin/idkit-core/hashing";
import type { Fetch } from "../src/worldid/portal.js";
import { topUpRegistrant, type L1Funder } from "../src/topup.js";
import { attesterAccount, j, makeTestApp, metaHex, metaUri, NOW, other, registrant, TEST_WORLD_APP_ID, TEST_WORLD_RP_ID } from "./helpers.js";
import { migrate, openDb } from "../src/db.js";

const CHAIN_ID = 84532;
const SESSION_A = `session_${"ab".repeat(64)}`;
const SESSION_B = `session_${"cd".repeat(64)}`;
const REGISTER_SIG = `0x${"12".repeat(65)}` as Hex;

// ---------------------------------------------------------------------------
// Mocked Developer Portal: POST /api/v4/verify/{rp_id}

type PortalMode = "ok" | "reject" | "production" | "down";

function portal() {
  let mode: PortalMode = "ok";
  const calls: { url: string; body: any; headers: Record<string, string> }[] = [];
  const fetch: Fetch = async (url, init) => {
    const body = JSON.parse(String(init?.body));
    calls.push({ url, body, headers: { ...(init?.headers as Record<string, string>) } });
    if (mode === "down") throw new Error("ECONNREFUSED");
    if (mode === "reject") return Response.json({ success: false, code: "invalid_proof", detail: "bad" }, { status: 400 });
    return Response.json({
      success: true,
      environment: mode === "production" ? "production" : body.environment,
      session_id: body.session_id,
      results: [{ identifier: "proof_of_human", success: true }],
    });
  };
  return { fetch, calls, setMode: (m: PortalMode) => (mode = m) };
}

let nullifierCounter = 1n;

/** An IDKit 4.3 session result (IDKitResultSession) for a Proof of Human credential. */
function sessionResult(o: {
  nonce: string;
  signal: string;
  sessionId?: string;
  environment?: string;
  identifier?: string;
  schema?: number;
  sessionNullifier?: string;
}) {
  return {
    protocol_version: "4.0",
    nonce: o.nonce,
    session_id: o.sessionId ?? SESSION_A,
    environment: o.environment ?? "staging",
    responses: [
      {
        identifier: o.identifier ?? "proof_of_human",
        issuer_schema_id: o.schema ?? 1,
        signal_hash: o.signal === "" ? "0x0" : worldIdSignalHash(o.signal),
        session_nullifier: [o.sessionNullifier ?? `0x${(nullifierCounter++).toString(16).padStart(64, "0")}`, "0x01"],
        proof: ["0x1", "0x2", "0x3", "0x4", "0x5"],
        expires_at_min: NOW + 86_400,
        sybil_score: 1,
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

/** Claims `alice` with a Proof of Human session created at enrollment. */
async function enrollWithSession(t: T, sessionId = SESSION_A) {
  const nonce = await t.rpNonce();
  const res = await t.post("/names", {
    ...(await claimBody()),
    worldIdSession: sessionResult({ nonce, signal: sessionSignal("alice", registrant.address), sessionId }),
  });
  expect(res.status).toBe(201);
  return j(res);
}

async function rotationBody(
  t: T,
  o: { newMeta?: string; oldMeta?: string; deadline?: bigint; signer?: PrivateKeyAccount; result?: unknown; sessionId?: string; nonce?: string } = {},
) {
  const newMeta = o.newMeta ?? metaUri(2);
  const deadline = o.deadline ?? BigInt(NOW + 600);
  const registrantSig = await (o.signer ?? registrant).signTypedData(
    rotationClaimTypedData({ label: "alice", oldMeta: o.oldMeta ?? metaUri(1), newMeta, deadline, chainId: CHAIN_ID }),
  );
  const result =
    "result" in o
      ? o.result
      : sessionResult({
          nonce: o.nonce ?? (await t.rpNonce()),
          signal: rotationSignal("alice", newMeta, deadline),
          ...(o.sessionId ? { sessionId: o.sessionId } : {}),
        });
  return { newMeta, deadline: deadline.toString(), registrantSig, registerSig: REGISTER_SIG, worldIdResult: result };
}

const rotate = (t: T, body: unknown) => t.post("/names/alice/rotation", body);

async function expectCode(res: Promise<Response> | Response, status: number, code: string) {
  const r = await res;
  expect(r.status).toBe(status);
  expect((await j(r)).error.code).toBe(code);
}

// ---------------------------------------------------------------------------

describe("World ID config and RP context", () => {
  it("serves public parameters only, with the app and RP ids from the environment", async () => {
    const t = setup({ env: { WORLD_STAGING_VERIFY_TOKEN: "staging-token-test" } });
    const cfg = await j(await t.app.request("/worldid/config"));
    expect(cfg).toEqual({
      enabled: true,
      app_id: TEST_WORLD_APP_ID,
      rp_id: TEST_WORLD_RP_ID,
      environment: "staging",
      credential: "proof_of_human",
      attach_cooldown_seconds: 259_200,
      attester: attesterAccount.address,
    });
    expect(JSON.stringify(cfg)).not.toMatch(/5555|staging-token-test/);
  });

  it("signs a session RP context without an action, stores the bind, and refuses uniqueness requests", async () => {
    const t = setup();
    const res = await j(await t.post("/worldid/rp-context", { kind: "session", bind: "soapay:test" }));
    expect(res.kind).toBe("session");
    expect(res.app_id).toBe(TEST_WORLD_APP_ID);
    expect(res.rp_context.rp_id).toBe(TEST_WORLD_RP_ID);
    const row = t.db.prepare("SELECT kind, bind FROM worldid_requests WHERE nonce = ?").get(res.rp_context.nonce.toLowerCase()) as any;
    expect(row).toEqual({ kind: "session", bind: "soapay:test" });
    expect(res.rp_context.nonce).toMatch(/^0x[0-9a-f]+$/i);
    expect(res.rp_context.expires_at - res.rp_context.created_at).toBe(300);
    expect(res).not.toHaveProperty("action");
    expect((await t.post("/worldid/rp-context", { kind: "uniqueness" })).status).toBe(400);
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

describe("enrollment has no World ID gate", () => {
  it("claims a name and registers without any proof", async () => {
    const t = setup();
    expect((await t.post("/names", await claimBody())).status).toBe(201);
    const reg = await t.post("/register", { registrant: other.address, metaAddress: metaUri(4), signature: REGISTER_SIG });
    expect(reg.status).toBe(200);
    expect(t.portal.calls).toHaveLength(0);
    expect((await j(await t.app.request("/names/alice"))).worldIdSession).toBeNull();
  });

  it("verifies an optional Proof of Human session at enrollment and binds it to the name", async () => {
    const t = setup();
    const name = await enrollWithSession(t);
    expect(name.worldIdSession).toEqual({ attachedAt: NOW });
    expect(JSON.stringify(name)).not.toContain(SESSION_A); // the session id is never served
    expect(t.portal.calls).toHaveLength(1);
    expect(t.portal.calls[0]!.url).toBe(`https://developer.world.org/api/v4/verify/${TEST_WORLD_RP_ID}`);
    expect(t.portal.calls[0]!.body.session_id).toBe(SESSION_A);
    expect(t.worldId!.sessionForLabel("alice")?.session_id).toBe(SESSION_A);
  });

  it("stores nothing when the enrollment session is invalid", async () => {
    const t = setup();
    const nonce = await t.rpNonce();
    // Signal bound to another registrant.
    const res = await t.post("/names", {
      ...(await claimBody()),
      worldIdSession: sessionResult({ nonce, signal: sessionSignal("alice", other.address) }),
    });
    expect(res.status).toBe(403);
    expect((await j(res)).error.code).toBe("signal_mismatch");
    expect((await t.app.request("/names/alice")).status).toBe(404);
  });
});

describe("POST /names/:label/session (attach later)", () => {
  async function attachBody(t: T, o: { signer?: PrivateKeyAccount; sessionId?: string } = {}) {
    const sessionId = o.sessionId ?? SESSION_A;
    const deadline = BigInt(NOW + 600);
    const signature = await (o.signer ?? registrant).signTypedData(
      attachSessionTypedData({ label: "alice", sessionId, deadline, chainId: CHAIN_ID }),
    );
    const worldIdResult = sessionResult({ nonce: await t.rpNonce(), signal: sessionSignal("alice", registrant.address), sessionId });
    return { deadline: deadline.toString(), signature, worldIdResult };
  }

  it("attaches a verified session authorised by the registrant", async () => {
    const t = setup();
    expect((await t.post("/names", await claimBody())).status).toBe(201);
    const res = await t.post("/names/alice/session", await attachBody(t));
    expect(res.status).toBe(201);
    expect(await j(res)).toMatchObject({ label: "alice", sessionId: SESSION_A, attachedAt: NOW, rotationAllowedFrom: NOW + 259_200 });
    expect((await j(await t.app.request("/names/alice"))).worldIdSession).toEqual({ attachedAt: NOW });
  });

  it("refuses a bad AttachSession signature before calling World ID", async () => {
    const t = setup();
    await t.post("/names", await claimBody());
    const res = await t.post("/names/alice/session", await attachBody(t, { signer: other }));
    expect(res.status).toBe(401);
    expect((await j(res)).error.code).toBe("bad_signature");
    expect(t.portal.calls).toHaveLength(0);
    expect(t.worldId!.sessionForLabel("alice")).toBeUndefined();
  });

  it("never replaces an existing session, but one session may back several names", async () => {
    const t = setup();
    await enrollWithSession(t);
    const again = await t.post("/names/alice/session", await attachBody(t, { sessionId: SESSION_B }));
    expect(again.status).toBe(409);
    expect((await j(again)).error.code).toBe("session_exists");

    // The same person (same session) links a second demo name.
    expect((await t.post("/names", await claimBody({ signer: other, label: "bob", meta: metaUri(3) }))).status).toBe(201);
    const deadline = BigInt(NOW + 600);
    const signature = await other.signTypedData(attachSessionTypedData({ label: "bob", sessionId: SESSION_A, deadline, chainId: CHAIN_ID }));
    const res = await t.post("/names/bob/session", {
      deadline: deadline.toString(),
      signature,
      worldIdResult: sessionResult({ nonce: await t.rpNonce(), signal: sessionSignal("bob", other.address) }),
    });
    expect(res.status).toBe(201);
    expect(t.worldId!.sessionForLabel("bob")?.session_id).toBe(SESSION_A);
    expect(t.worldId!.sessionForLabel("alice")?.session_id).toBe(SESSION_A);
  });

  it("treats a D-58 nullifier-only link as unlinked, and replaces it with a session", async () => {
    const t = setup();
    expect((await t.post("/names", await claimBody())).status).toBe(201);
    t.db.prepare("INSERT INTO name_sessions (label, session_id, nullifier, attached_at, via) VALUES ('alice', NULL, '123', ?, 'enroll')").run(NOW);
    expect(t.worldId!.sessionForLabel("alice")).toBeUndefined();
    expect((await j(await t.app.request("/names/alice"))).worldIdSession).toBeNull();
    await expectCode(rotate(t, await rotationBody(t)), 409, "no_session");
    const res = await t.post("/names/alice/session", await attachBody(t));
    expect(res.status).toBe(201);
    expect(t.db.prepare("SELECT session_id, nullifier, via FROM name_sessions WHERE label = 'alice'").get()).toEqual({
      session_id: SESSION_A,
      nullifier: null,
      via: "attach",
    });
  });

  it("a late-attached session backs rotations only after the cooldown", async () => {
    const t = setup();
    await t.post("/names", await claimBody());
    expect((await t.post("/names/alice/session", await attachBody(t))).status).toBe(201);
    const early = await rotate(t, await rotationBody(t));
    expect(early.status).toBe(409);
    expect((await j(early)).error.code).toBe("session_cooldown");
    t.setNow(NOW + 259_200);
    expect((await rotate(t, await rotationBody(t, { deadline: BigInt(NOW + 259_200 + 600) }))).status).toBe(201);
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
    await enrollWithSession(t);
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
    await enrollWithSession(t);
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
    await enrollWithSession(t);
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

    it("a name with no session", async () => {
      const t = setup();
      await t.post("/names", await claimBody());
      await expectRefused(t, await rotate(t, await rotationBody(t)), 409, "no_session");
    });

    it("a different person (session mismatch)", async () => {
      const t = setup();
      await enrollWithSession(t);
      await expectRefused(t, await rotate(t, await rotationBody(t, { sessionId: SESSION_B })), 403, "session_mismatch");
      expect(t.portal.calls).toHaveLength(1); // refused before the portal call
    });

    it("a replayed session_nullifier", async () => {
      const t = setup();
      await enrollWithSession(t);
      const first = await rotationBody(t);
      expect((await rotate(t, first)).status).toBe(201);
      const replay = first.worldIdResult as any;
      const deadline = BigInt(NOW + 700);
      const body = await rotationBody(t, {
        oldMeta: metaUri(2),
        newMeta: metaUri(5),
        deadline,
        result: {
          ...replay,
          nonce: await t.rpNonce(),
          responses: [{ ...replay.responses[0], signal_hash: worldIdSignalHash(rotationSignal("alice", metaUri(5), deadline)) }],
        },
      });
      const res = await rotate(t, body);
      expect(res.status).toBe(403);
      expect((await j(res)).error.code).toBe("session_replayed");
    });

    it("a reused RP nonce", async () => {
      const t = setup();
      await enrollWithSession(t);
      const nonce = await t.rpNonce();
      expect((await rotate(t, await rotationBody(t, { nonce }))).status).toBe(201);
      const res = await rotate(t, await rotationBody(t, { nonce, oldMeta: metaUri(2), newMeta: metaUri(5) }));
      expect(res.status).toBe(403);
      expect((await j(res)).error.code).toBe("request_used");
    });

    it("an expired deadline", async () => {
      const t = setup();
      await enrollWithSession(t);
      await expectRefused(t, await rotate(t, await rotationBody(t, { deadline: BigInt(NOW) })), 400, "expired");
    });

    it("an expired World ID request", async () => {
      const t = setup();
      await enrollWithSession(t);
      const nonce = await t.rpNonce();
      t.setNow(NOW + 300 + 601);
      await expectRefused(t, await rotate(t, await rotationBody(t, { nonce, deadline: BigInt(NOW + 5000) })), 403, "request_expired");
    });

    it("a bad registrant signature", async () => {
      const t = setup();
      await enrollWithSession(t);
      await expectRefused(t, await rotate(t, await rotationBody(t, { signer: other })), 401, "bad_signature");
    });

    it("an environment mismatch (in the result, or reported by the portal)", async () => {
      const t = setup();
      await enrollWithSession(t);
      const nonce = await t.rpNonce();
      const deadline = BigInt(NOW + 600);
      const result = sessionResult({ nonce, signal: rotationSignal("alice", metaUri(2), deadline), environment: "production" });
      await expectRefused(t, await rotate(t, await rotationBody(t, { deadline, result })), 403, "environment_mismatch");
      t.portal.setMode("production");
      await expectRefused(t, await rotate(t, await rotationBody(t)), 403, "environment_mismatch");
    });

    it("a cancelled or missing proof", async () => {
      const t = setup();
      await enrollWithSession(t);
      await expectRefused(t, await rotate(t, await rotationBody(t, { result: { error: "user_rejected" } })), 403, "proof_cancelled");
      await expectRefused(t, await rotate(t, await rotationBody(t, { result: undefined })), 403, "proof_missing");
    });

    it("a proof the portal rejects, the wrong credential, and a portal outage", async () => {
      const t = setup();
      await enrollWithSession(t);
      t.portal.setMode("reject");
      await expectRefused(t, await rotate(t, await rotationBody(t)), 403, "proof_invalid");
      t.portal.setMode("ok");
      const deadline = BigInt(NOW + 600);
      const selfie = sessionResult({ nonce: await t.rpNonce(), signal: rotationSignal("alice", metaUri(2), deadline), identifier: "selfie", schema: 11 });
      await expectRefused(t, await rotate(t, await rotationBody(t, { deadline, result: selfie })), 403, "wrong_credential");
      t.portal.setMode("down");
      await expectRefused(t, await rotate(t, await rotationBody(t)), 503, "worldid_unavailable");
    });

    it("a registry-rejected registerSig, without burning the proof", async () => {
      const t = setup();
      await enrollWithSession(t);
      const body = await rotationBody(t);
      t.client.simulateContract.mockRejectedValueOnce(new Error("ERC6538Registry__InvalidSignature"));
      await expectRefused(t, await rotate(t, body), 400, "registration_rejected");
      expect((await rotate(t, body)).status).toBe(201); // same proof still usable
    });

    it("rate limits per IP", async () => {
      const t = setup({ env: { RATE_LIMIT_NAMES_PER_IP: "2" } });
      await enrollWithSession(t);
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

describe("session proofs without a signal (World App runs sessions without one)", () => {
  it("accepts a proof whose single-use request was bound to this exact signal", async () => {
    const t = setup();
    const nonce = await t.rpNonce(sessionSignal("alice", registrant.address));
    const res = await t.post("/names", { ...(await claimBody()), worldIdSession: sessionResult({ nonce, signal: "" }) });
    expect(res.status).toBe(201);
  });

  it("refuses one bound to a different signal, or not bound at all", async () => {
    const t = setup();
    const other = await t.rpNonce(sessionSignal("mallory", registrant.address));
    const a = await t.post("/names", { ...(await claimBody()), worldIdSession: sessionResult({ nonce: other, signal: "" }) });
    expect(a.status).toBe(403);
    expect((await j(a)).error.code).toBe("signal_mismatch");
    const unbound = await t.rpNonce();
    const b = await t.post("/names", { ...(await claimBody()), worldIdSession: sessionResult({ nonce: unbound, signal: "" }) });
    expect(b.status).toBe(403);
    expect((await j(b)).error.code).toBe("signal_mismatch");
  });
});

describe("Developer Portal call", () => {
  it("forwards the result unchanged, with the staging token only in staging and only when configured", async () => {
    const t = setup({ env: { WORLD_STAGING_VERIFY_TOKEN: "staging-token-test" } });
    await enrollWithSession(t);
    expect(t.portal.calls[0]!.headers["x-staging-verification-token"]).toBe("staging-token-test");
    expect(t.portal.calls[0]!.body).toMatchObject({ protocol_version: "4.0", session_id: SESSION_A });
    expect(t.portal.calls[0]!.body).not.toHaveProperty("action");
    expect(JSON.stringify(t.logs)).not.toContain("staging-token-test");

    const u = setup();
    await enrollWithSession(u);
    expect(u.portal.calls[0]!.headers).not.toHaveProperty("x-staging-verification-token");

    const prod = setup({ env: { WORLD_ENV: "production", WORLD_STAGING_VERIFY_TOKEN: "staging-token-test" } });
    const nonce = await prod.rpNonce();
    const res = await prod.post("/names", {
      ...(await claimBody()),
      worldIdSession: sessionResult({ nonce, signal: sessionSignal("alice", registrant.address), environment: "production" }),
    });
    expect(res.status).toBe(201);
    expect(prod.portal.calls[0]!.headers).not.toHaveProperty("x-staging-verification-token");
  });
});

describe("migrations", () => {
  it("keep the D-58 nullifier column and index name_sessions by session id (append-only)", () => {
    const db = openDb(":memory:");
    migrate(db);
    const cols = (db.prepare("PRAGMA table_info(name_sessions)").all() as { name: string; notnull: number }[]).map((c) => [c.name, c.notnull]);
    expect(cols).toEqual([
      ["label", 0],
      ["session_id", 0],
      ["nullifier", 0],
      ["attached_at", 1],
      ["via", 1],
    ]);
    const idx = (db.prepare("PRAGMA index_list(name_sessions)").all() as { name: string }[]).map((i) => i.name);
    expect(idx).toEqual(expect.arrayContaining(["name_sessions_nullifier", "name_sessions_session"]));
  });
});
