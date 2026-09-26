// D-64: a recovery-phrase restore loses the World ID session id the vault held; the app reads it back
// from the API (registrant-signed SessionLookup) so rotation stays attested.
import { useEffect, type ReactNode } from "react";
import { beforeEach, describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { generateMnemonic, keysFromMnemonic, sessionLookupTypedData, sessionSignal, type SoapayKeys } from "@soapay/sdk";
import { recoverTypedDataAddress, type Hex } from "viem";
import { createApi, type ApiFetch } from "../src/api/client.js";
import { lookupSession, needsSessionRestore, restoredRecovery } from "../src/features/recovery/restore.js";
import { rotationPathOf } from "../src/hooks/useRotation.js";
import { resetSessionRestoreAttempts } from "../src/hooks/useSessionRestore.js";
import { InviteProvider } from "../src/hooks/useInvite.js";
import { claimName, registerMetaAddress } from "../src/onboarding/actions.js";
import { NameSettings } from "../src/screens/NameSettings.js";
import { ServicesProvider, buildServices, type Services } from "../src/services/ServicesProvider.js";
import { deleteEnvelope } from "../src/vault/idb.js";
import { VaultProvider, useVault } from "../src/vault/VaultProvider.js";
import { defaultSettings, type Profile, type VaultData } from "../src/vault/types.js";
import { mockSessionResult } from "../src/worldid/MockHumanCheck.js";

const chainId = defaultSettings().chainId;
const base = buildServices({ ...defaultSettings(), apiUrl: "http://mock" }, true);

/** Mock services whose API calls are recorded. */
function spied(): { services: Services; calls: { url: string; method: string; body: Record<string, unknown> | null }[] } {
  const calls: { url: string; method: string; body: Record<string, unknown> | null }[] = [];
  const fetchFn: ApiFetch = (url, init) => {
    calls.push({ url, method: (init?.method ?? "GET").toUpperCase(), body: init?.body ? JSON.parse(String(init.body)) : null });
    return base.fetch(url, init);
  };
  return { services: { ...base, api: createApi("http://mock", fetchFn), fetch: fetchFn }, calls };
}

const uniqueLabel = () => `r${Math.random().toString(36).slice(2, 10)}`;

/** The name as the original device left it: registered, claimed with a World ID session at enrollment. */
async function seedLinkedName(keys: SoapayKeys, label: string): Promise<string> {
  await registerMetaAddress({ api: base.api, client: base.client, keys, chainId });
  const session = mockSessionResult({ mode: "create-session", signal: sessionSignal(label, keys.registrantAddress) });
  await claimName({ api: base.api, keys, chainId, label, session });
  return (session as { session_id: string }).session_id;
}

let vaultData: VaultData | null = null;

/** A vault restored from `mnemonic` on a new device, with `profile` (no World ID session id). */
function Restored({ mnemonic, profile, children }: { mnemonic: string; profile: Profile; children: ReactNode }) {
  const vault = useVault();
  vaultData = vault.data ?? null;
  useEffect(() => {
    if (vault.status !== "empty") return;
    void (async () => {
      await vault.create(mnemonic, "correct horse battery staple");
      await vault.update((d) => ({ ...d, profile: { ...profile, onboardedAt: Date.now() } }));
    })();
  }, [vault, mnemonic, profile]);
  return vault.status === "unlocked" && vault.data?.profile.onboardedAt ? <>{children}</> : null;
}

function renderNameSettings(services: Services, mnemonic: string, profile: Profile) {
  return render(
    <VaultProvider idleLockMs={0}>
      <ServicesProvider override={services}>
        <InviteProvider hash="#/">
          <MemoryRouter>
            <Restored mnemonic={mnemonic} profile={profile}>
              <NameSettings />
            </Restored>
          </MemoryRouter>
        </InviteProvider>
      </ServicesProvider>
    </VaultProvider>,
  );
}

beforeEach(async () => {
  await deleteEnvelope();
  resetSessionRestoreAttempts();
  vaultData = null;
});

describe("session lookup (client side)", () => {
  const m = generateMnemonic();
  const keys = keysFromMnemonic(m);

  it("signs a SessionLookup with the registrant key, and the mock API returns the enrolled session", async () => {
    const label = uniqueLabel();
    const sessionId = await seedLinkedName(keys, label);
    const { services, calls } = spied();
    const res = await lookupSession({ api: services.api, chainId, label, registrantKey: keys.registrantKey });
    expect(res).toMatchObject({ label, sessionId });
    expect(res!.rotationAllowedFrom).toBe(res!.attachedAt); // enrolled with the name: no cooldown
    const body = calls[0]!.body as { deadline: string; signature: Hex };
    expect(calls[0]!.url).toBe(`http://mock/names/${label}/session/lookup`);
    const signer = await recoverTypedDataAddress({
      ...sessionLookupTypedData({ label, deadline: BigInt(body.deadline), chainId }),
      signature: body.signature,
    });
    expect(signer).toBe(keys.registrantAddress);
    // Short-lived.
    expect(Number(body.deadline) - Math.floor(Date.now() / 1000)).toBeLessThanOrEqual(600);
    // The public record says a session exists, never which.
    const pub = await services.api.getName(label);
    expect(pub?.worldIdSession).toBeTruthy();
    expect(JSON.stringify(pub)).not.toContain(sessionId);
  });

  it("refuses another key, and returns null for a name without a session", async () => {
    const label = uniqueLabel();
    await seedLinkedName(keys, label);
    const thief = keysFromMnemonic(generateMnemonic());
    await expect(lookupSession({ api: base.api, chainId, label, registrantKey: thief.registrantKey })).rejects.toMatchObject({ code: "bad_signature" });

    const bare = uniqueLabel();
    await claimName({ api: base.api, keys, chainId, label: bare });
    expect(await lookupSession({ api: base.api, chainId, label: bare, registrantKey: keys.registrantKey })).toBeNull();
  });

  it("a restored session makes the rotation path attested (after the cooldown for a late link)", () => {
    const name = { label: "alex", name: "alex.soapay.eth", at: 0 };
    expect(needsSessionRestore({ name })).toBe(true);
    expect(needsSessionRestore({ name, recovery: { kind: "world-id", at: 0, nullifier: "0x0a", attachedTo: "alex" } })).toBe(true);
    expect(needsSessionRestore({})).toBe(false);

    const enrolled = restoredRecovery({ label: "alex", sessionId: "session_ab", attachedAt: 100, rotationAllowedFrom: 100 });
    expect(enrolled).toEqual({ kind: "world-id", at: 100_000, sessionId: "session_ab", attachedTo: "alex", rotationAllowedFrom: 100, restored: true });
    expect(needsSessionRestore({ name, recovery: enrolled })).toBe(false);
    expect(rotationPathOf({ name, recovery: enrolled }, 200_000)).toBe("attested");

    const late = restoredRecovery({ label: "alex", sessionId: "session_ab", attachedAt: 100, rotationAllowedFrom: 100 + 72 * 3600 });
    expect(rotationPathOf({ name, recovery: late }, 200_000)).toBe("manual");
    expect(rotationPathOf({ name, recovery: late }, (100 + 72 * 3600) * 1000)).toBe("attested");
  });
});

describe("restored account (self-heal on Name settings)", () => {
  it("reads the session id back, stores it, and shows 'World ID link restored' once", async () => {
    const mnemonic = generateMnemonic();
    const keys = keysFromMnemonic(mnemonic);
    const label = uniqueLabel();
    const sessionId = await seedLinkedName(keys, label);
    const { services } = spied();

    const view = renderNameSettings(services, mnemonic, { name: { label, name: `${label}.soapay.eth`, at: Date.now() } });
    expect(await screen.findByTestId("worldid-restored", {}, { timeout: 10_000 })).toBeTruthy();
    await waitFor(() => expect(vaultData?.profile.recovery?.restoredNoticeShown).toBe(true));
    const rec = vaultData!.profile.recovery!;
    expect(rec).toMatchObject({ kind: "world-id", sessionId, attachedTo: label, restored: true });
    expect(rotationPathOf(vaultData!.profile)).toBe("attested");
    expect(screen.getByText(/World ID \(Proof of Human\) is linked to this name/)).toBeTruthy();

    // Once: a fresh Name settings view doesn't repeat it.
    view.unmount();
    render(
      <VaultProvider idleLockMs={0}>
        <ServicesProvider override={services}>
          <MemoryRouter>
            <UnlockedProbe>
              <NameSettings />
            </UnlockedProbe>
          </MemoryRouter>
        </ServicesProvider>
      </VaultProvider>,
    );
    expect(await screen.findByText(/World ID \(Proof of Human\) is linked to this name/, {}, { timeout: 10_000 })).toBeTruthy();
    expect(screen.queryByTestId("worldid-restored")).toBeNull();
  });

  it("does nothing for a name without a World ID session", async () => {
    const mnemonic = generateMnemonic();
    const keys = keysFromMnemonic(mnemonic);
    const label = uniqueLabel();
    await registerMetaAddress({ api: base.api, client: base.client, keys, chainId });
    await claimName({ api: base.api, keys, chainId, label });
    const { services, calls } = spied();
    renderNameSettings(services, mnemonic, { name: { label, name: `${label}.soapay.eth`, at: Date.now() } });
    expect(await screen.findByText(/No World ID session is linked/, {}, { timeout: 10_000 })).toBeTruthy();
    await waitFor(() => expect(calls.some((c) => c.url.endsWith(`/names/${label}`))).toBe(true));
    // No signature is spent when the public record shows no session.
    expect(calls.some((c) => c.url.endsWith("/session/lookup"))).toBe(false);
    expect(vaultData!.profile.recovery).toBeUndefined();
  });
});

/** Re-opens the vault created by an earlier render (same IndexedDB) with the test passphrase. */
function UnlockedProbe({ children }: { children: ReactNode }) {
  const vault = useVault();
  vaultData = vault.data ?? null;
  useEffect(() => {
    if (vault.status === "locked") void vault.unlock("correct horse battery staple");
  }, [vault]);
  return vault.status === "unlocked" ? <>{children}</> : null;
}

describe("onboarding with a name that already has World ID linked", () => {
  it("restores the link instead of asking for a second World ID session", async () => {
    const mnemonic = generateMnemonic();
    const keys = keysFromMnemonic(mnemonic);
    const label = uniqueLabel();
    const sessionId = await seedLinkedName(keys, label);
    const { services, calls } = spied();

    // Restored from the phrase, name step still to do (Name settings offers the same Name → Recovery steps).
    renderNameSettings(services, mnemonic, { nameSkipped: true });
    const user = userEvent.setup();
    const input = await screen.findByTestId("label-input", {}, { timeout: 10_000 });
    await user.type(input, label);
    expect(await screen.findByText(`${label}.soapay.eth is already yours.`, {}, { timeout: 10_000 })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Continue" }));

    const restore = await screen.findByTestId("restore-name", {}, { timeout: 10_000 });
    expect(screen.getByRole("heading", { name: "Restore your name" })).toBeTruthy();
    // No World ID flow is offered for an already-linked name.
    expect(screen.queryByRole("button", { name: /World ID/ })).toBeNull();
    await user.click(restore);

    expect(await screen.findByRole("heading", { name: `${label}.soapay.eth` }, { timeout: 10_000 })).toBeTruthy();
    await waitFor(() => expect(vaultData?.profile.recovery?.sessionId).toBe(sessionId));
    expect(vaultData!.profile.recovery).toMatchObject({ attachedTo: label, restored: true });
    expect(vaultData!.profile.recoverySkipped).not.toBe(true);
    expect(rotationPathOf(vaultData!.profile)).toBe("attested");

    // Never a second link: no attach, and the claim carried no World ID session.
    expect(calls.some((c) => c.url.endsWith(`/names/${label}/session`))).toBe(false);
    const claim = calls.find((c) => c.method === "POST" && c.url === "http://mock/names");
    expect(claim?.body?.worldIdSession).toBeUndefined();
    expect(calls.filter((c) => c.url.endsWith("/session/lookup")).length).toBeGreaterThanOrEqual(1);
  });
});
