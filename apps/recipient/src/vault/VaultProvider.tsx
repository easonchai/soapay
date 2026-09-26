import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { SoapayKeys } from "@soapay/sdk";
import { createVault, openVault, sealWithKey, type VaultEnvelope } from "./crypto.js";
import { deleteEnvelope, loadEnvelope, saveEnvelope } from "./idb.js";
import { newVaultData, vaultKeys, type KeySecret, type VaultData } from "./types.js";

export type VaultStatus = "loading" | "empty" | "locked" | "unlocked" | "error";

type Session = { data: VaultData; keys: SoapayKeys; key: CryptoKey; kdf: { salt: string; iterations: number } };

export type VaultApi = {
  status: VaultStatus;
  error: string | null;
  data: VaultData | null;
  /** Derived in memory on unlock; never persisted. */
  keys: SoapayKeys | null;
  /** `secret`: a recovery phrase (default) or a wallet-signature key secret (plain EOAs only). */
  create(secret: KeySecret, passphrase: string): Promise<void>;
  unlock(passphrase: string): Promise<void>;
  lock(): void;
  /** Applies `fn` to the latest data and persists it encrypted. Writes are serialised. */
  update(fn: (d: VaultData) => VaultData): Promise<VaultData>;
  /** The encrypted envelope, for a backup file. */
  exportEnvelope(): Promise<VaultEnvelope | null>;
  wipe(): Promise<void>;
};

const VaultContext = createContext<VaultApi | null>(null);

/** Lock after this long without pointer or key activity. */
const IDLE_LOCK_MS = 15 * 60_000;

export function VaultProvider({ children, idleLockMs = IDLE_LOCK_MS }: { children: ReactNode; idleLockMs?: number }) {
  const [status, setStatus] = useState<VaultStatus>("loading");
  const [error, setError] = useState<string | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const sessionRef = useRef<Session | null>(null);
  const writeQueue = useRef<Promise<unknown>>(Promise.resolve());

  const setLive = (s: Session | null) => {
    sessionRef.current = s;
    setSession(s);
  };

  useEffect(() => {
    let cancelled = false;
    loadEnvelope()
      .then((env) => !cancelled && setStatus(env ? "locked" : "empty"))
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
        setStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const create = useCallback(async (secret: KeySecret, passphrase: string) => {
    const data = newVaultData(secret);
    const keys = vaultKeys(data);

    const v = await createVault(data, passphrase);
    await saveEnvelope(v.envelope);
    setLive({ data, keys, key: v.key, kdf: v.kdf });
    setStatus("unlocked");
  }, []);

  const unlock = useCallback(async (passphrase: string) => {
    const env = await loadEnvelope();
    if (!env) {
      setStatus("empty");
      throw new Error("No vault on this device.");
    }
    const v = await openVault<VaultData>(env, passphrase);
    const keys = vaultKeys(v.data);
    setLive({ data: v.data, keys, key: v.key, kdf: v.kdf });
    setStatus("unlocked");
  }, []);

  const lock = useCallback(() => {
    // Drop every reference to the key and plaintext. JS cannot zero strings; GC reclaims them.
    setLive(null);
    setStatus((s) => (s === "unlocked" ? "locked" : s));
  }, []);

  const update = useCallback((fn: (d: VaultData) => VaultData) => {
    const run = async () => {
      const cur = sessionRef.current;
      if (!cur) throw new Error("Vault is locked");
      const next = fn(cur.data);
      const envelope = await sealWithKey(next, cur.key, cur.kdf);
      await saveEnvelope(envelope);
      // Re-check: the user may have locked while we were writing.
      if (sessionRef.current?.key === cur.key) setLive({ ...sessionRef.current, data: next });
      return next;
    };
    const p = writeQueue.current.then(run, run);
    writeQueue.current = p.catch(() => undefined);
    return p;
  }, []);

  const exportEnvelope = useCallback(() => loadEnvelope(), []);

  const wipe = useCallback(async () => {
    await writeQueue.current;
    await deleteEnvelope();
    setLive(null);
    setStatus("empty");
  }, []);

  // Idle auto-lock.
  useEffect(() => {
    if (status !== "unlocked" || idleLockMs <= 0) return;
    let timer = window.setTimeout(lock, idleLockMs);
    const bump = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(lock, idleLockMs);
    };
    const events = ["pointerdown", "keydown"] as const;
    for (const e of events) window.addEventListener(e, bump, { passive: true });
    return () => {
      window.clearTimeout(timer);
      for (const e of events) window.removeEventListener(e, bump);
    };
  }, [status, idleLockMs, lock]);

  const api = useMemo<VaultApi>(
    () => ({
      status,
      error,
      data: session?.data ?? null,
      keys: session?.keys ?? null,
      create,
      unlock,
      lock,
      update,
      exportEnvelope,
      wipe,
    }),
    [status, error, session, create, unlock, lock, update, exportEnvelope, wipe],
  );

  return <VaultContext.Provider value={api}>{children}</VaultContext.Provider>;
}

export function useVault(): VaultApi {
  const v = useContext(VaultContext);
  if (!v) throw new Error("useVault outside VaultProvider");
  return v;
}

/** For screens that only render while unlocked. */
export function useUnlocked(): VaultApi & { data: VaultData; keys: SoapayKeys } {
  const v = useVault();
  if (!v.data || !v.keys) throw new Error("Vault is locked");
  return v as VaultApi & { data: VaultData; keys: SoapayKeys };
}
