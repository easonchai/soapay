import { describe, expect, it } from "vitest";
import type { PrivateKeyAccount } from "viem";
import { REGISTRY_ADDRESS } from "@soapay/sdk";
import { nameClaimTypedData } from "@soapay/sdk";
import { makeTestApp, metaHex, metaUri, NOW, other, registrant, j } from "./helpers.js";

async function claim(
  opts: { label?: string; signer?: PrivateKeyAccount; as?: PrivateKeyAccount; meta?: string; deadline?: bigint } = {},
) {
  const signer = opts.signer ?? registrant;
  const msg = {
    label: opts.label ?? "alice",
    registrant: (opts.as ?? signer).address,
    metaAddress: opts.meta ?? metaUri(),
    deadline: opts.deadline ?? BigInt(NOW + 600),
  };
  const signature = await signer.signTypedData(nameClaimTypedData({ ...msg, chainId: 84532 }));
  return { ...msg, deadline: msg.deadline.toString(), signature };
}

function onChain(t: ReturnType<typeof makeTestApp>, map: Record<string, string>) {
  t.client.readContract.mockImplementation(async (a: any) => {
    expect(a.address).toBe(REGISTRY_ADDRESS);
    expect(a.functionName).toBe("stealthMetaAddressOf");
    expect(a.args[1]).toBe(1n);
    return map[a.args[0]] ?? "0x";
  });
}

describe("POST /names", () => {
  it("claims a free label and serves it on GET /names/:label", async () => {
    const t = makeTestApp();
    onChain(t, { [registrant.address]: metaHex() });
    const res = await t.post("/names", await claim());
    expect(res.status).toBe(201);
    const body = await j(res);
    expect(body).toMatchObject({ label: "alice", name: "alice.soapay.eth", registrant: registrant.address, metaAddress: metaUri() });

    const got = await t.app.request("/names/alice");
    expect(got.status).toBe(200);
    expect(await j(got)).toMatchObject({ label: "alice", metaAddress: metaUri(), deadline: String(NOW + 600) });
    expect((await t.app.request("/names/bobby")).status).toBe(404);
  });

  it("rejects a signature from someone else", async () => {
    const t = makeTestApp();
    onChain(t, { [registrant.address]: metaHex() });
    const res = await t.post("/names", await claim({ signer: other, as: registrant }));
    expect(res.status).toBe(401);
    expect((await j(res)).error.code).toBe("bad_signature");
  });

  it("rejects a tampered claim", async () => {
    const t = makeTestApp();
    onChain(t, { [registrant.address]: metaHex() });
    const c = await claim();
    const res = await t.post("/names", { ...c, label: "mallory" });
    expect(res.status).toBe(401);
  });

  it("rejects an expired deadline", async () => {
    const t = makeTestApp();
    onChain(t, { [registrant.address]: metaHex() });
    const res = await t.post("/names", await claim({ deadline: BigInt(NOW) }));
    expect(res.status).toBe(400);
    expect((await j(res)).error.code).toBe("expired");
  });

  it("rejects a meta-address that doesn't match the registry", async () => {
    const t = makeTestApp();
    onChain(t, { [registrant.address]: metaHex(2) });
    const res = await t.post("/names", await claim());
    expect(res.status).toBe(409);
    expect((await j(res)).error.code).toBe("meta_mismatch");
  });

  it("rejects a label taken by another registrant", async () => {
    const t = makeTestApp();
    onChain(t, { [registrant.address]: metaHex(), [other.address]: metaHex(2) });
    expect((await t.post("/names", await claim())).status).toBe(201);
    const res = await t.post("/names", await claim({ signer: other, meta: metaUri(2) }));
    expect(res.status).toBe(409);
    expect((await j(res)).error.code).toBe("label_taken");
  });

  it.each(["ab", "-alice", "alice-", "Alice", "al_ce", "a".repeat(33), "alice.bob", "ab--c"])("rejects invalid label %j", async (label) => {
    const t = makeTestApp();
    const res = await t.post("/names", { ...(await claim()), label });
    expect(res.status).toBe(400);
    expect((await j(res)).error.code).toBe("invalid_label");
  });

  it("accepts a non-canonical URI and stores the canonical st:eth form", async () => {
    const t = makeTestApp();
    onChain(t, { [registrant.address]: metaHex() });
    const c = await claim();
    const res = await t.post("/names", { ...c, metaAddress: `st:base:${metaHex().toUpperCase().replace("0X", "0x")}` });
    expect(res.status).toBe(201);
    expect((await j(res)).metaAddress).toBe(metaUri());
  });

  it("rejects a meta-address that is not on the curve", async () => {
    const t = makeTestApp();
    const res = await t.post("/names", { ...(await claim()), metaAddress: `0x02${"11".repeat(32)}03${"11".repeat(32)}` });
    expect(res.status).toBe(400);
    expect((await j(res)).error.code).toBe("invalid_meta_address");
  });

  it("accepts boundary labels", async () => {
    const t = makeTestApp();
    onChain(t, { [registrant.address]: metaHex() });
    expect((await t.post("/names", await claim({ label: "a-1" }))).status).toBe(201);
    expect((await t.post("/names", await claim({ label: "z".repeat(32) }))).status).toBe(201);
  });

  it("lets the registrant update its meta-address with a later deadline, and logs it", async () => {
    const t = makeTestApp();
    onChain(t, { [registrant.address]: metaHex() });
    expect((await t.post("/names", await claim())).status).toBe(201);

    onChain(t, { [registrant.address]: metaHex(2) });
    // Same deadline (or older) is refused as stale.
    const stale = await t.post("/names", await claim({ meta: metaUri(2) }));
    expect(stale.status).toBe(409);
    expect((await j(stale)).error.code).toBe("stale_claim");

    const res = await t.post("/names", await claim({ meta: metaUri(2), deadline: BigInt(NOW + 900) }));
    expect(res.status).toBe(200);
    expect((await j(res)).metaAddress).toBe(metaUri(2));
    const hist = t.db.prepare("SELECT old_meta, new_meta FROM name_history ORDER BY id").all();
    expect(hist).toEqual([
      { old_meta: null, new_meta: metaUri() },
      { old_meta: metaUri(), new_meta: metaUri(2) },
    ]);
    expect(t.logs.some((l) => l.msg === "names: meta-address updated")).toBe(true);
  });

  it("treats an identical resubmission as idempotent", async () => {
    const t = makeTestApp();
    onChain(t, { [registrant.address]: metaHex() });
    const c = await claim();
    expect((await t.post("/names", c)).status).toBe(201);
    expect((await t.post("/names", c)).status).toBe(200);
  });

  it("rate limits claims per IP", async () => {
    const t = makeTestApp({ env: { RATE_LIMIT_NAMES_PER_IP: "1" } });
    onChain(t, { [registrant.address]: metaHex() });
    expect((await t.post("/names", await claim({ label: "one" }))).status).toBe(201);
    expect((await t.post("/names", await claim({ label: "two" }))).status).toBe(429);
  });
});
