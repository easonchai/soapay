import { useCallback } from "react";
import { getAddress, isAddress } from "viem";
import { useVault, useUnlocked } from "../vault/VaultProvider.js";
import { settingsOf, type Settings } from "../vault/types.js";
import { useKeyRing } from "./useChain.js";

/** Settings, known payers and vault housekeeping (export, lock, wipe). */
export function useSettings() {
  const v = useUnlocked();
  const vault = useVault();
  const settings = settingsOf(v.data);
  const ring = useKeyRing();

  const save = useCallback(
    (patch: Partial<Settings>) => v.update((d) => ({ ...d, settings: { ...settingsOf(d), ...patch } })),
    [v],
  );

  const addPayer = useCallback(
    async (address: string, name: string) => {
      if (!isAddress(address.trim(), { strict: false })) throw new Error("Enter a valid 0x address.");
      const a = getAddress(address.trim());
      await v.update((d) => {
        const s = settingsOf(d);
        const rest = s.knownPayers.filter((p) => p.address !== a);
        return { ...d, settings: { ...s, knownPayers: [...rest, { address: a, name: name.trim() || "Employer" }] } };
      });
    },
    [v],
  );

  const removePayer = useCallback(
    (address: string) =>
      v.update((d) => {
        const s = settingsOf(d);
        return { ...d, settings: { ...s, knownPayers: s.knownPayers.filter((p) => p.address.toLowerCase() !== address.toLowerCase()) } };
      }),
    [v],
  );

  /** The encrypted vault as a JSON file: safe to store anywhere, useless without the passphrase or passkey. */
  const exportBackup = useCallback(async () => {
    const env = await vault.exportEnvelope();
    if (!env) throw new Error("No vault to export.");
    const blob = new Blob([JSON.stringify(env, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `soapay-vault-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [vault]);

  /**
   * Advanced recovery (replaces CK's per-row "reveal private key"): the plaintext spending/viewing keys of
   * every generation plus the registrant key, as a file. Anyone holding it can spend every payment, so the
   * UI puts it behind an explicit warning. Nothing is sent anywhere.
   */
  const exportRawKeys = useCallback(() => {
    const blob = new Blob(
      [
        JSON.stringify(
          {
            warning: "PRIVATE KEYS. Anyone with this file can spend every payment sent to you. Prefer your recovery phrase.",
            source: v.data.walletKeys ? { kind: "wallet-signature", wallet: v.data.walletKeys.wallet } : { kind: "recovery-phrase" },
            chainId: settings.chainId,
            registrant: { address: ring.current.registrantAddress, privateKey: ring.current.registrantKey },
            generations: ring.all.map((k, generation) => ({
              generation,
              metaAddress: k.metaAddressURI,
              spendingPrivateKey: k.spendingKey,
              viewingPrivateKey: k.viewingKey,
            })),
          },
          null,
          2,
        ),
      ],
      { type: "application/json" },
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `soapay-PRIVATE-keys-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [v.data.walletKeys, settings.chainId, ring]);

  return {
    settings,
    save,
    addPayer,
    removePayer,
    exportBackup,
    exportRawKeys,
    /** Where the keys come from: the recovery phrase (default) or a wallet signature (plain EOA). */
    keySource: v.data.walletKeys ? ({ kind: "wallet-signature", wallet: v.data.walletKeys.wallet } as const) : ({ kind: "recovery-phrase" } as const),
    lock: vault.lock,
    wipe: vault.wipe,
    profile: v.data.profile,
    keys: v.keys,
  };
}
