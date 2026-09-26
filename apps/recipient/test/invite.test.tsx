import { describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { generateMnemonic, keysFromMnemonic } from "@soapay/sdk";
import { getAddress, keccak256 } from "viem";
import { createApi } from "../src/api/client.js";
import { InviteProvider } from "../src/hooks/useInvite.js";
import { claimName, registerMetaAddress } from "../src/onboarding/actions.js";
import { inviteCodeHash, parseJoinLink, resolveInvite, withInvitePayer } from "../src/onboarding/invite.js";
import { InviteBanner } from "../src/onboarding/Onboarding.js";
import { MOCK_EMPLOYER, MOCK_INVITES, createMockFetch, createMockPublicClient } from "../src/services/mock.js";
import { ServicesProvider, buildServices } from "../src/services/ServicesProvider.js";
import { VaultProvider } from "../src/vault/VaultProvider.js";
import { defaultSettings } from "../src/vault/types.js";

const CODE = `0x${"ab".repeat(32)}` as const;

describe("parseJoinLink", () => {
  it("reads code, label and org from the hash route", () => {
    expect(parseJoinLink(`#/join?code=${CODE}&label=Jordan&org=Acme%20Robotics`)).toEqual({ code: CODE, labelHint: "jordan", orgHint: "Acme Robotics" });
    expect(parseJoinLink(`https://app.soapay.xyz/#/join?code=${CODE}`)).toEqual({ code: CODE });
    expect(parseJoinLink(`/join?code=${CODE.toUpperCase().replace("0X", "0x")}`)?.code).toBe(CODE);
  });
  it("rejects other routes and malformed codes", () => {
    expect(parseJoinLink("#/")).toBeNull();
    expect(parseJoinLink(`#/joinx?code=${CODE}`)).toBeNull();
    expect(parseJoinLink("#/join")).toBeNull();
    expect(parseJoinLink("#/join?code=0x1234")).toBeNull();
    expect(parseJoinLink(`#/join?code=${"ab".repeat(32)}`)).toBeNull();
    expect(parseJoinLink(`#/join?code=0x${"zz".repeat(32)}`)).toBeNull();
  });
  it("hashes the code bytes with keccak256", () => {
    expect(inviteCodeHash(CODE)).toBe(keccak256(CODE));
  });
});

describe("resolveInvite", () => {
  const api = createApi("http://mock", createMockFetch(84532));

  it("pending: returns the reserved label and the org from the API, not the URL", async () => {
    const s = await resolveInvite(api, { code: MOCK_INVITES.pending.code, labelHint: "someone-else", orgHint: "Fake Org" });
    // The employer address comes along too: on claim it becomes a known payer.
    expect(s).toMatchObject({ kind: "pending", label: "jordan", org: "Acme Robotics", code: MOCK_INVITES.pending.code, employer: getAddress(MOCK_EMPLOYER) });
  });

  it("expired: unusable with a clear message", async () => {
    const s = await resolveInvite(api, { code: MOCK_INVITES.expired.code });
    expect(s).toMatchObject({ kind: "unusable", reason: "expired" });
    if (s.kind === "unusable") expect(s.message).toMatch(/expired/);
  });

  it("a pending invite past its expiry is treated as expired", async () => {
    const s = await resolveInvite(api, { code: MOCK_INVITES.pending.code }, Date.now() + 30 * 86_400_000);
    expect(s).toMatchObject({ kind: "unusable", reason: "expired" });
  });

  it("claimed: after POST /names with the invite code, the invite can't be reused", async () => {
    const keys = keysFromMnemonic(generateMnemonic());
    const client = createMockPublicClient(84532) as never;
    // Without the code, the reserved label is refused.
    await registerMetaAddress({ api, client, keys, chainId: 84532 });
    await expect(claimName({ api, keys, chainId: 84532, label: "jordan" })).rejects.toThrow(/reserved/);
    await claimName({ api, keys, chainId: 84532, label: "jordan", inviteCode: MOCK_INVITES.pending.code });
    const s = await resolveInvite(api, { code: MOCK_INVITES.pending.code });
    expect(s).toMatchObject({ kind: "unusable", reason: "claimed" });
  });

  it("unknown code: not found", async () => {
    expect(await resolveInvite(api, { code: CODE })).toMatchObject({ kind: "unusable", reason: "not_found" });
  });

  it("API down: unusable, falls back to picking a name", async () => {
    const down = createApi("http://down", async () => {
      throw new Error("offline");
    });
    expect(await resolveInvite(down, { code: CODE, orgHint: "Acme" })).toMatchObject({ kind: "unusable", reason: "error", org: "Acme" });
  });
});

describe("InviteBanner", () => {
  const services = buildServices({ ...defaultSettings(), apiUrl: "http://mock" }, true);
  const mount = (hash: string) =>
    render(
      <VaultProvider>
        <ServicesProvider override={services}>
          <InviteProvider hash={hash}>
            <InviteBanner />
          </InviteProvider>
        </ServicesProvider>
      </VaultProvider>,
    );

  it("explains an expired invite (pending is covered via resolveInvite above)", async () => {
    mount(`#/join?code=${MOCK_INVITES.expired.code}`);
    await waitFor(() => expect(screen.getByTestId("invite-banner").textContent).toMatch(/expired/));
  });

  it("renders nothing without a join link", () => {
    const { container } = mount("#/");
    expect(container.textContent).toBe("");
  });
});

describe("claimed invite → employer becomes a known payer", () => {
  it("withInvitePayer adds the employer under the org name, once", () => {
    const base = defaultSettings();
    const inv = { employer: MOCK_EMPLOYER, org: "Acme Robotics" };
    const once = withInvitePayer(base, inv);
    expect(once.knownPayers).toEqual([{ address: getAddress(MOCK_EMPLOYER), name: "Acme Robotics" }]);
    expect(base.knownPayers).toEqual([]);
    expect(withInvitePayer(once, inv)).toBe(once);
    // A name the user already gave this payer is kept.
    const named = { ...base, knownPayers: [{ address: getAddress(MOCK_EMPLOYER), name: "My job" }] };
    expect(withInvitePayer(named, { employer: MOCK_EMPLOYER.toLowerCase() as `0x${string}`, org: "Acme" }).knownPayers).toEqual(named.knownPayers);
    expect(withInvitePayer(base, { employer: MOCK_EMPLOYER, org: null }).knownPayers[0]!.name).toBe("Employer");
    expect(withInvitePayer(base, { employer: null, org: "Acme" })).toBe(base);
  });
});
