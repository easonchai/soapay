import { describe, expect, it, vi } from "vitest";
import type { Hex, PrivateKeyAccount } from "viem";
import { loadConfig } from "../src/config.js";
import { NoopNameIssuer } from "../src/hooks.js";
import { ensV2NameIssuer, makeNameIssuer } from "../src/issuer.js";
import { nameClaimTypedData } from "@soapay/sdk";
import { j, makeTestApp, metaHex, metaUri, NOW, other, registrant } from "./helpers.js";

const SIG = `0x${"ab".repeat(65)}`;

async function claim(opts: { signer?: PrivateKeyAccount; meta?: string; deadline?: bigint } = {}) {
  const signer = opts.signer ?? registrant;
  const msg = {
    label: "alice",
    registrant: signer.address,
    metaAddress: opts.meta ?? metaUri(),
    deadline: opts.deadline ?? BigInt(NOW + 600),
  };
  const signature = await signer.signTypedData(nameClaimTypedData({ ...msg, chainId: 84532 }));
  return { ...msg, deadline: msg.deadline.toString(), signature };
}

function onChain(t: ReturnType<typeof makeTestApp>, map: Record<string, string>) {
  t.client.readContract.mockImplementation(async (a: any) => map[a.args[0]] ?? "0x");
}

describe("NameIssuer", () => {
  it("receives the claim and its txHash is stored", async () => {
    const issue = vi.fn(async (_a: any) => ({ txHash: "0xissued" }));
    const t = makeTestApp({ nameIssuer: { issue } });
    onChain(t, { [registrant.address]: metaHex() });
    const res = await t.post("/names", await claim());
    expect(res.status).toBe(201);
    expect(issue).toHaveBeenCalledWith({ label: "alice", registrant: registrant.address, metaAddress: metaUri() });
    expect((await j(res)).txHash).toBe("0xissued");
  });

  it("stores nothing when issuance fails", async () => {
    const t = makeTestApp({ nameIssuer: { issue: () => Promise.reject(new Error("rpc down")) } });
    onChain(t, { [registrant.address]: metaHex() });
    expect((await t.post("/names", await claim())).status).toBe(502);
    expect((await t.app.request("/names/alice")).status).toBe(404);
  });

  it("issues a raced label only once", async () => {
    const issue = vi.fn(async (_a: any) => ({}));
    const t = makeTestApp({ nameIssuer: { issue } });
    onChain(t, { [registrant.address]: metaHex(), [other.address]: metaHex(2) });
    const [a, b] = await Promise.all([
      t.post("/names", await claim()),
      t.post("/names", await claim({ signer: other, meta: metaUri(2) })),
    ]);
    expect([a.status, b.status].sort()).toEqual([201, 409]);
    expect(issue).toHaveBeenCalledTimes(1);
  });
});

describe("ENSv2 NameIssuer wiring", () => {
  it("issues once through the SDK issuer (retries don't re-issue) and never writes stealth on updates", async () => {
    const inner = { issue: vi.fn(async (a: any) => ({ txHash: "0xens" as Hex, name: `${a.label}.soapay.eth`, resolver: other.address, registry: other.address })) };
    const issuer = ensV2NameIssuer(inner as any);
    expect(issuer.updateMeta).toBeUndefined();
    const t = makeTestApp({ nameIssuer: issuer });
    onChain(t, { [registrant.address]: metaHex() });
    const body = await claim();
    const res = await t.post("/names", body);
    expect(res.status).toBe(201);
    expect((await j(res)).txHash).toBe("0xens");
    expect((await t.post("/names", body)).status).toBe(200); // idempotent retry
    expect(inner.issue).toHaveBeenCalledTimes(1);
    expect(inner.issue).toHaveBeenCalledWith({ label: "alice", registrant: registrant.address, metaAddress: metaUri() });

    // A meta change through POST /names stores the claim; the registrant writes setText itself.
    onChain(t, { [registrant.address]: metaHex(2) });
    expect((await t.post("/names", await claim({ meta: metaUri(2), deadline: BigInt(NOW + 900) }))).status).toBe(200);
    expect(inner.issue).toHaveBeenCalledTimes(1);
  });

  it("returns 502 and stores nothing when the ENSv2 issuer fails", async () => {
    const t = makeTestApp({ nameIssuer: ensV2NameIssuer({ issue: () => Promise.reject(new Error("execution reverted")) } as any) });
    onChain(t, { [registrant.address]: metaHex() });
    const res = await t.post("/names", await claim());
    expect(res.status).toBe(502);
    expect((await j(res)).error.code).toBe("issue_failed");
    expect(t.db.prepare("SELECT COUNT(*) AS n FROM names").get()).toEqual({ n: 0 });
    expect(t.db.prepare("SELECT COUNT(*) AS n FROM name_history").get()).toEqual({ n: 0 });
  });

  it("uses the no-op issuer, with a warning, unless ISSUER_PRIVATE_KEY and L1_RPC_URL are set", () => {
    const warn = vi.fn();
    const logger = { info: vi.fn(), warn, error: vi.fn() };
    const base = { RPC_URL: "https://sepolia.base.org" };
    expect(makeNameIssuer(loadConfig(base), logger)).toBeInstanceOf(NoopNameIssuer);
    expect(makeNameIssuer(loadConfig({ ...base, ISSUER_PRIVATE_KEY: `0x${"77".repeat(32)}` }), logger)).toBeInstanceOf(NoopNameIssuer);
    expect(warn).toHaveBeenCalledTimes(2);
    const real = makeNameIssuer(
      loadConfig({ ...base, ISSUER_PRIVATE_KEY: `0x${"77".repeat(32)}`, L1_RPC_URL: "http://127.0.0.1:1", ENS_SUBNAME_REGISTRY: other.address }),
      logger,
    );
    expect(real).not.toBeInstanceOf(NoopNameIssuer);
    expect(real.updateMeta).toBeUndefined();
  });
});

describe("HumanVerifier", () => {
  it("is asked with action name / update-meta, gets the proof, and its nullifier is stored", async () => {
    const verify = vi.fn(async (_a: any) => ({ ok: true as const, nullifier: "0xnull" }));
    const updateMeta = vi.fn(async (_a: any) => ({ txHash: "0xupd" }));
    const t = makeTestApp({ humanVerifier: { verify }, nameIssuer: { issue: async () => ({}), updateMeta } });
    onChain(t, { [registrant.address]: metaHex() });
    expect((await t.post("/names", { ...(await claim()), proof: { p: 1 } })).status).toBe(201);
    expect(verify).toHaveBeenLastCalledWith({
      action: "name",
      registrant: registrant.address,
      proof: { p: 1 },
      label: "alice",
      metaAddress: metaUri(),
      deadline: BigInt(NOW + 600),
    });
    expect((t.db.prepare("SELECT nullifier FROM names").get() as any).nullifier).toBe("0xnull");

    onChain(t, { [registrant.address]: metaHex(2) });
    const up = await t.post("/names", await claim({ meta: metaUri(2), deadline: BigInt(NOW + 900) }));
    expect(up.status).toBe(200);
    expect(verify.mock.calls[1]![0].action).toBe("update-meta");
    expect(updateMeta).toHaveBeenCalledWith({ label: "alice", registrant: registrant.address, metaAddress: metaUri(2) });
    expect((await j(up)).txHash).toBe("0xupd");
  });

  it("blocks a name claim when it refuses", async () => {
    const t = makeTestApp({ humanVerifier: { verify: async () => ({ ok: false, reason: "not a human" }) } });
    onChain(t, { [registrant.address]: metaHex() });
    const res = await t.post("/names", await claim());
    expect(res.status).toBe(403);
    expect(await j(res)).toEqual({ error: { code: "human_verification_failed", message: "not a human" } });
    expect((await t.app.request("/names/alice")).status).toBe(404);
  });

  it("blocks /register before anything is sent", async () => {
    const t = makeTestApp({ humanVerifier: { verify: async () => ({ ok: false, reason: "no proof" }) } });
    const res = await t.post("/register", { registrant: registrant.address, metaAddress: metaUri(), signature: SIG });
    expect(res.status).toBe(403);
    expect(t.relayer.writeContract).not.toHaveBeenCalled();
  });

  it("gets the /register proof and its nullifier is stored", async () => {
    const verify = vi.fn(async (_a: any) => ({ ok: true as const, nullifier: "n-1" }));
    const t = makeTestApp({ humanVerifier: { verify } });
    const res = await t.post("/register", { registrant: registrant.address, metaAddress: metaUri(), signature: SIG, proof: "p" });
    expect(res.status).toBe(200);
    expect(verify).toHaveBeenCalledWith({ action: "register", registrant: registrant.address, proof: "p" });
    expect((t.db.prepare("SELECT nullifier FROM registrations").get() as any).nullifier).toBe("n-1");
  });
});
