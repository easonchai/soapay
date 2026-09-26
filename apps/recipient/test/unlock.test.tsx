// The Unlock screen on the gate pattern: halo, one pulsing primary, and the vault opens on submit.
import { act } from "react";
import { beforeEach, describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { generateMnemonic } from "@soapay/sdk";
import { Unlock } from "../src/screens/Unlock.js";
import { deleteEnvelope } from "../src/vault/idb.js";
import { mockPasskey } from "../src/vault/passkey.js";
import { VaultProvider, useVault, type VaultApi } from "../src/vault/VaultProvider.js";

const PASS = "correct horse battery";

/** Renders Unlock while the vault is locked, and exposes the vault API to the test. */
function Harness({ vaultRef }: { vaultRef: { current: VaultApi | null } }) {
  const v = useVault();
  vaultRef.current = v;
  return v.status === "locked" ? <Unlock /> : <span data-testid="status">{v.status}</span>;
}

/** A passphrase-locked vault, freshly created and then locked. */
async function lockedVault() {
  const vaultRef: { current: VaultApi | null } = { current: null };
  render(
    <VaultProvider passkey={mockPasskey()} idleLockMs={0}>
      <Harness vaultRef={vaultRef} />
    </VaultProvider>,
  );
  await waitFor(() => expect(vaultRef.current?.status).toBe("empty"));
  await act(() => vaultRef.current!.create(generateMnemonic(), PASS));
  act(() => vaultRef.current!.lock());
  await waitFor(() => expect(vaultRef.current?.status).toBe("locked"));
  return vaultRef;
}

beforeEach(async () => {
  await deleteEnvelope();
});

describe("Unlock (passphrase mode)", () => {
  it("is a gate: halo canvas, pulsing primary, and the passphrase field pulses while empty", async () => {
    await lockedVault();
    expect(screen.getByRole("heading", { name: "Unlock Soapay" })).toBeTruthy();
    expect(document.querySelector(".gate .halo canvas.dots")).toBeTruthy();
    const primary = screen.getByRole("button", { name: "Unlock" }) as HTMLButtonElement;
    expect(primary.classList.contains("pulse")).toBe(true);
    expect(primary.disabled).toBe(true);
    const field = screen.getByLabelText("Passphrase") as HTMLInputElement;
    expect(field.classList.contains("pulse-field")).toBe(true);
    // The restore path is still offered under the card.
    expect(screen.getByRole("button", { name: /Forgot the passphrase\?/ })).toBeTruthy();
  });

  it("typing a passphrase and submitting unlocks the vault", async () => {
    const vaultRef = await lockedVault();
    const user = userEvent.setup();
    const field = screen.getByLabelText("Passphrase") as HTMLInputElement;
    await user.type(field, PASS);
    expect(field.classList.contains("pulse-field")).toBe(false);
    await user.click(screen.getByRole("button", { name: "Unlock" }));
    await waitFor(() => expect(vaultRef.current?.status).toBe("unlocked"));
    expect(screen.getByTestId("status").textContent).toBe("unlocked");
  });

  it("a wrong passphrase shows the error and stays on the gate", async () => {
    const vaultRef = await lockedVault();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Passphrase"), "not it");
    await user.click(screen.getByRole("button", { name: "Unlock" }));
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(vaultRef.current?.status).toBe("locked");
    expect(screen.getByRole("button", { name: "Unlock" })).toBeTruthy();
  });

  it("the restore link asks for confirmation before wiping", async () => {
    await lockedVault();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /Forgot the passphrase\?/ }));
    expect(screen.getByRole("button", { name: "Delete and restore" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("button", { name: /Forgot the passphrase\?/ })).toBeTruthy();
  });
});
