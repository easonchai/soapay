// Owner decision 2026-09-26: a wallet-signature account rotates by moving to a recovery-phrase account.
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { generateMnemonic, keysFromMnemonic, keysFromSignature, SIGN_MESSAGE, validateMnemonic } from "@soapay/sdk";
import { privateKeyToAccount } from "viem/accounts";
import { keyRing } from "../src/features/rotation/keys.js";
import { prepareRotation } from "../src/features/rotation/flow.js";
import { MoveToPhrase } from "../src/screens/NameSettings.js";
import { adoptRecoveryPhrase, hasRecoveryPhrase, newVaultData, phraseOffsetOf, vaultKeys } from "../src/vault/types.js";

const eoa = privateKeyToAccount("0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba");

async function walletVault() {
  const signature = await eoa.signMessage({ message: SIGN_MESSAGE });
  return newVaultData({ kind: "wallet-signature", signature, wallet: eoa.address });
}

describe("moving a wallet-signature account to a recovery phrase", () => {
  it("adopts a phrase: wallet keys stay generation 0, the phrase supplies generation 1 onward", async () => {
    const data = await walletVault();
    expect(hasRecoveryPhrase(data)).toBe(false);
    const m = generateMnemonic();
    const moved = adoptRecoveryPhrase(data, m);
    expect(hasRecoveryPhrase(moved)).toBe(true);
    expect(phraseOffsetOf(moved)).toBe(1);
    // Generation 0 (and the registrant that controls the name) is unchanged.
    const gen0 = vaultKeys(moved);
    expect(gen0).toEqual(keysFromSignature(data.walletKeys!.signature));

    const ring = keyRing(moved.mnemonic, 1, gen0, phraseOffsetOf(moved));
    expect(ring.all[0]).toEqual(gen0);
    expect(ring.all[1]!.metaAddressURI).toBe(keysFromMnemonic(m).metaAddressURI);
    expect(ring.current.registrantAddress).toBe(gen0.registrantAddress);
  });

  it("the rotation draft points the name at the phrase's keys", async () => {
    const data = adoptRecoveryPhrase(await walletVault(), generateMnemonic());
    const gen0 = vaultKeys(data);
    const d = prepareRotation({ mnemonic: data.mnemonic, label: "alex", currentGeneration: 0, oldMeta: gen0.metaAddressURI, phraseOffset: 1 });
    expect(d.generation).toBe(1);
    expect(d.newMeta).toBe(keysFromMnemonic(data.mnemonic).metaAddressURI.toLowerCase());
    expect(d.newMeta).not.toBe(d.oldMeta);
  });

  it("refuses phrase accounts, a second phrase, and invalid phrases", async () => {
    const m = generateMnemonic();
    expect(() => adoptRecoveryPhrase(newVaultData(m), generateMnemonic())).toThrow(/already uses/);
    const moved = adoptRecoveryPhrase(await walletVault(), m);
    expect(() => adoptRecoveryPhrase(moved, generateMnemonic())).toThrow(/already set up/);
    const fresh = await walletVault();
    expect(() => adoptRecoveryPhrase(fresh, "not a phrase")).toThrow(/valid recovery phrase/);
  });

  it("guides through create phrase → optional Exit/Send → rotate", async () => {
    const onAdopt = vi.fn(async () => {});
    render(
      <MemoryRouter>
        <MoveToPhrase canRotate={false} onAdopt={onAdopt} />
      </MemoryRouter>,
    );
    expect(screen.getByText(/Rotating means moving to a recovery-phrase account/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Exit" }).getAttribute("href")).toBe("/exit");
    expect(screen.getByRole("link", { name: "Send" }).getAttribute("href")).toBe("/spend");
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Create recovery phrase" }));
    const phrase = screen.getByTestId("new-phrase").textContent!;
    expect(validateMnemonic(phrase)).toBe(true);
    const use = screen.getByRole("button", { name: "Use this phrase for my new keys" });
    expect((use as HTMLButtonElement).disabled).toBe(true);
    await user.click(screen.getByLabelText("I wrote down all 12 words, in order"));
    await user.click(use);
    expect(onAdopt).toHaveBeenCalledWith(phrase);
  });

  it("shows step 1 as done once the phrase is set", () => {
    render(
      <MemoryRouter>
        <MoveToPhrase canRotate onAdopt={async () => {}} />
      </MemoryRouter>,
    );
    expect(screen.queryByRole("button", { name: "Create recovery phrase" })).toBeNull();
    expect(screen.getByText("Done")).toBeTruthy();
  });
});
