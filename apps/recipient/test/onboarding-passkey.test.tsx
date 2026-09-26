// D-35: the Lock step creates a passkey (WebAuthn PRF) by default and falls back to a passphrase.
// CK's steps stay the same: Keys → Lock → Register → Name → Recovery → Share.
import { act } from "react";
import { beforeEach, describe, expect, it } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { generateMnemonic } from "@soapay/sdk";
import { InviteProvider } from "../src/hooks/useInvite.js";
import { Onboarding } from "../src/onboarding/Onboarding.js";
import { Unlock } from "../src/screens/Unlock.js";
import { ServicesProvider, buildServices } from "../src/services/ServicesProvider.js";
import { deleteEnvelope, loadEnvelope } from "../src/vault/idb.js";
import { PasskeyUnsupportedError, mockPasskey, type PasskeyAuthenticator } from "../src/vault/passkey.js";
import { isPasskeyEnvelope } from "../src/vault/passkeyCrypto.js";
import { VaultProvider, useVault, type VaultApi } from "../src/vault/VaultProvider.js";
import { defaultSettings } from "../src/vault/types.js";

const services = buildServices({ ...defaultSettings(), apiUrl: "http://mock" }, true);

/** A mocked PRF passkey that counts prompts. `prf: false` = the authenticator can't do PRF. */
function fakePasskey({ available = true, prf = true } = {}) {
  const inner = mockPasskey();
  const calls = { register: 0, evaluate: 0 };
  const pk: PasskeyAuthenticator = {
    mock: true,
    available: async () => available,
    register: async (salt) => {
      calls.register++;
      if (!prf) throw new PasskeyUnsupportedError();
      return inner.register(salt);
    },
    evaluate: async (id, salt) => {
      calls.evaluate++;
      return inner.evaluate(id, salt);
    },
  };
  return { pk, calls };
}

function mount(pk: PasskeyAuthenticator) {
  return render(
    <VaultProvider passkey={pk} idleLockMs={0}>
      <ServicesProvider override={services}>
        <InviteProvider hash="#/">
          <Onboarding />
        </InviteProvider>
      </ServicesProvider>
    </VaultProvider>,
  );
}

/** Welcome → Keys (save the recovery kit: show the words, tick the box; no quiz, D-44) → the Lock step. */
async function throughKeys(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "Create a new account" }));
  expect(screen.getByText(/the one key to every payment/)).toBeTruthy();
  expect(screen.getByText("Losing the seed loses the funds.")).toBeTruthy();
  await user.click(screen.getByRole("button", { name: /Show words/ }));
  const list = screen.getByRole("list", { name: "Recovery phrase" });
  expect(within(list).getAllByRole("listitem")).toHaveLength(12);
  await user.click(screen.getByLabelText("I saved my recovery kit somewhere safe"));
  await user.click(screen.getByRole("button", { name: "Continue" }));
  expect(await screen.findByRole("heading", { name: "Lock this device" })).toBeTruthy();
}

beforeEach(async () => {
  await deleteEnvelope();
});

describe("onboarding Lock step with a passkey", () => {
  it("welcome keeps the two buttons and no longer offers a wallet signature (D-45)", () => {
    mount(fakePasskey().pk);
    expect(screen.getByRole("heading", { name: "Get paid without broadcasting your balance" })).toBeTruthy();
    expect(screen.getByText(/You get one private key/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Create a new account" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Restore from recovery phrase" })).toBeTruthy();
    expect(screen.queryByTestId("use-wallet")).toBeNull();
    expect(screen.queryByText(/wallet signature/i)).toBeNull();
    expect(document.querySelector("details")).toBeNull();
  });

  it("create → passkey lock → register step reached, vault sealed under the passkey", async () => {
    const { pk, calls } = fakePasskey();
    mount(pk);
    const user = userEvent.setup();
    await throughKeys(user);
    const primary = await screen.findByRole("button", { name: "Use Face ID / fingerprint (passkey)" });
    await waitFor(() => expect((primary as HTMLButtonElement).disabled).toBe(false));
    await user.click(primary);
    expect(await screen.findByRole("heading", { name: "Publish your payment address" })).toBeTruthy();
    expect(calls.register).toBe(1);
    const env = await loadEnvelope();
    expect(isPasskeyEnvelope(env)).toBe(true);
  });

  it("PRF unsupported: falls back to the passphrase form, which still reaches register", async () => {
    const { pk } = fakePasskey({ prf: false });
    mount(pk);
    const user = userEvent.setup();
    await throughKeys(user);
    const primary = await screen.findByRole("button", { name: "Use Face ID / fingerprint (passkey)" });
    await waitFor(() => expect((primary as HTMLButtonElement).disabled).toBe(false));
    await user.click(primary);
    expect((await screen.findByTestId("passkey-fallback")).textContent).toMatch(/Set a passphrase instead/);
    // No passkey to go back to once PRF is known to be missing.
    expect(screen.queryByRole("button", { name: "Use a passkey instead" })).toBeNull();
    await user.type(screen.getByLabelText("Passphrase"), "correct horse battery");
    await user.type(screen.getByLabelText("Repeat passphrase"), "correct horse battery");
    await user.click(screen.getByRole("button", { name: "Encrypt and continue" }));
    expect(await screen.findByRole("heading", { name: "Publish your payment address" }, { timeout: 20_000 })).toBeTruthy();
    expect(isPasskeyEnvelope(await loadEnvelope())).toBe(false);
  });

  it("no WebAuthn at all: goes straight to the passphrase form", async () => {
    const { pk, calls } = fakePasskey({ available: false });
    mount(pk);
    const user = userEvent.setup();
    await throughKeys(user);
    expect((await screen.findByTestId("passkey-fallback")).textContent).toMatch(/can't use a passkey/);
    expect(screen.getByRole("button", { name: "Encrypt and continue" })).toBeTruthy();
    expect(calls.register).toBe(0);
  });

  it("the user can pick the passphrase instead, and switch back", async () => {
    mount(fakePasskey().pk);
    const user = userEvent.setup();
    await throughKeys(user);
    await user.click(await screen.findByRole("button", { name: "Use a passphrase instead" }));
    expect(screen.getByRole("button", { name: "Encrypt and continue" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Use a passkey instead" }));
    expect(screen.getByRole("button", { name: "Use Face ID / fingerprint (passkey)" })).toBeTruthy();
  });
});

describe("unlock and re-lock", () => {
  function Harness({ vaultRef }: { vaultRef: { current: VaultApi | null } }) {
    const v = useVault();
    vaultRef.current = v;
    return v.status === "locked" ? <Unlock /> : <span data-testid="status">{v.status}</span>;
  }

  it("a passkey vault unlocks with one passkey prompt; it can switch to a passphrase", async () => {
    const { pk, calls } = fakePasskey();
    const vaultRef: { current: VaultApi | null } = { current: null };
    render(
      <VaultProvider passkey={pk} idleLockMs={0}>
        <Harness vaultRef={vaultRef} />
      </VaultProvider>,
    );
    await waitFor(() => expect(vaultRef.current?.status).toBe("empty"));
    const m = generateMnemonic();
    await act(() => vaultRef.current!.createWithPasskey(m));
    expect(vaultRef.current!.lockKind).toBe("passkey");
    act(() => vaultRef.current!.lock());

    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Unlock with passkey" }));
    await waitFor(() => expect(vaultRef.current?.status).toBe("unlocked"));
    expect(calls.evaluate).toBe(1);
    expect(vaultRef.current!.data!.mnemonic).toBe(m);

    // Updates keep sealing under the passkey.
    await act(() => vaultRef.current!.update((d) => ({ ...d, profile: { ...d.profile, onboardedAt: 1 } })));
    expect(isPasskeyEnvelope(await loadEnvelope())).toBe(true);

    // Settings: switch to a passphrase; the same data now opens with it.
    await act(() => vaultRef.current!.relock({ kind: "passphrase", passphrase: "correct horse battery" }));
    expect(vaultRef.current!.lockKind).toBe("passphrase");
    expect(isPasskeyEnvelope(await loadEnvelope())).toBe(false);
    act(() => vaultRef.current!.lock());
    await act(() => vaultRef.current!.unlock("correct horse battery"));
    expect(vaultRef.current!.data!.profile.onboardedAt).toBe(1);
  });
});
