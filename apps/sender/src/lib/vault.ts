// Encrypted local storage for the roster and run history (WebCrypto AES-GCM-256).
//
// The employer is trusted, but the roster maps names to salaries and pinned
// meta-addresses, so it is never stored in plaintext. Three key modes:
// - "wallet" (default when the wallet signs deterministically, D-62): HKDF-SHA256 over
//   the connected wallet's personal_sign of a fixed message (walletVaultMessage). The
//   same wallet re-derives the same key in any browser, so an encrypted backup can be
//   restored by just logging in. The signature and key never leave the browser.
// - "device": a non-extractable AES key generated in the browser and kept in
//   IndexedDB. Script on this origin can use it but never read it out; it does not
//   survive clearing site data and does not leave this browser profile (so it can't
//   be backed up).
// - "passphrase": PBKDF2-SHA256 (600k iterations) over a passphrase the employer
//   types each session; the derived key is non-extractable and never stored.
// Each record is bound to its slot name via AES-GCM additional data, so records
// can't be swapped between slots. exportEnvelope() packs the sealed records plus the
// KDF metadata (never a key) for the encrypted backup; Vault.restore() reverses it.
import { getAddress, type Address, type Hex } from "viem";

export type KV = {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<void>;
  clear(): Promise<void>;
  keys(): Promise<string[]>;
  /** Writes and deletes in one transaction (all or nothing). */
  batch(set: [string, unknown][], del?: string[]): Promise<void>;
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
    async keys() {
      return [...m.keys()];
    },
    async batch(set, del = []) {
      for (const k of del) m.delete(k);
      for (const [k, v] of set) m.set(k, v);
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
    keys: async () => (await run("readonly", (s) => s.getAllKeys())).map(String),
    batch: (set, del = []) =>
      db().then(
        (d) =>
          new Promise<void>((resolve, reject) => {
            const t = d.transaction(store, "readwrite");
            const s = t.objectStore(store);
            for (const k of del) s.delete(k);
            for (const [k, v] of set) s.put(v, k);
            t.oncomplete = () => resolve();
            t.onerror = () => reject(t.error ?? new Error("IndexedDB transaction failed"));
            t.onabort = () => reject(t.error ?? new Error("IndexedDB transaction aborted"));
          }),
      ),
  };
}

export type VaultMode = "wallet" | "device" | "passphrase";

type Sealed = { v: 1; iv: Uint8Array; ct: Uint8Array };
type VaultMeta = {
  v: 1;
  mode: VaultMode;
  salt?: Uint8Array;
  check: Sealed;
  /** Wallet mode: the wallet whose signature derives the key, and the chain named in the message. */
  wallet?: Address;
  chainId?: number;
};

const META = "meta";
const DEVICE_KEY = "deviceKey";
const REC = "rec:";
const CHECK_TEXT = "soapay-sender-vault-v1";
const HKDF_INFO = "soapay-sender-vault-v1/wallet-signature/aes-gcm-256";
export const PBKDF2_ITERATIONS = 600_000;
export const MIN_PASSPHRASE_LENGTH = 10;

export class VaultError extends Error {
  readonly code:
    | "WrongPassphrase"
    | "NoVault"
    | "Exists"
    | "Corrupt"
    | "WeakPassphrase"
    | "WrongWallet"
    | "NotDeterministic"
    | "NoWallet"
    | "NotSyncable";
  constructor(code: VaultError["code"], message: string) {
    super(message);
    this.name = "VaultError";
    this.code = code;
  }
}

/** What wallet mode needs from the connected wallet: its address and an EIP-191 personal_sign. */
export type WalletSigner = { address: Address; signMessage(message: string): Promise<Hex> };

/** The fixed message the wallet signs to derive the vault key. Changing it changes every key. */
export function walletVaultMessage(address: Address, chainId: number): string {
  return (
    "Soapay company vault\n\n" +
    "Sign to unlock your payroll data on this device. This signature never leaves your browser.\n\n" +
    `Wallet: ${getAddress(address)}\nChain: ${chainId}`
  );
}

/**
 * Signs the vault message twice. EOAs (RFC 6979) and 7702-delegated EOAs sign deterministically;
 * passkey smart wallets (e.g. Coinbase Smart Wallet) don't, and can't derive a stable key.
 */
export async function probeWalletKey(signer: WalletSigner, chainId: number): Promise<{ deterministic: boolean; signature: Hex }> {
  const message = walletVaultMessage(signer.address, chainId);
  const a = await signer.signMessage(message);
  const b = await signer.signMessage(message);
  return { deterministic: a.toLowerCase() === b.toLowerCase(), signature: a };
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

function hexBytes(h: Hex): Uint8Array {
  const s = h.slice(2);
  if (s.length === 0 || s.length % 2 !== 0 || /[^0-9a-f]/i.test(s)) throw new VaultError("WrongWallet", "The wallet returned an invalid signature");
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16);
  return out;
}

async function deriveWalletKey(signature: Hex, salt: Uint8Array): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey("raw", hexBytes(signature) as BufferSource, "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: salt as BufferSource, info: enc.encode(HKDF_INFO) },
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

// ---------------------------------------------------------------------------
// Backup envelope: the sealed records plus KDF metadata, as base64(JSON). No key inside.

const ENVELOPE_FORMAT = "soapay-sender-vault";

type SealedJson = { iv: string; ct: string };
type Envelope = {
  format: typeof ENVELOPE_FORMAT;
  v: 1;
  meta: { mode: "wallet" | "passphrase"; salt: string; check: SealedJson; wallet?: Address; chainId?: number };
  records: Record<string, SealedJson>;
};

export function bytesToBase64(b: Uint8Array): string {
  let s = "";
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
}

export function base64ToBytes(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

const sealedToJson = (x: Sealed): SealedJson => ({ iv: bytesToBase64(x.iv), ct: bytesToBase64(x.ct) });
const sealedFromJson = (x: SealedJson): Sealed => ({ v: 1, iv: base64ToBytes(x.iv), ct: base64ToBytes(x.ct) });

/** What a backup says about itself before it is unlocked (for the restore screen). */
export type EnvelopeInfo = { mode: "wallet" | "passphrase"; wallet?: Address; chainId?: number };

function parseEnvelope(b64: string): Envelope {
  try {
    const e = JSON.parse(dec.decode(base64ToBytes(b64))) as Envelope;
    if (e.format !== ENVELOPE_FORMAT || e.v !== 1 || (e.meta.mode !== "wallet" && e.meta.mode !== "passphrase")) throw new Error("format");
    return e;
  } catch {
    throw new VaultError("Corrupt", "The backup isn't a Soapay company vault");
  }
}

export function envelopeInfo(b64: string): EnvelopeInfo {
  const { meta } = parseEnvelope(b64);
  return { mode: meta.mode, ...(meta.wallet ? { wallet: meta.wallet } : {}), ...(meta.chainId !== undefined ? { chainId: meta.chainId } : {}) };
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

/** Unlock secret: a passphrase, or the connected wallet for a wallet-mode vault. */
export type VaultSecret = string | WalletSigner | undefined;

export type VaultOptions = {
  iterations?: number;
  /** Wallet mode at create or rekey: the signature from probeWalletKey (saves another prompt), its wallet and chain. */
  wallet?: { address: Address; chainId: number; signature: Hex };
};

async function keyFromMeta(kv: KV | null, meta: VaultMeta, secret: VaultSecret, opts: VaultOptions): Promise<CryptoKey> {
  if (meta.mode === "passphrase") {
    if (typeof secret !== "string" || !secret || !meta.salt) throw new VaultError("WrongPassphrase", "Enter your passphrase");
    return deriveKey(secret, meta.salt, opts.iterations);
  }
  if (meta.mode === "wallet") {
    if (!secret || typeof secret === "string") throw new VaultError("NoWallet", "Connect the wallet that locks this vault");
    if (!meta.wallet || !meta.salt || meta.chainId === undefined) throw new VaultError("Corrupt", "The vault's wallet lock is incomplete");
    if (secret.address.toLowerCase() !== meta.wallet.toLowerCase()) {
      throw new VaultError("WrongWallet", `This vault is locked by ${meta.wallet}; connect that wallet`);
    }
    return deriveWalletKey(await secret.signMessage(walletVaultMessage(meta.wallet, meta.chainId)), meta.salt);
  }
  const k = kv ? ((await kv.get(DEVICE_KEY)) as CryptoKey | undefined) : undefined;
  if (!k) throw new VaultError("Corrupt", "The device key is missing; the vault can't be opened");
  return k;
}

async function verifyCheck(key: CryptoKey, meta: VaultMeta): Promise<void> {
  try {
    const text = dec.decode(await open(key, META, meta.check));
    if (text !== CHECK_TEXT) throw new Error("check mismatch");
  } catch {
    if (meta.mode === "passphrase") throw new VaultError("WrongPassphrase", "That passphrase doesn't unlock this vault");
    if (meta.mode === "wallet") {
      throw new VaultError("WrongWallet", "This wallet's signature doesn't unlock the vault (it may not sign the same way twice)");
    }
    throw new VaultError("Corrupt", "The vault can't be decrypted");
  }
}

/** New key material and meta for a mode. Wallet mode needs opts.wallet (a probed signature). */
async function newKey(
  mode: VaultMode,
  secret: string | undefined,
  opts: VaultOptions,
): Promise<{ key: CryptoKey; meta: Omit<VaultMeta, "check">; deviceKey?: CryptoKey }> {
  if (mode === "passphrase") {
    if (typeof secret !== "string" || secret.length < MIN_PASSPHRASE_LENGTH) {
      throw new VaultError("WeakPassphrase", `Use at least ${MIN_PASSPHRASE_LENGTH} characters`);
    }
    const salt = crypto.getRandomValues(new Uint8Array(16));
    return { key: await deriveKey(secret, salt, opts.iterations), meta: { v: 1, mode, salt } };
  }
  if (mode === "wallet") {
    const w = opts.wallet;
    if (!w) throw new VaultError("NoWallet", "Connect a wallet to lock the vault with it");
    const salt = crypto.getRandomValues(new Uint8Array(16));
    return { key: await deriveWalletKey(w.signature, salt), meta: { v: 1, mode, salt, wallet: getAddress(w.address), chainId: w.chainId } };
  }
  const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  return { key, meta: { v: 1, mode }, deviceKey: key };
}

export class Vault {
  private constructor(
    private readonly kv: KV,
    private readonly key: CryptoKey,
    readonly mode: VaultMode,
    /** Wallet mode: the wallet that locks it. */
    readonly wallet: Address | undefined,
  ) {}

  static async status(kv: KV): Promise<{ exists: false } | { exists: true; mode: VaultMode; wallet?: Address }> {
    const meta = (await kv.get(META)) as VaultMeta | undefined;
    return meta ? { exists: true, mode: meta.mode, ...(meta.wallet ? { wallet: meta.wallet } : {}) } : { exists: false };
  }

  /**
   * Creates a vault. `secret` is the passphrase in passphrase mode; wallet mode takes
   * `opts.wallet` (from probeWalletKey, and only when it is deterministic).
   */
  static async create(kv: KV, mode: VaultMode, secret?: string, opts: VaultOptions = {}): Promise<Vault> {
    if (await kv.get(META)) throw new VaultError("Exists", "A vault already exists on this device");
    const { key, meta, deviceKey } = await newKey(mode, secret, opts);
    const check = await seal(key, META, enc.encode(CHECK_TEXT));
    // Leftovers from an interrupted create or restore can't be read with this key: start clean.
    const stale = (await kv.keys()).filter((k) => k.startsWith(REC) || k === DEVICE_KEY);
    const set: [string, unknown][] = [[META, { ...meta, check } satisfies VaultMeta]];
    if (deviceKey) set.unshift([DEVICE_KEY, deviceKey]);
    await kv.batch(set, stale.filter((k) => !(deviceKey && k === DEVICE_KEY)));
    return new Vault(kv, key, mode, meta.wallet);
  }

  static async unlock(kv: KV, secret?: VaultSecret, opts: VaultOptions = {}): Promise<Vault> {
    const meta = (await kv.get(META)) as VaultMeta | undefined;
    if (!meta) throw new VaultError("NoVault", "No vault on this device");
    const key = await keyFromMeta(kv, meta, secret, opts);
    await verifyCheck(key, meta);
    return new Vault(kv, key, meta.mode, meta.wallet);
  }

  /**
   * Restores a backup envelope into this browser (which must have no vault). The secret is checked
   * before anything is written, so a wrong passphrase or wallet leaves the browser untouched.
   */
  static async restore(kv: KV, envelope: string, secret: VaultSecret, opts: VaultOptions = {}): Promise<Vault> {
    if (await kv.get(META)) throw new VaultError("Exists", "A vault already exists on this device");
    const e = parseEnvelope(envelope);
    const meta: VaultMeta = {
      v: 1,
      mode: e.meta.mode,
      salt: base64ToBytes(e.meta.salt),
      check: sealedFromJson(e.meta.check),
      ...(e.meta.wallet ? { wallet: getAddress(e.meta.wallet) } : {}),
      ...(e.meta.chainId !== undefined ? { chainId: e.meta.chainId } : {}),
    };
    const key = await keyFromMeta(null, meta, secret, opts);
    await verifyCheck(key, meta);
    const stale = (await kv.keys()).filter((k) => k.startsWith(REC) || k === DEVICE_KEY);
    await kv.batch(
      [...Object.entries(e.records).map(([slot, r]) => [REC + slot, sealedFromJson(r)] as [string, unknown]), [META, meta]],
      stale,
    );
    return new Vault(kv, key, meta.mode, meta.wallet);
  }

  /** Deletes the vault and its key. Irreversible. */
  static async destroy(kv: KV): Promise<void> {
    await kv.clear();
  }

  async read<T>(slot: string): Promise<T | undefined> {
    const sealed = (await this.kv.get(REC + slot)) as Sealed | undefined;
    if (!sealed) return undefined;
    try {
      return fromJson<T>(dec.decode(await open(this.key, slot, sealed)));
    } catch {
      throw new VaultError("Corrupt", `Stored ${slot} can't be decrypted`);
    }
  }

  async write(slot: string, value: unknown): Promise<void> {
    await this.kv.set(REC + slot, await seal(this.key, slot, enc.encode(toJson(value))));
  }

  /** True when the vault can be backed up: its key can be re-derived elsewhere (not a device key). */
  get syncable(): boolean {
    return this.mode !== "device";
  }

  /** The encrypted backup: base64(JSON) of the KDF metadata and every sealed record. No key. */
  async exportEnvelope(): Promise<string> {
    if (this.mode === "device") {
      throw new VaultError("NotSyncable", "A device-key vault can't be backed up; lock it with your wallet or a passphrase");
    }
    const meta = (await this.kv.get(META)) as VaultMeta;
    const records: Record<string, SealedJson> = {};
    for (const k of (await this.kv.keys()).sort()) {
      if (k.startsWith(REC)) records[k.slice(REC.length)] = sealedToJson((await this.kv.get(k)) as Sealed);
    }
    const e: Envelope = {
      format: ENVELOPE_FORMAT,
      v: 1,
      meta: {
        mode: this.mode,
        salt: bytesToBase64(meta.salt!),
        check: sealedToJson(meta.check),
        ...(meta.wallet ? { wallet: meta.wallet } : {}),
        ...(meta.chainId !== undefined ? { chainId: meta.chainId } : {}),
      },
      records,
    };
    return bytesToBase64(enc.encode(JSON.stringify(e)));
  }

  /**
   * Re-encrypts everything under a new lock (e.g. device key to wallet signature, so the vault can
   * be backed up). One transaction: the records, key and meta are replaced together.
   */
  async rekey(mode: VaultMode, secret?: string, opts: VaultOptions = {}): Promise<Vault> {
    const { key, meta, deviceKey } = await newKey(mode, secret, opts);
    const set: [string, unknown][] = [];
    for (const k of await this.kv.keys()) {
      if (!k.startsWith(REC)) continue;
      const slot = k.slice(REC.length);
      const plain = await open(this.key, slot, (await this.kv.get(k)) as Sealed);
      set.push([k, await seal(key, slot, plain)]);
    }
    if (deviceKey) set.push([DEVICE_KEY, deviceKey]);
    set.push([META, { ...meta, check: await seal(key, META, enc.encode(CHECK_TEXT)) } satisfies VaultMeta]);
    await this.kv.batch(set, deviceKey ? [] : [DEVICE_KEY]);
    return new Vault(this.kv, key, mode, meta.wallet);
  }

  /** Raw stored value, for tests asserting nothing is stored in plaintext. */
  async rawForTest(slot: string): Promise<unknown> {
    return this.kv.get(REC + slot);
  }
}
