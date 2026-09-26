import { useEffect } from "react";
import { fetchLinkedSession, needsSessionRestore } from "../features/recovery/restore.js";
import { useServices } from "../services/ServicesProvider.js";
import { useVault } from "../vault/VaultProvider.js";

/**
 * One lookup per name + registrant per page load, shared by every caller (the Layout on app load,
 * Name settings). A failure (offline, API down) clears the entry so the next mount retries.
 */
const attempts = new Map<string, Promise<void>>();

/** Test hook: forget earlier attempts. */
export function resetSessionRestoreAttempts(): void {
  attempts.clear();
}

/**
 * Self-heal (D-64): when the vault has a claimed name but not its World ID session id (a recovery-phrase
 * restore, or an onboarding lookup that failed) and the API says a session backs the name, read the id
 * back with a registrant-signed SessionLookup and store it, so rotation is attested again. A locked
 * vault does nothing.
 */
export function useSessionRestore(): void {
  const v = useVault();
  const svc = useServices();
  const profile = v.data?.profile;
  const label = profile?.name?.label;
  const needed = profile ? needsSessionRestore(profile) : false;
  const registrant = v.keys?.registrantAddress;
  const registrantKey = v.keys?.registrantKey;
  const chainId = svc.settings.chainId;
  const api = svc.api;
  const update = v.update;

  useEffect(() => {
    if (!needed || !label || !registrant || !registrantKey) return;
    const key = `${chainId}:${label}:${registrant.toLowerCase()}`;
    if (attempts.has(key)) return;
    const run = (async () => {
      const recovery = await fetchLinkedSession({ api, chainId, label, registrant, registrantKey });
      if (!recovery) return;
      await update((d) =>
        d.profile.name?.label === label && needsSessionRestore(d.profile)
          ? { ...d, profile: { ...d.profile, recovery, recoverySkipped: false } }
          : d,
      );
    })().catch(() => {
      attempts.delete(key);
    });
    attempts.set(key, run);
  }, [needed, label, registrant, registrantKey, chainId, api, update]);
}
