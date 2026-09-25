import { describe, expect, it } from "vitest";
import { getAddress, type Hex, type PrivateKeyAccount } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { INVITE_DEFAULT_TTL_SECONDS, inviteCodeHash, inviteTypedData, nameClaimTypedData } from "@soapay/sdk";
import { makeTestApp, metaHex, metaUri, NOW, other, registrant, j } from "./helpers.js";

const employer = privateKeyToAccount("0x7777777777777777777777777777777777777777777777777777777777777777");
const CODE = `0x${"ab".repeat(32)}` as Hex;
const CODE2 = `0x${"cd".repeat(32)}` as Hex;
const TTL = INVITE_DEFAULT_TTL_SECONDS;

type T = ReturnType<typeof makeTestApp>;

async function invite(
  opts: { label?: string; code?: Hex; signer?: PrivateKeyAccount; as?: string; expiresAt?: number; org?: string } = {},
) {
  const signer = opts.signer ?? employer;
  const msg = {
    label: opts.label ?? "alice",
    employer: (opts.as ?? signer.address) as `0x${string}`,
    codeHash: inviteCodeHash(opts.code ?? CODE),
    expiresAt: opts.expiresAt ?? NOW + TTL,
  };
  const signature = await signer.signTypedData(inviteTypedData({ ...msg, expiresAt: BigInt(msg.expiresAt), chainId: 84532 }));
  return { ...msg, signature, ...(opts.org ? { org: opts.org } : {}) };
}

async function claim(
  t: T,
  opts: { label?: string; signer?: PrivateKeyAccount; meta?: string; inviteCode?: Hex; deadline?: number } = {},
) {
  const signer = opts.signer ?? registrant;
  const msg = {
    label: opts.label ?? "alice",
    registrant: signer.address,
    metaAddress: opts.meta ?? metaUri(),
    deadline: BigInt(opts.deadline ?? NOW + 600),
  };
  const signature = await signer.signTypedData(nameClaimTypedData({ ...msg, chainId: 84532 }));
  return t.post("/names", {
    ...msg,
    deadline: msg.deadline.toString(),
    signature,
    ...(opts.inviteCode ? { inviteCode: opts.inviteCode } : {}),
  });
}

function setup(env: Record<string, string> = {}) {
  const t = makeTestApp({ env });
  const onChain: Record<string, string> = { [registrant.address]: metaHex(1), [other.address]: metaHex(2) };
  t.client.readContract.mockImplementation(async (a: any) => onChain[a.args[0]] ?? "0x");
  return t;
}

describe("POST /invites", () => {
  it("reserves a label and serves it on GET /invites/:codeHash", async () => {
    const t = setup();
    const res = await t.post("/invites", await invite({ org: "Acme" }));
    expect(res.status).toBe(201);
    expect(await j(res)).toEqual({ codeHash: inviteCodeHash(CODE), expiresAt: NOW + TTL });

    const got = await t.app.request(`/invites/${inviteCodeHash(CODE)}`);
    expect(got.status).toBe(200);
    expect(await j(got)).toEqual({
      codeHash: inviteCodeHash(CODE),
      label: "alice",
      employer: employer.address,
      org: "Acme",
      expiresAt: NOW + TTL,
      status: "pending",
    });
    expect((await t.app.request(`/invites/0x${"00".repeat(32)}`)).status).toBe(404);
    expect((await t.app.request(`/invites/0x1234`)).status).toBe(400);
  });

  it("answers an identical retry with 200", async () => {
    const t = setup();
    const body = await invite();
    expect((await t.post("/invites", body)).status).toBe(201);
    expect((await t.post("/invites", body)).status).toBe(200);
  });

  it("rejects a duplicate reservation of the same label with 409", async () => {
    const t = setup();
    expect((await t.post("/invites", await invite())).status).toBe(201);
    const res = await t.post("/invites", await invite({ code: CODE2 }));
    expect(res.status).toBe(409);
    expect((await j(res)).error.code).toBe("label_reserved");
  });

  it("rejects a label that is already a name", async () => {
    const t = setup();
    expect((await claim(t)).status).toBe(201);
    const res = await t.post("/invites", await invite());
    expect(res.status).toBe(409);
    expect((await j(res)).error.code).toBe("label_taken");
  });

  it("rejects a bad signature with 401 and bad fields with 400", async () => {
    const t = setup();
    const forged = await invite({ signer: other, as: employer.address });
    const res = await t.post("/invites", forged);
    expect(res.status).toBe(401);
    expect((await j(res)).error.code).toBe("bad_signature");

    const tampered = { ...(await invite()), label: "bobby" };
    expect((await t.post("/invites", tampered)).status).toBe(401);
    expect((await t.post("/invites", { ...(await invite()), signature: "nope" })).status).toBe(400);
    expect((await t.post("/invites", { ...(await invite()), codeHash: "0x12" })).status).toBe(400);
    expect((await t.post("/invites", { ...(await invite()), label: "A!" })).status).toBe(400);
  });

  it("enforces the expiry window (in the future, at most 30 days)", async () => {
    const t = setup();
    const past = await t.post("/invites", await invite({ expiresAt: NOW }));
    expect(past.status).toBe(400);
    expect((await j(past)).error.code).toBe("expired");
    const far = await t.post("/invites", await invite({ expiresAt: NOW + 31 * 86400 }));
    expect(far.status).toBe(400);
    expect((await j(far)).error.code).toBe("expiry_too_far");
  });

  it("verifies smart-wallet employers through the public client (ERC-1271 / 6492)", async () => {
    const t = setup();
    const smart = getAddress("0x000000000000000000000000000000000000c0de");
    // A contract wallet: ECDSA would fail, the mocked public client says isValidSignature is OK.
    t.client.verifyTypedData.mockImplementation(async (a: any) => a.address === smart && a.signature === "0x1271");
    const body = { ...(await invite()), employer: smart, signature: "0x1271" };
    const res = await t.post("/invites", body);
    expect(res.status).toBe(201);
    expect(t.client.verifyTypedData).toHaveBeenCalledWith(
      expect.objectContaining({ address: smart, primaryType: "Invite", domain: { name: "Soapay Names", version: "1", chainId: 84532 } }),
    );
    expect((await j(await t.app.request(`/invites/${inviteCodeHash(CODE)}`))).employer).toBe(smart);

    const rejected = await t.post("/invites", { ...body, codeHash: inviteCodeHash(CODE2), signature: "0xbad0" });
    expect(rejected.status).toBe(401);
  });

  it("rate-limits per employer and per IP", async () => {
    const t = setup({ RATE_LIMIT_INVITES_PER_EMPLOYER: "2", RATE_LIMIT_INVITES_PER_IP: "3" });
    const labels = ["aaa", "bbb", "ccc", "ddd"] as const;
    const codes = [1, 2, 3, 4].map((i) => `0x${String(i).padStart(2, "0").repeat(32)}` as Hex) as [Hex, Hex, Hex, Hex];
    expect((await t.post("/invites", await invite({ label: labels[0], code: codes[0] }))).status).toBe(201);
    expect((await t.post("/invites", await invite({ label: labels[1], code: codes[1] }))).status).toBe(201);
    const third = await t.post("/invites", await invite({ label: labels[2], code: codes[2] }));
    expect(third.status).toBe(429);
    expect((await j(third)).error.message).toContain("invites:employer");

    // Another employer from the same IP hits the per-IP limit (3 hits already counted).
    const fourth = await t.post("/invites", await invite({ label: labels[3], code: codes[3], signer: other }));
    expect(fourth.status).toBe(429);
    expect((await j(fourth)).error.message).toContain("invites:ip");
    t.setIp("10.0.0.2");
    expect((await t.post("/invites", await invite({ label: labels[3], code: codes[3], signer: other }))).status).toBe(201);
  });
});

describe("POST /names with invites", () => {
  it("claims a reserved label with the right code and marks the invite claimed", async () => {
    const t = setup();
    expect((await t.post("/invites", await invite())).status).toBe(201);
    const res = await claim(t, { inviteCode: CODE });
    expect(res.status).toBe(201);
    const got = await j(await t.app.request(`/invites/${inviteCodeHash(CODE)}`));
    expect(got).toMatchObject({ status: "claimed", name: "alice.soapay.eth" });
    const row = t.db.prepare("SELECT claimed_by, claimed_at FROM invites").get() as any;
    expect(row).toEqual({ claimed_by: registrant.address, claimed_at: NOW });
  });

  it("refuses a wrong code with 403 and leaves the reservation intact", async () => {
    const t = setup();
    expect((await t.post("/invites", await invite())).status).toBe(201);
    const res = await claim(t, { inviteCode: CODE2 });
    expect(res.status).toBe(403);
    expect((await j(res)).error.code).toBe("invalid_invite_code");
    expect((await j(await t.app.request(`/invites/${inviteCodeHash(CODE)}`))).status).toBe("pending");
    expect((await t.app.request("/names/alice")).status).toBe(404);
  });

  it("refuses another person claiming a reserved label without the code (403)", async () => {
    const t = setup();
    expect((await t.post("/invites", await invite())).status).toBe(201);
    const res = await claim(t, { signer: other, meta: metaUri(2) });
    expect(res.status).toBe(403);
    expect((await j(res)).error.code).toBe("label_reserved");
  });

  it("frees the label once the invite expires", async () => {
    const t = setup();
    expect((await t.post("/invites", await invite())).status).toBe(201);
    t.setNow(NOW + TTL);
    expect((await j(await t.app.request(`/invites/${inviteCodeHash(CODE)}`))).status).toBe("expired");
    const late = await claim(t, { inviteCode: CODE, deadline: NOW + TTL + 600 });
    expect(late.status).toBe(409);
    expect((await j(late)).error.code).toBe("invite_expired");
    expect((await claim(t, { signer: other, meta: metaUri(2), deadline: NOW + TTL + 600 })).status).toBe(201);
    // A new reservation is possible for a free label after expiry (re-invite), but not this one: it's taken.
    expect((await t.post("/invites", await invite({ code: CODE2, expiresAt: NOW + 2 * TTL }))).status).toBe(409);
  });

  it("lets the employer re-invite a label after the first invite expired", async () => {
    const t = setup();
    expect((await t.post("/invites", await invite())).status).toBe(201);
    t.setNow(NOW + TTL + 1);
    expect((await t.post("/invites", await invite({ code: CODE2, expiresAt: NOW + 2 * TTL }))).status).toBe(201);
    expect((await claim(t, { inviteCode: CODE2, deadline: NOW + TTL + 600 })).status).toBe(201);
  });

  it("refuses an already-claimed invite with 409", async () => {
    const t = setup();
    expect((await t.post("/invites", await invite())).status).toBe(201);
    expect((await claim(t, { inviteCode: CODE })).status).toBe(201);
    // Reusing the code for another label.
    const res = await claim(t, { signer: other, meta: metaUri(2), label: "alice2", inviteCode: CODE });
    expect(res.status).toBe(403); // label mismatch comes first: the code reserves "alice"
    expect((await j(res)).error.code).toBe("invite_label_mismatch");
    // Reusing the code on the same label by someone else.
    const again = await claim(t, { signer: other, meta: metaUri(2), inviteCode: CODE });
    expect(again.status).toBe(409);
  });

  it("returns invite_claimed when a claimed code is presented for its own free label", async () => {
    const t = setup();
    expect((await t.post("/invites", await invite())).status).toBe(201);
    expect((await claim(t, { inviteCode: CODE })).status).toBe(201);
    // Simulate the name being gone (e.g. admin cleanup) while the invite stays claimed.
    t.db.prepare("DELETE FROM names WHERE label = 'alice'").run();
    const res = await claim(t, { signer: other, meta: metaUri(2), inviteCode: CODE });
    expect(res.status).toBe(409);
    expect((await j(res)).error.code).toBe("invite_claimed");
  });

  it("still claims an unreserved label without a code, and rejects a malformed code", async () => {
    const t = setup();
    expect((await claim(t)).status).toBe(201);
    const bad = await claim(t, { label: "bobby", signer: other, meta: metaUri(2), inviteCode: "0x12" as Hex });
    expect(bad.status).toBe(400);
    expect((await j(bad)).error.code).toBe("invalid_invite_code");
    const unknown = await claim(t, { label: "bobby", signer: other, meta: metaUri(2), inviteCode: CODE2 });
    expect(unknown.status).toBe(403);
  });

  it("rolls the invite back when issuance fails", async () => {
    const t = makeTestApp({
      nameIssuer: {
        issue: async () => {
          throw new Error("rpc down");
        },
      },
    });
    t.client.readContract.mockImplementation(async () => metaHex(1));
    expect((await t.post("/invites", await invite())).status).toBe(201);
    expect((await claim(t as T, { inviteCode: CODE })).status).toBe(502);
    expect((await j(await t.app.request(`/invites/${inviteCodeHash(CODE)}`))).status).toBe("pending");
  });
});
