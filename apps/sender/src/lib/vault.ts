// Encrypted local storage for the roster and run history (WebCrypto AES-GCM-256).
//
// The employer is trusted, but the roster maps names to salaries and pinned
// meta-addresses, so it is never stored in plaintext. Two key modes:
// - "device": a non-extractable AES key generated in the browser and kept in
//   IndexedDB. Script on this origin can use it but never read it out; it does not
//   survive clearing site data and does not leave this browser profile.
// - "passphrase": PBKDF2-SHA256 (600k iterations) over a passphrase the employer
//   types each session; the derived key is non-extractable and never stored.
// Each record is bound to its slot name via AES-GCM additional data, so records
// can't be swapped between slots.

export type KV = {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<void>;
  clear(): Promise<void>;
};

export function memoryKV(): KV {
  const m = new Map<string, unknown>();
  return {
    async get(k) {
      return m.get(k);
    },
    async set(k, v) {
      m.set(k, v);
    },
    async delete(k) {
      m.delete(k);
    },
    async clear() {
      m.clear();
    },
  };
}

/** IndexedDB-backed KV (structured clone, so CryptoKey objects persist non-extractable). */
export function idbKV(dbName = "soapay-sender", store = "vault"): KV {
  let dbp: Promise<IDBDatabase> | null = null;
  const db = () =>
    (dbp ??= new Promise((resolve, reject) => {
      const req = indexedDB.open(dbName, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(store);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error("IndexedDB unavailable"));
    }));
  const run = <T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>) =>
    db().then(
      (d) =>
        new Promise<T>((resolve, reject) => {
          const req = fn(d.transaction(store, mode).objectStore(store));
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error ?? new Error("IndexedDB request failed"));
        }),
    );
  return {
    get: (k) => run("readonly", (s) => s.get(k)),
    set: async (k, v) => {
      await run("readwrite", (s) => s.put(v, k));
    },
    delete: async (k) => {
      await run("readwrite", (s) => s.delete(k));
    },
    clear: async () => {
      await run("readwrite", (s) => s.clear());
    },
  };
}

export type VaultMode = "device" | "passphrase";

type Sealed = { v: 1; iv: Uint8Array; ct: Uint8Array };
type VaultMeta = { v: 1; mode: VaultMode; salt?: Uint8Array; check: Sealed };

const META = "meta";
const DEVICE_KEY = "deviceKey";
const CHECK_TEXT = "soapay-sender-vault-v1";
export const PBKDF2_ITERATIONS = 600_000;
export const MIN_PASSPHRASE_LENGTH = 10;

export class VaultError extends Error {
  readonly code: "WrongPassphrase" | "NoVault" | "Exists" | "Corrupt" | "WeakPassphrase";
  constructor(code: VaultError["code"], message: string) {
    super(message);
    this.name = "VaultError";
    this.code = code;
  }
}

const enc = new TextEncoder();
const dec = new TextDecoder();

async function deriveKey(passphrase: string, salt: Uint8Array, iterations = PBKDF2_ITERATIONS): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey("raw", enc.encode(passphrase), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt: salt as BufferSource, iterations },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

async function seal(key: CryptoKey, slot: string, plaintext: Uint8Array): Promise<Sealed> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: iv as BufferSource, additionalData: enc.encode(slot) },
      key,
      plaintext as BufferSource,
    ),
  );
  return { v: 1, iv, ct };
}

async function open(key: CryptoKey, slot: string, s: Sealed): Promise<Uint8Array> {
  return new Uint8Array(
    await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: s.iv as BufferSource, additionalData: enc.encode(slot) },
      key,
      s.ct as BufferSource,
    ),
  );
}

/** JSON with bigint support: bigints round-trip as {"$bigint": "123"}. */
export function toJson(value: unknown): string {
  return JSON.stringify(value, (_k, v) => (typeof v === "bigint" ? { $bigint: v.toString() } : v));
}

export function fromJson<T>(text: string): T {
  return JSON.parse(text, (_k, v) =>
    v && typeof v === "object" && typeof (v as { $bigint?: unknown }).$bigint === "string" && Object.keys(v).length === 1
      ? BigInt((v as { $bigint: string }).$bigint)
      : v,
  ) as T;
}

export type VaultOptions = { iterations?: number };

export class Vault {
  private constructor(
    private readonly kv: KV,
    private readonly key: CryptoKey,
    readonly mode: VaultMode,
  ) {}

  static async status(kv: KV): Promise<{ exists: false } | { exists: true; mode: VaultMode }> {
    const meta = (await kv.get(META)) as VaultMeta | undefined;
    return meta ? { exists: true, mode: meta.mode } : { exists: false };
  }

  static async create(kv: KV, mode: VaultMode, passphrase?: string, opts: VaultOptions = {}): Promise<Vault> {
    if (await kv.get(META)) throw new VaultError("Exists", "A vault already exists on this device");
    let key: CryptoKey;
    let salt: Uint8Array | undefined;
    if (mode === "passphrase") {
      if (!passphrase || passphrase.length < MIN_PASSPHRASE_LENGTH) {
        throw new VaultError("WeakPassphrase", `Use at least ${MIN_PASSPHRASE_LENGTH} characters`);
      }
      salt = crypto.getRandomValues(new Uint8Array(16));
      key = await deriveKey(passphrase, salt, opts.iterations);
    } else {
      key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
      await kv.set(DEVICE_KEY, key);
    }
    const check = await seal(key, META, enc.encode(CHECK_TEXT));
    await kv.set(META, { v: 1, mode, ...(salt ? { salt } : {}), check } satisfies VaultMeta);
    return new Vault(kv, key, mode);
  }

  static async unlock(kv: KV, passphrase?: string, opts: VaultOptions = {}): Promise<Vault> {
    const meta = (await kv.get(META)) as VaultMeta | undefined;
    if (!meta) throw new VaultError("NoVault", "No vault on this device");
    let key: CryptoKey;
    if (meta.mode === "passphrase") {
      if (!passphrase || !meta.salt) throw new VaultError("WrongPassphrase", "Enter your passphrase");
      key = await deriveKey(passphrase, meta.salt, opts.iterations);
    } else {
      const k = (await kv.get(DEVICE_KEY)) as CryptoKey | undefined;
      if (!k) throw new VaultError("Corrupt", "The device key is missing; the vault can't be opened");
      key = k;
    }
    try {
      const text = dec.decode(await open(key, META, meta.check));
      if (text !== CHECK_TEXT) throw new Error("check mismatch");
    } catch {
      throw new VaultError(
        meta.mode === "passphrase" ? "WrongPassphrase" : "Corrupt",
        meta.mode === "passphrase" ? "That passphrase doesn't unlock this vault" : "The vault can't be decrypted",
      );
    }
    return new Vault(kv, key, meta.mode);
  }

  /** Deletes the vault and its key. Irreversible. */
  static async destroy(kv: KV): Promise<void> {
    await kv.clear();
  }

  async read<T>(slot: string): Promise<T | undefined> {
    const sealed = (await this.kv.get(`rec:${slot}`)) as Sealed | undefined;
    if (!sealed) return undefined;
    try {
      return fromJson<T>(dec.decode(await open(this.key, slot, sealed)));
    } catch {
      throw new VaultError("Corrupt", `Stored ${slot} can't be decrypted`);
    }
  }

  async write(slot: string, value: unknown): Promise<void> {
    await this.kv.set(`rec:${slot}`, await seal(this.key, slot, enc.encode(toJson(value))));
  }

  /** Raw stored value, for tests asserting nothing is stored in plaintext. */
  async rawForTest(slot: string): Promise<unknown> {
    return this.kv.get(`rec:${slot}`);
  }
}
