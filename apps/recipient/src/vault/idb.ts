/**
 * Minimal IndexedDB wrapper: one object store, one record. Only the *encrypted* envelope is ever
 * written here (see vault/crypto.ts). Nothing else in the app touches persistent storage.
 */
import type { VaultEnvelope } from "./crypto.js";

const DB_NAME = "soapay-recipient";
const STORE = "vault";
const KEY = "primary";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB open failed"));
    req.onblocked = () => reject(new Error("IndexedDB is blocked by another tab"));
  });
}

async function tx<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const t = db.transaction(STORE, mode);
      const req = run(t.objectStore(STORE));
      t.oncomplete = () => resolve(req.result as T);
      t.onerror = () => reject(t.error ?? new Error("IndexedDB transaction failed"));
      t.onabort = () => reject(t.error ?? new Error("IndexedDB transaction aborted"));
    });
  } finally {
    db.close();
  }
}

export async function loadEnvelope(): Promise<VaultEnvelope | null> {
  const v = await tx<VaultEnvelope | undefined>("readonly", (s) => s.get(KEY));
  return v ?? null;
}

export async function saveEnvelope(envelope: VaultEnvelope): Promise<void> {
  await tx("readwrite", (s) => s.put(envelope, KEY));
}

export async function deleteEnvelope(): Promise<void> {
  await tx("readwrite", (s) => s.delete(KEY));
}
