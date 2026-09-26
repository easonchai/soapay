// D-44: the Keys step saves a recovery kit (download / copy / show), no memorise-quiz.
// D-45: no wallet-signature onboarding; older signature accounts still open and restore.
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SIGN_MESSAGE, keysFromMnemonic, keysFromSignature, validateMnemonic } from "@soapay/sdk";
import { privateKeyToAccount } from "viem/accounts";
import { InviteProvider } from "../src/hooks/useInvite.js";
import { Onboarding } from "../src/onboarding/Onboarding.js";
import { parseRecoveryKit, recoveryKitFilename, recoveryKitText } from "../src/onboarding/recoveryKit.js";
import { ServicesProvider, buildServices } from "../src/services/ServicesProvider.js";
import { deleteEnvelope } from "../src/vault/idb.js";
import { mockPasskey } from "../src/vault/passkey.js";
import { VaultProvider, useVault, type VaultApi } from "../src/vault/VaultProvider.js";
import { defaultSettings } from "../src/vault/types.js";

const services = buildServices({ ...defaultSettings(), apiUrl: "http://mock" }, true);
const M = "legal winner thank year wave sausage worth useful legal winner thank yellow";

function Probe({ vaultRef }: { vaultRef: { current: VaultApi | null } }) {
  vaultRef.current = useVault();
  return null;
}

function mount() {
  const vaultRef: { current: VaultApi | null } = { current: null };
  render(
    <VaultProvider passkey={mockPasskey()} idleLockMs={0}>
      <Probe vaultRef={vaultRef} />
      <ServicesProvider override={services}>
        <InviteProvider hash="#/">
          <Onboarding />
        </InviteProvider>
      </ServicesProvider>
    </VaultProvider>,
  );
  return vaultRef;
}

const continueButton = () => screen.getByRole("button", { name: "Continue" }) as HTMLButtonElement;
const saveBox = () => screen.getByLabelText("I saved my recovery kit somewhere safe");

beforeEach(async () => {
  await deleteEnvelope();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("recovery kit file", () => {
  it("holds the phrase, the pay name, the date and restore instructions, and no other secret", () => {
    const createdAt = new Date("2026-09-26T10:00:00Z");
    const text = recoveryKitText({ mnemonic: M, name: "alex.soapay.eth", createdAt });
    expect(text).toContain(M);
    expect(text).toContain("Pay name: alex.soapay.eth");
    expect(text).toContain("2026-09-26");
    expect(text).toContain("Losing the seed loses the funds");
    expect(text).toMatch(/Open the Soapay app and choose "Restore from recovery phrase"/);
    expect(text).toContain("Open recovery kit");
    expect(text).toContain("@soapay/sdk");
    expect(text).toContain("keysFromMnemonic");
    expect(text).toContain("m/5564'/1'/0'");
    expect(text).toContain("m/5564'/1'/1'");
    // Nothing derived: no private key, no address, no meta-address.
    const keys = keysFromMnemonic(M);
    expect(text).not.toMatch(/0x[0-9a-f]{40}/i);
    expect(text).not.toContain(keys.registrantKey.slice(2));
    expect(text).not.toContain(keys.registrantAddress.slice(2).toLowerCase());
    expect(text).not.toContain("st:eth:");
    // Only one line in it is a recovery phrase, and it's this one.
    expect(parseRecoveryKit(text)).toBe(M);
  });

  it("names the file after the pay name, or the date", () => {
    const d = new Date("2026-09-26T10:00:00Z");
    expect(recoveryKitFilename("alex.soapay.eth", d)).toBe("soapay-recovery-kit-alex.txt");
    expect(recoveryKitFilename(undefined, d)).toBe("soapay-recovery-kit-2026-09-26.txt");
  });

  it("parses a pasted phrase in any case and rejects text without a valid phrase", () => {
    expect(parseRecoveryKit(`  ${M.toUpperCase()}  `)).toBe(M);
    expect(parseRecoveryKit("hello world\nlegal winner thank year wave sausage worth useful legal winner thank thank")).toBeNull();
    expect(parseRecoveryKit("")).toBeNull();
  });
});

describe("Keys step: save your recovery kit", () => {
  async function toKit() {
    const user = userEvent.setup();
    mount();
    await user.click(screen.getByRole("button", { name: "Create a new account" }));
    // Steps swap through Presence/Fade, so the new step arrives a beat after the click.
    expect(await screen.findByRole("heading", { name: "Save your recovery kit" })).toBeTruthy();
    expect(screen.getByText("Losing the seed loses the funds.")).toBeTruthy();
    expect(screen.getByText(/You don't need to remember it/)).toBeTruthy();
    // No quiz, no hidden words list until "Show words".
    expect(screen.queryByLabelText(/^Word #/)).toBeNull();
    expect(screen.queryByRole("list", { name: "Recovery phrase" })).toBeNull();
    return user;
  }

  it("Continue needs an action AND the checkbox", async () => {
    const user = await toKit();
    expect(continueButton().disabled).toBe(true);
    await user.click(saveBox());
    // Ticking alone isn't enough.
    expect(continueButton().disabled).toBe(true);
    await user.click(screen.getByRole("button", { name: /Show words/ }));
    expect(continueButton().disabled).toBe(false);
    await user.click(saveBox());
    expect(continueButton().disabled).toBe(true);
  });

  it("download: a text file with the phrase counts as saved", async () => {
    let blob: Blob | null = null;
    let filename = "";
    Object.assign(URL, { createObjectURL: (b: Blob) => ((blob = b), "blob:kit"), revokeObjectURL: () => {} });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      filename = this.download;
      expect(this.href).toBe("blob:kit");
    });
    const user = await toKit();
    await user.click(screen.getByRole("button", { name: /Download recovery kit/ }));
    expect(filename).toMatch(/^soapay-recovery-kit-\d{4}-\d{2}-\d{2}\.txt$/);
    const text = await blob!.text();
    const phrase = parseRecoveryKit(text);
    expect(phrase && validateMnemonic(phrase)).toBe(true);
    expect(text).toContain("HOW TO RESTORE");
    expect(screen.getByTestId("kit-downloaded").textContent).toContain(filename);
    await user.click(saveBox());
    expect(continueButton().disabled).toBe(false);
  });

  it("copy: puts the phrase on the clipboard, hints to clear it, and counts as saved", async () => {
    const user = await toKit();
    await user.click(screen.getByRole("button", { name: "Copy phrase" }));
    const copied = await navigator.clipboard.readText();
    expect(validateMnemonic(copied)).toBe(true);
    expect(screen.getByTestId("kit-copied").textContent).toMatch(/clear your clipboard/);
    await user.click(saveBox());
    expect(continueButton().disabled).toBe(false);
  });

  it("continues to Lock, and going back doesn't show the phrase again", async () => {
    const user = await toKit();
    await user.click(screen.getByRole("button", { name: /Show words/ }));
    await user.click(saveBox());
    await user.click(continueButton());
    expect(await screen.findByRole("heading", { name: "Lock this device" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "← Back" }));
    expect(await screen.findByRole("heading", { name: "Recovery kit saved" })).toBeTruthy();
    expect(screen.queryByRole("list", { name: "Recovery phrase" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Download recovery kit/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Copy phrase" })).toBeNull();
    await user.click(continueButton());
    expect(await screen.findByRole("heading", { name: "Lock this device" })).toBeTruthy();
  });
});

describe("Restore step", () => {
  it("opens a recovery kit file and restores that phrase", async () => {
    const user = userEvent.setup();
    const vaultRef = mount();
    await user.click(screen.getByRole("button", { name: "Restore from recovery phrase" }));
    expect(await screen.findByRole("button", { name: /Open recovery kit/ })).toBeTruthy();
    const kit = recoveryKitText({ mnemonic: M, createdAt: new Date() });
    await user.upload(screen.getByTestId("kit-file"), new File([kit], "soapay-recovery-kit-2026-09-26.txt", { type: "text/plain" }));
    expect(await screen.findByRole("heading", { name: "Lock this device" })).toBeTruthy();
    const primary = await screen.findByRole("button", { name: "Use Face ID / fingerprint (passkey)" });
    await waitFor(() => expect((primary as HTMLButtonElement).disabled).toBe(false));
    await user.click(primary);
    expect(await screen.findByRole("heading", { name: "Publish your payment address" })).toBeTruthy();
    expect(vaultRef.current!.data!.mnemonic).toBe(M);
  });

  it("a file without a valid phrase shows an error and stays on Restore", async () => {
    const user = userEvent.setup();
    mount();
    await user.click(screen.getByRole("button", { name: "Restore from recovery phrase" }));
    await user.upload(await screen.findByTestId("kit-file"), new File(["just some notes"], "notes.txt", { type: "text/plain" }));
    expect((await screen.findByTestId("kit-file-error")).textContent).toMatch(/doesn't contain a valid recovery phrase/);
    expect(screen.getByRole("heading", { name: "Restore your account" })).toBeTruthy();
  });

  it("pasting the phrase still works", async () => {
    const user = userEvent.setup();
    mount();
    await user.click(screen.getByRole("button", { name: "Restore from recovery phrase" }));
    await user.type(await screen.findByLabelText("Recovery phrase"), M);
    await user.click(continueButton());
    expect(await screen.findByRole("heading", { name: "Lock this device" })).toBeTruthy();
  });

  it("the wallet-signature link lives on Restore only, and still recovers a signature account", async () => {
    const user = userEvent.setup();
    const vaultRef = mount();
    expect(screen.queryByTestId("use-wallet")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Create a new account" }));
    expect(await screen.findByRole("heading", { name: "Save your recovery kit" })).toBeTruthy();
    expect(screen.queryByTestId("use-wallet")).toBeNull();
    await user.click(screen.getByRole("button", { name: "← Back" }));
    await user.click(await screen.findByRole("button", { name: "Restore from recovery phrase" }));
    await user.click(await screen.findByRole("button", { name: "Made your account with a wallet signature?" }));
    expect(await screen.findByRole("heading", { name: "Restore from a wallet signature" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "← Back" }));
    expect(await screen.findByRole("heading", { name: "Restore your account" })).toBeTruthy();
    await user.click(screen.getByTestId("use-wallet"));
    await user.click(await screen.findByRole("button", { name: "Sign with the demo EOA" }));
    expect(await screen.findByRole("heading", { name: "Lock this device" })).toBeTruthy();
    const primary = await screen.findByRole("button", { name: "Use Face ID / fingerprint (passkey)" });
    await waitFor(() => expect((primary as HTMLButtonElement).disabled).toBe(false));
    await user.click(primary);
    expect(await screen.findByRole("heading", { name: "Publish your payment address" })).toBeTruthy();
    expect(vaultRef.current!.data!.walletKeys?.kind).toBe("wallet-signature");
    expect(vaultRef.current!.data!.mnemonic).toBe("");
  });
});

describe("existing wallet-signature vaults (D-45 keeps them working)", () => {
  const eoa = privateKeyToAccount("0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba");

  it("a passphrase-locked signature vault still unlocks to the same keys", async () => {
    const signature = await eoa.signMessage({ message: SIGN_MESSAGE });
    const secret = { kind: "wallet-signature" as const, signature, wallet: eoa.address };
    const vaultRef: { current: VaultApi | null } = { current: null };
    render(
      <VaultProvider passkey={mockPasskey()} idleLockMs={0}>
        <Probe vaultRef={vaultRef} />
      </VaultProvider>,
    );
    await waitFor(() => expect(vaultRef.current?.status).toBe("empty"));
    await act(() => vaultRef.current!.create(secret, "correct horse battery"));
    act(() => vaultRef.current!.lock());
    await waitFor(() => expect(vaultRef.current?.status).toBe("locked"));
    await act(() => vaultRef.current!.unlock("correct horse battery"));
    expect(vaultRef.current!.status).toBe("unlocked");
    expect(vaultRef.current!.data!.walletKeys).toEqual(secret);
    expect(vaultRef.current!.keys).toEqual(keysFromSignature(signature));
  });
});
