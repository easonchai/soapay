/**
 * Passkey-synced vault backup (D-63): uploads the encrypted vault after writes, debounced, with no
 * prompt. The signer and encryption keys live in memory while a passkey vault is unlocked
 * (VaultProvider derives them from the passkey's PRF output); this provider only schedules uploads,
 * handles version conflicts and reports status for Settings.
 *
 * Also asks the browser once per unlock to keep this site's storage (`navigator.storage.persist()`), so
 * the local vault is less likely to be evicted.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ApiError, type Api } from "../api/client.js";
import { useServices } from "../services/ServicesProvider.js";
import { errorMessage } from "../ui/kit.js";
import { backupSigningMessage, contentHash, type BackupKeys } from "./backup.js";
import { backupPayload, type VaultData } from "./types.js";
import { useVault } from "./VaultProvider.js";

export type BackupStatus =
  /** Not unlocked, or still checking. */
  | { kind: "idle" }
  /** Sync is off: a passphrase vault (`passphrase`), or no passkey with PRF on this device (`unsupported`). */
  | { kind: "off"; reason: "passphrase" | "unsupported" | "no-api" }
  | { kind: "pending" }
  | { kind: "syncing" }
  | { kind: "synced"; at: number; version: number }
  | { kind: "error"; message: string };

export type BackupSyncApi = {
  status: BackupStatus;
  /** `navigator.storage.persisted()`, or null when unknown / unsupported. */
  persisted: boolean | null;
  /** Upload now (skips the debounce). */
  syncNow(): Promise<void>;
};

const BackupContext = createContext<BackupSyncApi | null>(null);

const DEBOUNCE_MS = 3_000;

/** Uploads `data` under the next version; on 409 refetches the stored version and retries once. */
export async function uploadBackup(api: Pick<Api, "getBackup" | "putBackup">, keys: BackupKeys, data: VaultData) {
  const payload = backupPayload(data);
  const hash = await contentHash(payload);
  const known = data.backup?.address === keys.address ? data.backup.version : 0;
  const put = async (version: number) => {
    const ciphertext = await keys.seal(payload, version);
    const signature = await keys.signMessage(backupSigningMessage(keys.address, version, ciphertext));
    await api.putBackup(keys.address, { version, ciphertext, signature });
    return version;
  };
  let version: number;
  try {
    version = await put(known + 1);
  } catch (e) {
    if (!(e instanceof ApiError && e.status === 409)) throw e;
    // Another device (or a lost local write) moved the version on: refetch it and go one past.
    const current = await api.getBackup(keys.address);
    version = await put(Math.max(known, current?.version ?? 0) + 1);
  }
  return { address: keys.address, version, at: Date.now(), hash };
}

export function BackupSync({ children, debounceMs = DEBOUNCE_MS }: { children: ReactNode; debounceMs?: number }) {
  const vault = useVault();
  const svc = useServices();
  const [status, setStatus] = useState<BackupStatus>({ kind: "idle" });
  const [persisted, setPersisted] = useState<boolean | null>(null);
  const [canPasskey, setCanPasskey] = useState<boolean | null>(null);
  const dataRef = useRef(vault.data);
  dataRef.current = vault.data;
  const running = useRef<Promise<void> | null>(null);
  const again = useRef(false);

  const keys = vault.backupKeys;
  const { update, passkeyAvailable } = vault;
  const unlocked = vault.status === "unlocked";
  const hasApi = Boolean(svc.settings.apiUrl);

  // Ask once per unlock to keep this site's storage; ignore refusals.
  useEffect(() => {
    if (!unlocked) return;
    const storage = typeof navigator !== "undefined" ? navigator.storage : undefined;
    void (async () => {
      try {
        const granted = (await storage?.persist?.()) ?? null;
        setPersisted(granted || ((await storage?.persisted?.()) ?? null));
      } catch {
        setPersisted(null);
      }
    })();
  }, [unlocked]);

  useEffect(() => {
    if (!unlocked || keys) return;
    let cancelled = false;
    void passkeyAvailable().then((ok) => !cancelled && setCanPasskey(ok));
    return () => {
      cancelled = true;
    };
  }, [unlocked, keys, passkeyAvailable]);

  const sync = useCallback(async () => {
    if (!keys) return;
    if (running.current) {
      again.current = true;
      return running.current;
    }
    const run = (async () => {
      do {
        again.current = false;
        const data = dataRef.current;
        if (!data) return;
        setStatus({ kind: "syncing" });
        try {
          const meta = await uploadBackup(svc.api, keys, data);
          await update((d) => ({ ...d, backup: meta }));
          setStatus({ kind: "synced", at: meta.at, version: meta.version });
        } catch (e) {
          setStatus({ kind: "error", message: errorMessage(e) });
          return;
        }
      } while (again.current);
    })();
    running.current = run;
    try {
      await run;
    } finally {
      running.current = null;
    }
  }, [keys, svc.api, update]);

  // After each vault write: compare the payload with what was last uploaded; upload if it changed.
  const data = vault.data;
  useEffect(() => {
    if (!unlocked || !data) {
      setStatus({ kind: "idle" });
      return;
    }
    if (!keys) {
      if (vault.lockKind === "passphrase" && canPasskey === null) return;
      setStatus({ kind: "off", reason: vault.lockKind === "passphrase" && canPasskey ? "passphrase" : "unsupported" });
      return;
    }
    if (!hasApi) {
      setStatus({ kind: "off", reason: "no-api" });
      return;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    void contentHash(backupPayload(data)).then((hash) => {
      if (cancelled) return;
      const meta = data.backup;
      if (meta && meta.address === keys.address && meta.hash === hash) {
        setStatus((s) => (s.kind === "syncing" ? s : { kind: "synced", at: meta.at, version: meta.version }));
        return;
      }
      setStatus((s) => (s.kind === "syncing" ? s : { kind: "pending" }));
      timer = setTimeout(() => void sync(), debounceMs);
    });
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [unlocked, data, keys, hasApi, vault.lockKind, canPasskey, debounceMs, sync]);

  const api = useMemo<BackupSyncApi>(() => ({ status, persisted, syncNow: sync }), [status, persisted, sync]);
  return <BackupContext.Provider value={api}>{children}</BackupContext.Provider>;
}

/** null outside `BackupSync` (e.g. component tests that don't mount it). */
export function useBackupSync(): BackupSyncApi | null {
  return useContext(BackupContext);
}
