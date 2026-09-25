import { useCallback } from "react";
import { getAddress, isAddress } from "viem";
import { useVault, useUnlocked } from "../vault/VaultProvider.js";
import { settingsOf, type Settings } from "../vault/types.js";

/** Settings, known payers and vault housekeeping (export, lock, wipe). */
export function useSettings() {
  const v = useUnlocked();
  const vault = useVault();
  const settings = settingsOf(v.data);

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

  /** The encrypted vault as a JSON file: safe to store anywhere, useless without the passphrase. */
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

  return { settings, save, addPayer, removePayer, exportBackup, lock: vault.lock, wipe: vault.wipe, profile: v.data.profile, keys: v.keys };
}
