import { describe, expect, it } from "vitest";
import { getAddress, type Address } from "viem";
import { BACKUP_MAX_BYTES, backupMessage } from "@soapay/sdk";
import { NOW, j, makeTestApp, other, registrant } from "./helpers.js";

const b64 = (bytes: number, fill = 7) => Buffer.alloc(bytes, fill).toString("base64");
const CT = b64(64);

async function signed(version: number, ciphertext = CT, signer = registrant, address: Address = registrant.address) {
  return { version, ciphertext, signature: await signer.signMessage({ message: backupMessage({ address, version, ciphertext }) }) };
}

describe("encrypted backups (PUT/GET /backups/:address)", () => {
  it("stores a signed backup and returns it; the address is checksummed", async () => {
    const t = makeTestApp();
    const lower = registrant.address.toLowerCase();
    const res = await t.put(`/backups/${lower}`, await signed(1));
    expect(res.status).toBe(200);
    expect(await j(res)).toEqual({ address: registrant.address, version: 1 });

    const got = await t.app.request(`/backups/${lower}`);
    expect(got.status).toBe(200);
    expect(await j(got)).toEqual({ address: registrant.address, version: 1, ciphertext: CT, updatedAt: NOW });
    const row = t.db.prepare("SELECT address FROM vault_backups").get() as { address: string };
    expect(row.address).toBe(getAddress(registrant.address));

    // A higher version replaces it.
    t.setNow(NOW + 60);
    const ct2 = b64(10, 9);
    expect((await t.put(`/backups/${registrant.address}`, await signed(5, ct2))).status).toBe(200);
    expect(await j(await t.app.request(`/backups/${registrant.address}`))).toMatchObject({ version: 5, ciphertext: ct2, updatedAt: NOW + 60 });
  });

  it("404s when there is no backup, 400s on a bad address", async () => {
    const t = makeTestApp();
    const res = await t.app.request(`/backups/${other.address}`);
    expect(res.status).toBe(404);
    expect((await j(res)).error.code).toBe("not_found");
    expect((await t.app.request("/backups/0x1234")).status).toBe(400);
  });

  it("rejects a signature from another wallet, or over other contents", async () => {
    const t = makeTestApp();
    const byOther = await signed(1, CT, other, registrant.address);
    let res = await t.put(`/backups/${registrant.address}`, byOther);
    expect(res.status).toBe(401);
    expect((await j(res)).error.code).toBe("bad_signature");

    // Signed for version 1 but sent as version 2; signed for one ciphertext but sent with another.
    const good = await signed(1);
    expect((await t.put(`/backups/${registrant.address}`, { ...good, version: 2 })).status).toBe(401);
    expect((await t.put(`/backups/${registrant.address}`, { ...good, ciphertext: b64(64, 8) })).status).toBe(401);
    expect((await t.app.request(`/backups/${registrant.address}`)).status).toBe(404);
  });

  it("refuses a stale or equal version (no rollback) and returns the current one", async () => {
    const t = makeTestApp();
    expect((await t.put(`/backups/${registrant.address}`, await signed(3))).status).toBe(200);
    for (const v of [3, 2]) {
      const res = await t.put(`/backups/${registrant.address}`, await signed(v, b64(8, 1)));
      expect(res.status).toBe(409);
      const body = await j(res);
      expect(body.error.code).toBe("stale_version");
      expect(body.version).toBe(3);
    }
    expect(await j(await t.app.request(`/backups/${registrant.address}`))).toMatchObject({ version: 3, ciphertext: CT });
  });

  it("413 too_large above 512 KiB decoded, and for an oversized body", async () => {
    const t = makeTestApp();
    const atLimit = b64(BACKUP_MAX_BYTES);
    expect((await t.put(`/backups/${registrant.address}`, await signed(1, atLimit))).status).toBe(200);

    const over = b64(BACKUP_MAX_BYTES + 1);
    let res = await t.put(`/backups/${registrant.address}`, await signed(2, over));
    expect(res.status).toBe(413);
    expect((await j(res)).error.code).toBe("too_large");

    res = await t.put(`/backups/${registrant.address}`, { version: 3, ciphertext: b64(BACKUP_MAX_BYTES * 2), signature: "0x00" });
    expect(res.status).toBe(413);
    expect((await j(res)).error.code).toBe("too_large");
  });

  it("validates the body shape", async () => {
    const t = makeTestApp();
    const good = await signed(1);
    const bad = async (patch: Record<string, unknown>, code: string) => {
      const res = await t.put(`/backups/${registrant.address}`, { ...good, ...patch });
      expect(res.status).toBe(400);
      expect((await j(res)).error.code).toBe(code);
    };
    await bad({ version: 0 }, "invalid_version");
    await bad({ version: 1.5 }, "invalid_version");
    await bad({ version: "2" }, "invalid_version");
    await bad({ ciphertext: "" }, "invalid_ciphertext");
    await bad({ ciphertext: "not base64!" }, "invalid_ciphertext");
    await bad({ signature: "nope" }, "invalid_signature");
  });

  it("smart-account (ERC-1271 / 6492 / 7702) wallets verify through the public client", async () => {
    const t = makeTestApp();
    const account = "0x000000000000000000000000000000000000c0DE" as Address;
    // Stand in for the on-chain isValidSignature call: accept only the exact message for this wallet.
    t.client.verifyMessage.mockImplementation(async (a: any) => a.address === account && a.message === backupMessage({ address: account, version: 1, ciphertext: CT }) && a.signature === "0xc0ffee");
    const res = await t.put(`/backups/${account}`, { version: 1, ciphertext: CT, signature: "0xc0ffee" });
    expect(res.status).toBe(200);
    expect(t.client.verifyMessage).toHaveBeenCalledWith({
      address: account,
      message: `soapay-backup:v1:${account}:1:${(backupMessage({ address: account, version: 1, ciphertext: CT }).split(":")[4])}`,
      signature: "0xc0ffee",
    });
    // An RPC failure during the check is a bad signature, never a stored backup.
    t.client.verifyMessage.mockRejectedValueOnce(new Error("rpc down"));
    expect((await t.put(`/backups/${account}`, { version: 2, ciphertext: CT, signature: "0xc0ffee" })).status).toBe(401);
  });

  it("rate-limits writes per wallet", async () => {
    const t = makeTestApp({ env: { RATE_LIMIT_BACKUP_WRITES_PER_ADDRESS: "2" } });
    expect((await t.put(`/backups/${registrant.address}`, await signed(1))).status).toBe(200);
    expect((await t.put(`/backups/${registrant.address}`, await signed(2))).status).toBe(200);
    const res = await t.put(`/backups/${registrant.address}`, await signed(3));
    expect(res.status).toBe(429);
    // Another wallet is unaffected.
    expect((await t.put(`/backups/${other.address}`, await signed(1, CT, other, other.address))).status).toBe(200);
  });

  it("allows PUT in CORS preflight for the SPAs", async () => {
    const t = makeTestApp();
    const res = await t.app.request(`/backups/${registrant.address}`, {
      method: "OPTIONS",
      headers: { origin: "http://localhost:5174", "access-control-request-method": "PUT" },
    });
    expect(res.headers.get("access-control-allow-methods")).toContain("PUT");
  });
});
