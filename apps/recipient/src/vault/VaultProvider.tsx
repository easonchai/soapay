import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { SoapayKeys } from "@soapay/sdk";
import { ENV } from "../config.js";
import { createVault, fromBase64, openVault, sealWithKey } from "./crypto.js";
import { deleteEnvelope, loadEnvelope, saveEnvelope } from "./idb.js";
import { browserPasskey, mockPasskey, type PasskeyAuthenticator } from "./passkey.js";
import {
  PRF_SALT,
  createPasskeyVault,
  isPasskeyEnvelope,
  lockOf,
  openPasskeyVault,
  sealWithPasskeyKey,
  type LockKind,
  type StoredEnvelope,
} from "./passkeyCrypto.js";
import { newVaultData, vaultKeys, type KeySecret, type VaultData } from "./types.js";

export type VaultStatus = "loading" | "empty" | "locked" | "unlocked" | "error";

/** `seal` re-encrypts under the session's key with whichever lock (passphrase or passkey) the vault uses. */
type Session = { data: VaultData; keys: SoapayKeys; key: CryptoKey; seal: (d: VaultData) => Promise<StoredEnvelope> };

/** How to re-lock an open vault (Settings): a new passphrase, or a new passkey. */
export type NewLock = { kind: "passphrase"; passphrase: string } | { kind: "passkey" };

export type VaultApi = {
  status: VaultStatus;
  error: string | null;
  data: VaultData | null;
  /** Derived in memory on unlock; never persisted. */
  keys: SoapayKeys | null;
  /** Which lock the stored vault uses (D-35); null before it loads or when there is none. */
  lockKind: LockKind | null;
  /** Whether a passkey lock can be offered here (no prompt). */
  passkeyAvailable(): Promise<boolean>;
  /**
   * Passphrase lock (the fallback). `secret`: a recovery phrase (default) or a wallet-signature key
   * secret (plain EOAs only).
   */
  create(secret: KeySecret, passphrase: string): Promise<void>;
  /** Passkey lock (the default, D-35). Throws `PasskeyUnsupportedError` when the device has no PRF support. */
  createWithPasskey(secret: KeySecret): Promise<void>;
  unlock(passphrase: string): Promise<void>;
  unlockWithPasskey(): Promise<void>;
  /** Re-encrypts the open vault under a new lock (e.g. passkey → passphrase). */
  relock(to: NewLock): Promise<void>;
  lock(): void;
  /** Applies `fn` to the latest data and persists it encrypted. Writes are serialised. */
  update(fn: (d: VaultData) => VaultData): Promise<VaultData>;
  /** The encrypted envelope, for a backup file. */
  exportEnvelope(): Promise<StoredEnvelope | null>;
  wipe(): Promise<void>;
};

const VaultContext = createContext<VaultApi | null>(null);

/** Lock after this long without pointer or key activity. */
const IDLE_LOCK_MS = 15 * 60_000;

/** Real WebAuthn, or the mock authenticator in mock mode (like `svc.mock` for the services). */
const defaultPasskey = (): PasskeyAuthenticator => (ENV.mockApi ? mockPasskey() : browserPasskey());

export function VaultProvider({
  children,
  idleLockMs = IDLE_LOCK_MS,
  passkey: passkeyProp,
}: {
  children: ReactNode;
  idleLockMs?: number;
  /** Injectable WebAuthn (tests). Defaults to the browser, or the mock in mock mode. */
  passkey?: PasskeyAuthenticator;
}) {
  const passkey = useMemo(() => passkeyProp ?? defaultPasskey(), [passkeyProp]);
  const [status, setStatus] = useState<VaultStatus>("loading");
  const [lockKind, setLockKind] = useState<LockKind | null>(null);
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
      .then((env) => {
        if (cancelled) return;
        setLockKind(env ? lockOf(env).kind : null);
        setStatus(env ? "locked" : "empty");
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
        setStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const passkeyAvailable = useCallback(() => passkey.available().catch(() => false), [passkey]);

  /** Registers a passkey and seals `data` under its PRF output. */
  const passkeySealed = useCallback(
    async (data: VaultData) => {
      const { credentialId, prf } = await passkey.register(new Uint8Array(PRF_SALT));
      try {
        const v = await createPasskeyVault(data, credentialId, prf);
        return { envelope: v.envelope, key: v.key, seal: (d: VaultData) => sealWithPasskeyKey(d, v.key, v.params) };
      } finally {
        prf.fill(0);
      }
    },
    [passkey],
  );

  const create = useCallback(async (secret: KeySecret, passphrase: string) => {
    const data = newVaultData(secret);
    const keys = vaultKeys(data);

    const v = await createVault(data, passphrase);
    await saveEnvelope(v.envelope);
    setLive({ data, keys, key: v.key, seal: (d) => sealWithKey(d, v.key, v.kdf) });
    setLockKind("passphrase");
    setStatus("unlocked");
  }, []);

  const createWithPasskey = useCallback(
    async (secret: KeySecret) => {
      const data = newVaultData(secret);
      const keys = vaultKeys(data);
      const v = await passkeySealed(data);
      await saveEnvelope(v.envelope);
      setLive({ data, keys, key: v.key, seal: v.seal });
      setLockKind("passkey");
      setStatus("unlocked");
    },
    [passkeySealed],
  );

  const unlock = useCallback(async (passphrase: string) => {
    const env = await loadEnvelope();
    if (!env) {
      setStatus("empty");
      throw new Error("No vault on this device.");
    }
    if (isPasskeyEnvelope(env)) throw new Error("This vault unlocks with a passkey, not a passphrase.");
    const v = await openVault<VaultData>(env, passphrase);
    const keys = vaultKeys(v.data);
    setLive({ data: v.data, keys, key: v.key, seal: (d) => sealWithKey(d, v.key, v.kdf) });
    setStatus("unlocked");
  }, []);

  const unlockWithPasskey = useCallback(async () => {
    const env = await loadEnvelope();
    if (!env) {
      setStatus("empty");
      throw new Error("No vault on this device.");
    }
    if (!isPasskeyEnvelope(env)) throw new Error("This vault unlocks with a passphrase.");
    const prf = await passkey.evaluate(fromBase64(env.lock.credentialId), fromBase64(env.lock.prfSalt));
    try {
      const v = await openPasskeyVault<VaultData>(env, prf);
      const keys = vaultKeys(v.data);
      setLive({ data: v.data, keys, key: v.key, seal: (d) => sealWithPasskeyKey(d, v.key, v.params) });
      setStatus("unlocked");
    } finally {
      prf.fill(0);
    }
  }, [passkey]);

  const lock = useCallback(() => {
    // Drop every reference to the key and plaintext. JS cannot zero strings; GC reclaims them.
    setLive(null);
    setStatus((s) => (s === "unlocked" ? "locked" : s));
  }, []);

  /** Serialises vault writes: saves never interleave, and a re-lock never races an update. */
  const enqueue = useCallback(<T,>(run: () => Promise<T>): Promise<T> => {
    const p = writeQueue.current.then(run, run);
    writeQueue.current = p.catch(() => undefined);
    return p;
  }, []);

  const update = useCallback(
    (fn: (d: VaultData) => VaultData) =>
      enqueue(async () => {
        const cur = sessionRef.current;
        if (!cur) throw new Error("Vault is locked");
        const next = fn(cur.data);
        const envelope = await cur.seal(next);
        await saveEnvelope(envelope);
        // Re-check: the user may have locked while we were writing.
        if (sessionRef.current?.key === cur.key) setLive({ ...sessionRef.current, data: next });
        return next;
      }),
    [enqueue],
  );

  const relock = useCallback(
    (to: NewLock) =>
      enqueue(async () => {
        const cur = sessionRef.current;
        if (!cur) throw new Error("Vault is locked");
        let next: { envelope: StoredEnvelope; key: CryptoKey; seal: Session["seal"] };
        if (to.kind === "passphrase") {
          const v = await createVault(cur.data, to.passphrase);
          next = { envelope: v.envelope, key: v.key, seal: (d) => sealWithKey(d, v.key, v.kdf) };
        } else {
          next = await passkeySealed(cur.data);
        }
        await saveEnvelope(next.envelope);
        if (sessionRef.current?.key === cur.key) setLive({ ...sessionRef.current, key: next.key, seal: next.seal });
        setLockKind(to.kind);
      }),
    [enqueue, passkeySealed],
  );

  const exportEnvelope = useCallback(() => loadEnvelope(), []);

  const wipe = useCallback(async () => {
    await writeQueue.current;
    await deleteEnvelope();
    setLive(null);
    setLockKind(null);
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
      lockKind,
      passkeyAvailable,
      create,
      createWithPasskey,
      unlock,
      unlockWithPasskey,
      relock,
      lock,
      update,
      exportEnvelope,
      wipe,
    }),
    [status, error, session, lockKind, passkeyAvailable, create, createWithPasskey, unlock, unlockWithPasskey, relock, lock, update, exportEnvelope, wipe],
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
