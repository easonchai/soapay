import { describe, expect, it, vi } from "vitest";
import { createWalletClient, custom, getAddress, keccak256, verifyTypedData, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import {
  INVITE_DEFAULT_TTL_SECONDS,
  INVITE_MAX_TTL_SECONDS,
  buildInviteLink,
  defaultInviteExpiry,
  generateInviteCode,
  inviteCodeHash,
  inviteTypedData,
  parseInviteLink,
  signInvite,
  verifyInvite,
  type Invite,
  type InviteVerifier,
} from "../src/invites.js";

const employer = privateKeyToAccount("0x7777777777777777777777777777777777777777777777777777777777777777");
const other = privateKeyToAccount("0x8888888888888888888888888888888888888888888888888888888888888888");
const NOW = 1_800_000_000n;
const CODE = `0x${"ab".repeat(32)}` as Hex;

/** Pure ECDSA check standing in for a public client (EOA employer). */
const ecdsa: InviteVerifier = { verifyTypedData: (a) => verifyTypedData(a as any) };

function invite(over: Partial<Invite> = {}): Invite {
  return {
    label: "alice",
    employer: employer.address,
    codeHash: inviteCodeHash(CODE),
    expiresAt: NOW + BigInt(INVITE_DEFAULT_TTL_SECONDS),
    chainId: 84532,
    ...over,
  };
}

describe("invite codes", () => {
  it("generates 32 random bytes and hashes the raw bytes", () => {
    const a = generateInviteCode();
    const b = generateInviteCode();
    expect(a).toMatch(/^0x[0-9a-f]{64}$/);
    expect(a).not.toBe(b);
    expect(inviteCodeHash(CODE)).toBe(keccak256(CODE));
    expect(inviteCodeHash(`0x${"AB".repeat(32)}`)).toBe(keccak256(CODE));
    expect(() => inviteCodeHash("0x1234")).toThrow();
  });

  it("defaults to 14 days", () => {
    expect(defaultInviteExpiry(1000)).toBe(1000n + 14n * 86400n);
  });
});

describe("invite typed data", () => {
  it("matches the spec (§7)", () => {
    const td = inviteTypedData(invite());
    expect(td.domain).toEqual({ name: "Soapay Names", version: "1", chainId: 84532 });
    expect(td.types.Invite.map((f) => `${f.type} ${f.name}`)).toEqual([
      "string label",
      "address employer",
      "bytes32 codeHash",
      "uint256 expiresAt",
    ]);
    expect(td.primaryType).toBe("Invite");
  });

  it("rejects an invalid label", () => {
    expect(() => inviteTypedData(invite({ label: "A!" }))).toThrow();
  });
});

describe("signInvite / verifyInvite", () => {
  it("round-trips with a LocalAccount", async () => {
    const signature = await signInvite(employer, invite());
    expect(await verifyInvite(ecdsa, { ...invite(), signature, nowSeconds: NOW })).toEqual({ valid: true });
  });

  it("round-trips with a viem WalletClient", async () => {
    const wallet = createWalletClient({ chain: baseSepolia, account: employer, transport: custom({ request: async () => null }) });
    const signature = await signInvite(wallet as any, invite());
    expect(await verifyInvite(ecdsa, { ...invite(), signature, nowSeconds: NOW })).toEqual({ valid: true });
  });

  it("rejects a signature by someone else, or over other fields", async () => {
    const bad = await signInvite(other, invite());
    expect(await verifyInvite(ecdsa, { ...invite(), signature: bad, nowSeconds: NOW })).toEqual({
      valid: false,
      reason: "bad-signature",
    });
    const sig = await signInvite(employer, invite());
    expect(await verifyInvite(ecdsa, { ...invite({ label: "bobby" }), signature: sig, nowSeconds: NOW })).toMatchObject({
      valid: false,
    });
    expect(await verifyInvite(ecdsa, { ...invite(), signature: "0xdead", nowSeconds: NOW })).toMatchObject({ valid: false });
  });

  it("enforces expiry bounds", async () => {
    const past = invite({ expiresAt: NOW });
    expect(await verifyInvite(ecdsa, { ...past, signature: await signInvite(employer, past), nowSeconds: NOW })).toEqual({
      valid: false,
      reason: "expired",
    });
    const far = invite({ expiresAt: NOW + BigInt(INVITE_MAX_TTL_SECONDS) + 1n });
    expect(await verifyInvite(ecdsa, { ...far, signature: await signInvite(employer, far), nowSeconds: NOW })).toEqual({
      valid: false,
      reason: "expiry-too-far",
    });
  });

  it("delegates to the public client (ERC-1271 / 6492 smart wallets)", async () => {
    const smart = "0x000000000000000000000000000000000000c0de";
    const client = { verifyTypedData: vi.fn(async (_a: any) => true) };
    const res = await verifyInvite(client, { ...invite({ employer: smart }), signature: "0x1234", nowSeconds: NOW });
    expect(res).toEqual({ valid: true });
    expect(client.verifyTypedData).toHaveBeenCalledWith(
      expect.objectContaining({ address: getAddress(smart), signature: "0x1234", primaryType: "Invite" }),
    );
    client.verifyTypedData.mockRejectedValueOnce(new Error("revert"));
    expect(await verifyInvite(client, { ...invite({ employer: smart }), signature: "0x1234", nowSeconds: NOW })).toMatchObject({
      valid: false,
    });
  });
});

describe("invite links", () => {
  it("builds the spec format and parses it back", () => {
    const link = buildInviteLink({ recipientUrl: "https://pay.example/app/", code: CODE, label: "alice", org: "Acme & Co" });
    expect(link).toBe(`https://pay.example/app/#/join?code=${CODE}&label=alice&org=Acme%20%26%20Co`);
    const p = parseInviteLink(link)!;
    expect(p).toEqual({ code: CODE, codeHash: keccak256(CODE), label: "alice", org: "Acme & Co" });
    expect(parseInviteLink(link.slice(link.indexOf("#")))).toEqual(p);
    expect(parseInviteLink(`/join?code=${CODE}`)).toMatchObject({ code: CODE, label: undefined, org: undefined });
  });

  it("omits an empty org", () => {
    expect(buildInviteLink({ recipientUrl: "http://localhost:5174", code: CODE, label: "alice", org: " " })).toBe(
      `http://localhost:5174/#/join?code=${CODE}&label=alice`,
    );
  });

  it("rejects malformed links and drops bad hints", () => {
    expect(parseInviteLink("https://pay.example/#/join?code=0x12")).toBeUndefined();
    expect(parseInviteLink(`https://pay.example/#/other?code=${CODE}`)).toBeUndefined();
    expect(parseInviteLink(`https://pay.example/join?code=${CODE}`)).toBeUndefined();
    expect(parseInviteLink(`#/join?code=${CODE}&label=NO!`)?.label).toBeUndefined();
  });
});
