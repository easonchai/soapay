import { describe, expect, it, vi } from "vitest";
import { createPublicClient, custom, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { inviteCodeHash, parseInviteLink, verifyInvite } from "@soapay/sdk";
import {
  applyPollOutcomes,
  createInvite,
  httpInviteApi,
  inviteStatusText,
  invitedEnsName,
  mockInviteApi,
  needsPolling,
  pollInvite,
  pollInvites,
  InviteError,
  type InviteApi,
  type InvitedEmployee,
} from "../src/lib/invites.js";
import { createMockResolver, memoryRotationStore } from "../src/lib/resolver.js";
import { enrollEmployee, type Resolver } from "../src/lib/roster.js";

const CODE = `0x${"11".repeat(32)}` as Hex;
const NOW = 1_800_000_000_000;
const employer = privateKeyToAccount(generatePrivateKey());

function deps(api: InviteApi, extra: Partial<Parameters<typeof createInvite>[1]> = {}) {
  return { api, signer: employer, employer: employer.address, chainId: 84532, recipientUrl: "https://pay.example/", now: NOW, ...extra };
}

const empty = { invites: [], employees: [] };

describe("createInvite", () => {
  it("signs a verifiable invite, POSTs it and builds the link", async () => {
    const create = vi.fn(async (b: { codeHash: Hex; expiresAt: number }) => ({ codeHash: b.codeHash, expiresAt: b.expiresAt }));
    const api: InviteApi = { create, get: async () => null };
    const inv = await createInvite({ label: " Alice ", amount: 5_000_000n, org: "Acme" }, deps(api, { code: CODE }), empty);

    expect(inv.label).toBe("alice");
    expect(inv.code).toBe(CODE);
    expect(inv.codeHash).toBe(inviteCodeHash(CODE));
    expect(inv.state).toEqual({ kind: "pending" });
    expect(inv.expiresAt).toBe(NOW / 1000 + 14 * 24 * 3600);
    const body = create.mock.calls[0]![0] as unknown as Record<string, unknown>;
    // The code itself never goes to the API, only its hash.
    expect(JSON.stringify(body)).not.toContain(CODE.slice(2));
    expect(body).toMatchObject({ label: "alice", employer: employer.address, codeHash: inv.codeHash, org: "Acme" });

    // The signature verifies with the SDK verifier (what the API runs).
    const client = createPublicClient({ transport: custom({ request: async () => null }) });
    const v = await verifyInvite(client, {
      label: "alice",
      employer: employer.address,
      codeHash: inv.codeHash,
      expiresAt: BigInt(inv.expiresAt),
      chainId: 84532,
      signature: body.signature as Hex,
      nowSeconds: BigInt(NOW / 1000),
    });
    expect(v).toEqual({ valid: true });

    expect(inv.link.startsWith("https://pay.example/#/join?code=")).toBe(true);
    expect(parseInviteLink(inv.link)).toMatchObject({ code: CODE, label: "alice", org: "Acme" });
  });

  it("rejects bad labels, amounts and duplicates before signing", async () => {
    const signTypedData = vi.fn();
    const api = mockInviteApi();
    const d = deps(api, { signer: { signTypedData } });
    await expect(createInvite({ label: "A!", amount: 1n }, d, empty)).rejects.toThrow(InviteError);
    await expect(createInvite({ label: "alice", amount: 0n }, d, empty)).rejects.toThrow(/more than 0/);
    const pending = { label: "alice", state: { kind: "pending" } } as InvitedEmployee;
    await expect(createInvite({ label: "alice", amount: 1n }, d, { invites: [pending], employees: [] })).rejects.toThrow(/pending invite/);
    const resolve = createMockResolver(memoryRotationStore(), 0);
    const alice = await enrollEmployee(resolve, { ensName: "alice.soapay.eth", amount: 1n }, []);
    await expect(createInvite({ label: "alice", amount: 1n }, d, { invites: [], employees: [alice] })).rejects.toThrow(/already on the roster/);
    expect(signTypedData).not.toHaveBeenCalled();
  });

  it("allows a new invite when the old one for that label expired", async () => {
    const expired = { label: "alice", state: { kind: "expired" } } as InvitedEmployee;
    const inv = await createInvite({ label: "alice", amount: 1n }, deps(mockInviteApi()), { invites: [expired], employees: [] });
    expect(inv.label).toBe("alice");
  });
});

describe("httpInviteApi", () => {
  it("maps error codes and 404", async () => {
    const fetchImpl = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "POST") return new Response(JSON.stringify({ error: { code: "label_reserved" } }), { status: 409 });
      if (String(url).endsWith("/invites/0xmissing")) return new Response("{}", { status: 404 });
      return new Response(JSON.stringify({ status: "pending", label: "a" }), { status: 200 });
    }) as unknown as typeof fetch;
    const api = httpInviteApi("https://api.example/", { fetchImpl });
    await expect(api.create({} as never)).rejects.toThrow(/reserved by another pending invite/);
    expect(await api.get("0xmissing" as Hex)).toBeNull();
    expect(await api.get("0xabc" as Hex)).toMatchObject({ status: "pending" });
    expect((fetchImpl as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]![0]).toBe("https://api.example/invites");
  });
});

describe("polling and auto-enrollment", () => {
  async function invited(api: InviteApi, label = "carol") {
    return createInvite({ label, amount: 7_000_000n }, deps(api), empty);
  }

  it("mock API flips an invite to claimed after the delay", async () => {
    let t = NOW;
    const api = mockInviteApi({ claimAfterMs: 3_000, now: () => t });
    const inv = await invited(api);
    expect((await api.get(inv.codeHash))!.status).toBe("pending");
    t += 3_000;
    expect(await api.get(inv.codeHash)).toMatchObject({ status: "claimed", name: "carol.soapay.eth" });
  });

  it("stays pending, then enrolls through resolve-and-pin on claimed", async () => {
    let t = NOW;
    const api = mockInviteApi({ claimAfterMs: 3_000, now: () => t });
    const resolve = vi.fn(createMockResolver(memoryRotationStore(), 0));
    const inv = await invited(api);

    const first = await pollInvite(inv, { api, resolve, roster: [], now: t });
    expect(first.kind).toBe("unchanged");
    expect(resolve).not.toHaveBeenCalled();
    expect(inviteStatusText(inv)).toBe("Invited (pending)");

    t += 3_000;
    const second = await pollInvite(inv, { api, resolve, roster: [], now: t });
    expect(second.kind).toBe("enrolled");
    expect(resolve).toHaveBeenCalledWith("carol.soapay.eth");
    if (second.kind !== "enrolled") throw new Error("unreachable");
    expect(second.employee).toMatchObject({ ensName: "carol.soapay.eth", amount: 7_000_000n, active: true });
    expect(second.employee.pin.metaAddressURI).toMatch(/^st:eth:0x/);

    const applied = applyPollOutcomes([inv], [], new Map([[inv.id, second]]));
    expect(applied.invites).toEqual([]);
    expect(applied.employees).toHaveLength(1);
    // Applied separately (two store updates), the roster still gets the employee.
    expect(applyPollOutcomes([], [], new Map([[inv.id, second]])).employees).toHaveLength(1);
    expect(applyPollOutcomes([inv], [second.employee], new Map([[inv.id, second]])).employees).toHaveLength(1);
  });

  it("keeps a claimed invite as claimed-unverified when resolution fails, and retries", async () => {
    let t = NOW;
    const api = mockInviteApi({ claimAfterMs: 0, now: () => t });
    const inv = await invited(api, "missing-dave");
    const failing: Resolver = createMockResolver(memoryRotationStore(), 0);
    const o = await pollInvite(inv, { api, resolve: failing, roster: [], now: t });
    expect(o.kind).toBe("updated");
    if (o.kind !== "updated") throw new Error("unreachable");
    expect(o.invite.state.kind).toBe("claimed-unverified");
    expect(needsPolling(o.invite)).toBe(true);
    expect(inviteStatusText(o.invite)).toMatch(/^Claimed, waiting to verify/);
  });

  it("marks expired invites and stops polling them", async () => {
    const api = mockInviteApi();
    const inv = await invited(api);
    api.expire(inv.codeHash);
    const o = await pollInvite(inv, { api, resolve: createMockResolver(memoryRotationStore(), 0), roster: [] });
    expect(o.kind === "updated" && o.invite.state.kind).toBe("expired");
    if (o.kind !== "updated") throw new Error("unreachable");
    expect(needsPolling(o.invite)).toBe(false);
    expect(inviteStatusText(o.invite)).toBe("Invite expired");
    // An unknown code (404) also counts as expired.
    const gone = await pollInvite(inv, { api: { ...api, get: async () => null }, resolve: vi.fn(), roster: [] });
    expect(gone.kind === "updated" && gone.invite.state.kind).toBe("expired");
  });

  it("leaves the invite unchanged when the API errors", async () => {
    const inv = await invited(mockInviteApi());
    const api: InviteApi = { create: vi.fn(), get: async () => Promise.reject(new Error("down")) };
    expect((await pollInvite(inv, { api, resolve: vi.fn(), roster: [] })).kind).toBe("unchanged");
  });

  it("never enrolls one name twice", async () => {
    const api = mockInviteApi({ claimAfterMs: 0 });
    const resolve = createMockResolver(memoryRotationStore(), 0);
    const a = await invited(api, "erin");
    const outcomes = await pollInvites([a, { ...a, id: "dup" }], { api, resolve, roster: [] });
    expect([...outcomes.values()].map((o) => o.kind)).toEqual(["enrolled", "done"]);
    const applied = applyPollOutcomes([a, { ...a, id: "dup" }], [], outcomes);
    expect(applied.employees).toHaveLength(1);
    expect(applied.invites).toHaveLength(0);
  });

  it("uses the API name only when its label matches the invite", () => {
    expect(invitedEnsName({ label: "frank" }, "frank.soapay.eth")).toBe("frank.soapay.eth");
    expect(invitedEnsName({ label: "frank" }, "mallory.soapay.eth")).toBe("frank.soapay.eth");
    expect(invitedEnsName({ label: "frank" })).toBe("frank.soapay.eth");
  });
});
