import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { VaultGate } from "../src/pages/VaultGate.js";

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
/** The gate fades its content, then flows the halo out (~1.6 s) before handing over. */
const settle = () => vi.advanceTimersByTime(2000);

describe("VaultGate", () => {
  it("locked with a device key: one pulsing primary button, and it unlocks", () => {
    const onUnlock = vi.fn();
    render(<VaultGate phase="locked" vaultMode="device" minPassphrase={10} error={null} onCreate={() => {}} onUnlock={onUnlock} />);
    const btn = screen.getByRole("button", { name: /unlock on this device/i });
    expect(btn.className).toContain("pulse");
    expect(screen.queryByLabelText(/passphrase/i)).toBeNull();
    fireEvent.click(btn);
    expect(onUnlock).not.toHaveBeenCalled();
    settle();
    expect(onUnlock).toHaveBeenCalledWith();
  });

  it("locked with a passphrase: field + Unlock, submits the passphrase", () => {
    const onUnlock = vi.fn();
    render(<VaultGate phase="locked" vaultMode="passphrase" minPassphrase={10} error={null} onCreate={() => {}} onUnlock={onUnlock} />);
    const field = screen.getByLabelText(/^passphrase$/i);
    fireEvent.change(field, { target: { value: "correct horse battery" } });
    fireEvent.click(screen.getByRole("button", { name: /^unlock$/i }));
    settle();
    expect(onUnlock).toHaveBeenCalledWith("correct horse battery");
  });

  it("new vault: two options; Create is enabled for device key, and for a long-enough passphrase", () => {
    const onCreate = vi.fn();
    render(<VaultGate phase="new" vaultMode={null} minPassphrase={10} error={null} onCreate={onCreate} onUnlock={() => {}} />);
    const create = screen.getByRole("button", { name: /create vault/i });
    expect(create).not.toBeDisabled();
    fireEvent.click(create);
    settle();
    expect(onCreate).toHaveBeenCalledWith("device", undefined);
    cleanup();
    // a fresh gate for the passphrase path (the first one is now leaving)
    render(<VaultGate phase="new" vaultMode={null} minPassphrase={10} error={null} onCreate={onCreate} onUnlock={() => {}} />);
    const create2 = screen.getByRole("button", { name: /create vault/i });

    fireEvent.click(screen.getByRole("radio", { name: /passphrase/i }));
    expect(create2).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/new passphrase/i), { target: { value: "short" } });
    expect(create2).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/new passphrase/i), { target: { value: "long enough passphrase" } });
    expect(create2).not.toBeDisabled();
    fireEvent.click(create2);
    settle();
    expect(onCreate).toHaveBeenLastCalledWith("passphrase", "long enough passphrase");
  });

  it("wallet signature is the default when the wallet can lock the vault, and passphrase when it can't", () => {
    const onCreate = vi.fn();
    const { rerender } = render(
      <VaultGate phase="new" vaultMode={null} minPassphrase={10} error={null} walletLock="available" backupEnabled onCreate={onCreate} onUnlock={() => {}} />,
    );
    expect(screen.getByRole("radio", { name: /wallet signature/i })).toHaveAttribute("aria-checked", "true");
    // Signing twice showed a non-deterministic wallet: the option goes and the passphrase is selected.
    rerender(
      <VaultGate phase="new" vaultMode={null} minPassphrase={10} error="signs differently" walletLock="unavailable" backupEnabled onCreate={onCreate} onUnlock={() => {}} />,
    );
    expect(screen.queryByRole("radio", { name: /wallet signature/i })).toBeNull();
    expect(screen.getByRole("radio", { name: /passphrase/i })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByLabelText(/new passphrase/i)).toBeInTheDocument();
  });

  it("restore: one button for a wallet backup, and Start fresh", () => {
    const onRestore = vi.fn();
    const onStartFresh = vi.fn();
    render(
      <VaultGate
        phase="restore"
        vaultMode={null}
        minPassphrase={10}
        error={null}
        restore={{ mode: "wallet", version: 3, updatedAt: 1_800_000_000, address: "0x0000000000000000000000000000000000000001" }}
        onRestore={onRestore}
        onStartFresh={onStartFresh}
        onCreate={() => {}}
        onUnlock={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /restore with wallet/i }));
    settle();
    expect(onRestore).toHaveBeenCalledWith();
    fireEvent.click(screen.getByRole("button", { name: /start a new vault instead/i }));
    expect(onStartFresh).toHaveBeenCalled();
  });

  it("locked wallet vault: unlock with the wallet", () => {
    const onUnlock = vi.fn();
    render(<VaultGate phase="locked" vaultMode="wallet" minPassphrase={10} error={null} onCreate={() => {}} onUnlock={onUnlock} />);
    fireEvent.click(screen.getByRole("button", { name: /unlock with wallet/i }));
    settle();
    expect(onUnlock).toHaveBeenCalledWith();
  });
});
