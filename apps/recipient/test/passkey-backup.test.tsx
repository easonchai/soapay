// D-63: passkey-synced vault backup. Keys derive from the passkey's PRF output alone; the vault is
// uploaded encrypted after writes; "Unlock with passkey" on an empty browser brings it back.
import { beforeEach, describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { generateMnemonic } from "@soapay/sdk";
import { getAddress, recoverMessageAddress } from "viem";
import { InviteProvider } from "../src/hooks/useInvite.js";
import { Onboarding } from "../src/onboarding/Onboarding.js";
import { BackupSetting } from "../src/screens/BackupSetting.js";
import { ServicesProvider, buildServices } from "../src/services/ServicesProvider.js";
import { resetMockBackups } from "../src/services/mock.js";
import { ApiError } from "../src/api/client.js";
import {
  BackupDecryptError,
  backupSignerKey,
  backupSigningMessage,
  deriveBackupKeys,
} from "../src/vault/backup.js";
import { BackupSync, uploadBackup } from "../src/vault/BackupSync.js";
import { deleteEnvelope, loadEnvelope } from "../src/vault/idb.js";
import { mockPasskey, type PasskeyAuthenticator } from "../src/vault/passkey.js";
import { PRF_SALT, createPasskeyVault, isPasskeyEnvelope } from "../src/vault/passkeyCrypto.js";
import { VaultProvider, useVault, type VaultApi } from "../src/vault/VaultProvider.js";
import { defaultSettings, newVaultData } from "../src/vault/types.js";

const services = buildServices({ ...defaultSettings(), apiUrl: "http://mock" }, true);
const prfA = new Uint8Array(32).fill(7);
const prfB = new Uint8Array(32).fill(8);

beforeEach(async () => {
  await deleteEnvelope();
  resetMockBackups();
});

describe("backup key derivation", () => {
  it("is deterministic for a PRF output and differs between passkeys", async () => {
    const a1 = await deriveBackupKeys(prfA);
    const a2 = await deriveBackupKeys(new Uint8Array(prfA));
    const b = await deriveBackupKeys(prfB);
    expect(a1.address).toBe(a2.address);
    expect(a1.address).toBe(getAddress(a1.address));
    expect(b.address).not.toBe(a1.address);
    const k = BigInt(await backupSignerKey(prfA));
    expect(k > 0n).toBe(true);
  });

  it("doesn't depend on local vault state (per-vault salt, credential id, recovery phrase)", async () => {
    const before = (await deriveBackupKeys(prfA)).address;
    // Two vaults under the same PRF output get different random HKDF salts; the backup address doesn't move.
    const v1 = await createPasskeyVault(newVaultData(generateMnemonic()), new Uint8Array([1, 2, 3]), prfA);
    const v2 = await createPasskeyVault(newVaultData(generateMnemonic()), new Uint8Array([4, 5, 6]), prfA);
    expect(v1.params.salt).not.toBe(v2.params.salt);
    expect((await deriveBackupKeys(prfA)).address).toBe(before);
  });

  it("signs the API's exact message with the backup address", async () => {
    const keys = await deriveBackupKeys(prfA);
    const message = backupSigningMessage(keys.address, 3, "Y2lwaGVy");
    expect(message).toMatch(new RegExp(`^soapay-backup:v1:${keys.address}:3:0x[0-9a-f]{64}$`));
    const sig = await keys.signMessage(message);
    expect(await recoverMessageAddress({ message, signature: sig })).toBe(keys.address);
  });
});

describe("backup encryption", () => {
  it("round-trips, and fails for another version, another passkey or tampering", async () => {
    const keys = await deriveBackupKeys(prfA);
    const data = newVaultData(generateMnemonic());
    const ct = await keys.seal(data, 4);
    expect(ct).not.toContain(data.mnemonic.split(" ")[0]!);
    expect(await keys.open(ct, 4)).toEqual(data);
    await expect(keys.open(ct, 5)).rejects.toBeInstanceOf(BackupDecryptError);
    await expect((await deriveBackupKeys(prfB)).open(ct, 4)).rejects.toBeInstanceOf(BackupDecryptError);
    const bytes = Uint8Array.from(atob(ct), (c) => c.charCodeAt(0));
    bytes[bytes.length - 1]! ^= 1;
    await expect(keys.open(btoa(String.fromCharCode(...bytes)), 4)).rejects.toBeInstanceOf(BackupDecryptError);
  });

  it("uses a fresh IV per upload", async () => {
    const keys = await deriveBackupKeys(prfA);
    const data = newVaultData(generateMnemonic());
    expect(await keys.seal(data, 1)).not.toBe(await keys.seal(data, 1));
  });
});

describe("upload versions", () => {
  it("increments the version and retries once past a 409 from another device", async () => {
    const keys = await deriveBackupKeys(prfA);
    const data = newVaultData(generateMnemonic());
    const first = await uploadBackup(services.api, keys, data);
    expect(first.version).toBe(1);
    // Another device with the same passkey jumped to version 5.
    const ct = await keys.seal({ other: true }, 5);
    await services.api.putBackup(keys.address, { version: 5, ciphertext: ct, signature: await keys.signMessage(backupSigningMessage(keys.address, 5, ct)) });
    // This device still thinks it's at 1: 409 → refetch → 6.
    const second = await uploadBackup(services.api, keys, { ...data, backup: first });
    expect(second.version).toBe(6);
    const stored = await services.api.getBackup(keys.address);
    expect(stored?.version).toBe(6);
    expect(await keys.open(stored!.ciphertext, 6)).toEqual(data);
  });

  it("the mock API rejects a stale version and a wrong signer", async () => {
    const keys = await deriveBackupKeys(prfA);
    const other = await deriveBackupKeys(prfB);
    const ct = await keys.seal({ a: 1 }, 1);
    await services.api.putBackup(keys.address, { version: 1, ciphertext: ct, signature: await keys.signMessage(backupSigningMessage(keys.address, 1, ct)) });
    const stale = services.api.putBackup(keys.address, { version: 1, ciphertext: ct, signature: await keys.signMessage(backupSigningMessage(keys.address, 1, ct)) });
    await expect(stale).rejects.toMatchObject({ status: 409, code: "stale_version" });
    const forged = services.api.putBackup(keys.address, { version: 2, ciphertext: ct, signature: await other.signMessage(backupSigningMessage(keys.address, 2, ct)) });
    await expect(forged).rejects.toBeInstanceOf(ApiError);
    expect(await services.api.getBackup(other.address)).toBeNull();
  });
});

/** Mock passkey with discovery (a synced password manager). `available: false` = no PRF here. */
function fakePasskey({ available = true, discover = true } = {}): PasskeyAuthenticator {
  const inner = mockPasskey();
  return {
    mock: true,
    available: async () => available,
    register: (salt, account) => inner.register(salt, account),
    evaluate: (id, salt) => inner.evaluate(id, salt),
    ...(discover ? { discover: (salt: Uint8Array<ArrayBuffer>) => inner.discover!(salt) } : {}),
  };
}

function Probe({ vaultRef }: { vaultRef: { current: VaultApi | null } }) {
  const v = useVault();
  vaultRef.current = v;
  return (
    <>
      <span data-testid="status">{v.status}</span>
      {v.status === "empty" && <Onboarding />}
      {v.status === "unlocked" && <BackupSetting />}
    </>
  );
}

function mount(pk: PasskeyAuthenticator) {
  const vaultRef: { current: VaultApi | null } = { current: null };
  const r = render(
    <VaultProvider passkey={pk} idleLockMs={0}>
      <ServicesProvider override={services}>
        <BackupSync debounceMs={0}>
          <InviteProvider hash="#/">
            <Probe vaultRef={vaultRef} />
          </InviteProvider>
        </BackupSync>
      </ServicesProvider>
    </VaultProvider>,
  );
  return { ...r, vaultRef };
}

describe("sync and restore", () => {
  it("syncs after a write, then restores the whole vault on an empty browser with the passkey", async () => {
    const pk = fakePasskey();
    const first = mount(pk);
    await waitFor(() => expect(first.vaultRef.current?.status).toBe("empty"));
    const mnemonic = generateMnemonic();
    await first.vaultRef.current!.createWithPasskey(mnemonic);
    await first.vaultRef.current!.update((d) => ({
      ...d,
      profile: { ...d.profile, name: { label: "dana", name: "dana.soapay.eth", at: 1 }, onboardedAt: 2 },
      settings: { ...d.settings, knownPayers: [{ address: "0x5ca1ab1e00000000000000000000000000000e3e", name: "Acme" }] },
    }));
    await waitFor(() => expect(screen.getByTestId("backup-status").textContent).toMatch(/^Backed up/), { timeout: 10_000 });
    const address = first.vaultRef.current!.backupKeys!.address;
    const version = first.vaultRef.current!.data!.backup!.version;
    expect(version).toBeGreaterThanOrEqual(1);
    expect((await services.api.getBackup(address))?.version).toBe(version);
    const credentialId = (await loadEnvelope() as { lock: { credentialId: string } }).lock.credentialId;
    first.unmount();

    // "Clear site data": the local vault is gone; the passkey (synced) and the API backup remain.
    await deleteEnvelope();
    const second = mount(pk);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Unlock with passkey" }));
    await waitFor(() => expect(second.vaultRef.current?.status).toBe("unlocked"));
    const v = second.vaultRef.current!;
    expect(v.data!.mnemonic).toBe(mnemonic);
    expect(v.data!.profile.name?.name).toBe("dana.soapay.eth");
    expect(v.data!.settings.knownPayers[0]?.name).toBe("Acme");
    expect(v.data!.backup).toMatchObject({ address, version });
    expect(v.lockKind).toBe("passkey");
    // Re-wrapped locally under the same passkey, so a normal unlock works on this browser.
    const env = await loadEnvelope();
    expect(isPasskeyEnvelope(env)).toBe(true);
    expect((env as { lock: { credentialId: string } }).lock.credentialId).toBe(credentialId);
    v.lock();
    await waitFor(() => expect(second.vaultRef.current?.status).toBe("locked"));
    await second.vaultRef.current!.unlockWithPasskey();
    await waitFor(() => expect(second.vaultRef.current!.data?.mnemonic).toBe(mnemonic));
    await new Promise((r) => setTimeout(r, 50));
    // Nothing changed since the restore: no re-upload.
    expect((await services.api.getBackup(address))?.version).toBe(version);
  });

  it("no backup for the passkey: says so and offers the recovery phrase", async () => {
    const pk = fakePasskey();
    const { vaultRef, unmount } = mount(pk);
    await waitFor(() => expect(vaultRef.current?.status).toBe("empty"));
    // A passkey exists (registered here) but never synced a backup.
    await pk.register(new Uint8Array(PRF_SALT));
    unmount();
    mount(pk);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Unlock with passkey" }));
    expect((await screen.findByTestId("no-backup")).textContent).toMatch(/recovery phrase/);
    expect(await loadEnvelope()).toBeNull();
    // Two buttons now: the welcome one and the alert's; both lead to the phrase restore step.
    const buttons = screen.getAllByRole("button", { name: "Restore from recovery phrase" });
    expect(buttons).toHaveLength(2);
    await user.click(buttons[1]!);
    // The welcome step animates out (UX pass #54), so wait for it to leave.
    await waitFor(() => expect(screen.queryByRole("button", { name: "Unlock with passkey" })).toBeNull());
  });

  it("PRF unsupported (or no discoverable passkeys): the passkey restore option is hidden", async () => {
    for (const pk of [fakePasskey({ available: false }), fakePasskey({ discover: false })]) {
      const { unmount } = mount(pk);
      expect(await screen.findByRole("button", { name: "Restore from recovery phrase" })).toBeTruthy();
      await new Promise((r) => setTimeout(r, 20));
      expect(screen.queryByRole("button", { name: "Unlock with passkey" })).toBeNull();
      unmount();
    }
  });

  it("a passphrase vault on a device without PRF shows backup off", async () => {
    const { vaultRef } = mount(fakePasskey({ available: false }));
    await waitFor(() => expect(vaultRef.current?.status).toBe("empty"));
    await vaultRef.current!.create(generateMnemonic(), "correct horse battery");
    await waitFor(() => expect(screen.getByTestId("backup-status").textContent).toBe("Backup off: this passkey doesn't support it"));
    expect(vaultRef.current!.backupKeys).toBeNull();
  });
});

describe("onboarding machine after a passkey restore", () => {
  it("resumes where the restored vault left off", async () => {
    const { reduce } = await import("../src/onboarding/machine.js");
    expect(reduce({ step: "welcome" }, { type: "RESTORED", profile: { onboardedAt: 1 } })).toEqual({ step: "done" });
    expect(reduce({ step: "welcome" }, { type: "RESTORED", profile: {} })).toEqual({ step: "register" });
  });
});
