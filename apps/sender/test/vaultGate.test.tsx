import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { VaultGate } from "../src/pages/VaultGate.js";

afterEach(cleanup);

describe("VaultGate", () => {
  it("locked with a device key: one pulsing primary button, and it unlocks", () => {
    const onUnlock = vi.fn();
    render(<VaultGate phase="locked" vaultMode="device" minPassphrase={10} error={null} onCreate={() => {}} onUnlock={onUnlock} />);
    const btn = screen.getByRole("button", { name: /unlock on this device/i });
    expect(btn.className).toContain("pulse");
    expect(screen.queryByLabelText(/passphrase/i)).toBeNull();
    fireEvent.click(btn);
    expect(onUnlock).toHaveBeenCalledWith();
  });

  it("locked with a passphrase: field + Unlock, submits the passphrase", () => {
    const onUnlock = vi.fn();
    render(<VaultGate phase="locked" vaultMode="passphrase" minPassphrase={10} error={null} onCreate={() => {}} onUnlock={onUnlock} />);
    const field = screen.getByLabelText(/^passphrase$/i);
    fireEvent.change(field, { target: { value: "correct horse battery" } });
    fireEvent.click(screen.getByRole("button", { name: /^unlock$/i }));
    expect(onUnlock).toHaveBeenCalledWith("correct horse battery");
  });

  it("new vault: two options; Create is enabled for device key, and for a long-enough passphrase", () => {
    const onCreate = vi.fn();
    render(<VaultGate phase="new" vaultMode={null} minPassphrase={10} error={null} onCreate={onCreate} onUnlock={() => {}} />);
    const create = screen.getByRole("button", { name: /create vault/i });
    expect(create).not.toBeDisabled();
    fireEvent.click(create);
    expect(onCreate).toHaveBeenCalledWith("device", undefined);

    fireEvent.click(screen.getByRole("radio", { name: /passphrase/i }));
    expect(create).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/new passphrase/i), { target: { value: "short" } });
    expect(create).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/new passphrase/i), { target: { value: "long enough passphrase" } });
    expect(create).not.toBeDisabled();
    fireEvent.click(create);
    expect(onCreate).toHaveBeenLastCalledWith("passphrase", "long enough passphrase");
  });
});
