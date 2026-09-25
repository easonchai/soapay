import { describe, expect, it } from "vitest";
import { BaseError } from "viem";
import { REGISTRY_ADDRESS } from "@soapay/sdk";
import { makeTestApp, metaHex, metaUri, registrant, j } from "./helpers.js";

const SIG = `0x${"ab".repeat(65)}`;

describe("POST /register", () => {
  it("simulates, sends from the relayer, waits for the receipt and stores it", async () => {
    const t = makeTestApp();
    const res = await t.post("/register", { registrant: registrant.address, metaAddress: metaUri(), signature: SIG });
    expect(res.status).toBe(200);
    const body = await j(res);
    expect(body).toEqual({ txHash: expect.stringMatching(/^0x[0-9a-f]{64}$/), status: "success" });

    const sim = t.client.simulateContract.mock.calls[0]![0];
    expect(sim.address).toBe(REGISTRY_ADDRESS);
    expect(sim.functionName).toBe("registerKeysOnBehalf");
    expect(sim.args).toEqual([registrant.address, 1n, SIG, metaHex()]);
    expect(sim.account.address).toBe(t.relayer.account!.address);
    expect(t.relayer.writeContract).toHaveBeenCalledTimes(1);

    const row = t.db.prepare("SELECT * FROM registrations").get() as any;
    expect(row).toMatchObject({ registrant: registrant.address, meta_bytes: metaHex(), tx_hash: body.txHash, status: "success", block_number: "123" });
    // Signatures never appear in full in the logs.
    expect(JSON.stringify(t.logs)).not.toContain(SIG.slice(2));
  });

  it("accepts raw hex meta-addresses too", async () => {
    const t = makeTestApp();
    const res = await t.post("/register", { registrant: registrant.address, metaAddress: metaHex(), signature: SIG });
    expect(res.status).toBe(200);
  });

  it("is idempotent for a retried identical registration", async () => {
    const t = makeTestApp();
    const req = { registrant: registrant.address, metaAddress: metaUri(), signature: SIG };
    const first = await j(await t.post("/register", req));
    t.client.readContract.mockResolvedValue(metaHex()); // now on-chain
    const again = await t.post("/register", req);
    expect(again.status).toBe(200);
    expect(await j(again)).toMatchObject({ txHash: first.txHash, status: "success", idempotent: true });
    expect(t.relayer.writeContract).toHaveBeenCalledTimes(1);
  });

  it("collapses concurrent identical submissions onto one tx", async () => {
    const t = makeTestApp();
    const req = { registrant: registrant.address, metaAddress: metaUri(), signature: SIG };
    const [a, b] = await Promise.all([t.post("/register", req), t.post("/register", req)]);
    const [ja, jb] = [await j(a), await j(b)];
    expect(ja.txHash).toBe(jb.txHash);
    expect(t.relayer.writeContract).toHaveBeenCalledTimes(1);
  });

  it("refuses when the registry already holds that exact meta-address", async () => {
    const t = makeTestApp();
    t.client.readContract.mockResolvedValue(metaHex().toUpperCase().replace("0X", "0x"));
    const res = await t.post("/register", { registrant: registrant.address, metaAddress: metaUri(), signature: SIG });
    expect(res.status).toBe(409);
    expect((await j(res)).error.code).toBe("already_registered");
    expect(t.relayer.writeContract).not.toHaveBeenCalled();
  });

  it("maps a simulation revert (bad signature) to 400 without sending", async () => {
    const t = makeTestApp();
    t.client.simulateContract.mockRejectedValue(new BaseError("ERC6538Registry__InvalidSignature"));
    const res = await t.post("/register", { registrant: registrant.address, metaAddress: metaUri(), signature: SIG });
    expect(res.status).toBe(400);
    expect((await j(res)).error.code).toBe("registration_rejected");
    expect(t.relayer.writeContract).not.toHaveBeenCalled();
  });

  it("reports a reverted tx as 502", async () => {
    const t = makeTestApp();
    t.client.waitForTransactionReceipt.mockResolvedValue({ status: "reverted", blockNumber: 5n });
    const res = await t.post("/register", { registrant: registrant.address, metaAddress: metaUri(), signature: SIG });
    expect(res.status).toBe(502);
  });

  it("rate limits per registrant", async () => {
    const t = makeTestApp();
    for (let i = 1; i <= 3; i++) {
      t.setIp(`10.0.0.${i}`);
      const r = await t.post("/register", { registrant: registrant.address, metaAddress: metaUri(i), signature: SIG });
      expect(r.status).toBe(200);
    }
    t.setIp("10.0.0.9");
    const res = await t.post("/register", { registrant: registrant.address, metaAddress: metaUri(4), signature: SIG });
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toMatch(/^\d+$/);
  });

  it("rate limits per IP", async () => {
    const t = makeTestApp({ env: { RATE_LIMIT_REGISTER_PER_IP: "2" } });
    const addr = (i: number) => `0x${i.toString(16).padStart(40, "0")}`;
    expect((await t.post("/register", { registrant: addr(1), metaAddress: metaUri(), signature: SIG })).status).toBe(200);
    expect((await t.post("/register", { registrant: addr(2), metaAddress: metaUri(), signature: SIG })).status).toBe(200);
    const res = await t.post("/register", { registrant: addr(3), metaAddress: metaUri(), signature: SIG });
    expect(res.status).toBe(429);
    expect((await j(res)).error.code).toBe("rate_limited");
  });

  it("validates input", async () => {
    const t = makeTestApp();
    expect((await t.post("/register", { registrant: "nope", metaAddress: metaUri(), signature: SIG })).status).toBe(400);
    expect((await t.post("/register", { registrant: registrant.address, metaAddress: "st:base:0x1234", signature: SIG })).status).toBe(400);
    expect((await t.post("/register", { registrant: registrant.address, metaAddress: metaUri(), signature: "zz" })).status).toBe(400);
    const bad = await t.app.request("/register", { method: "POST", body: "{", headers: { "content-type": "application/json" } });
    expect(bad.status).toBe(400);
    expect(await j(bad)).toEqual({ error: { code: "invalid_json", message: "Body must be JSON" } });
  });

  it("returns 503 when no relayer is configured", async () => {
    const t = makeTestApp({ relayer: false });
    const res = await t.post("/register", { registrant: registrant.address, metaAddress: metaUri(), signature: SIG });
    expect(res.status).toBe(503);
  });

  it("enforces the body size limit", async () => {
    const t = makeTestApp();
    const res = await t.post("/register", { pad: "x".repeat(20_000) });
    expect(res.status).toBe(413);
  });
});
