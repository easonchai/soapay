/**
 * Passkey lock for the vault (owner decision D-35): the WebAuthn PRF extension instead of a passphrase.
 * Pure WebCrypto, no WebAuthn calls here (those live behind `PasskeyAuthenticator` in passkey.ts), so this
 * module is unit-testable in jsdom.
 *
 * - The passkey evaluates PRF over a fixed 32-byte app salt (`PRF_SALT`); the authenticator returns 32
 *   secret bytes that only that passkey, on this site's rp id, with user verification, can reproduce.
 * - KDF: HKDF-SHA256 over the PRF output, a 16-byte random salt per vault and a fixed `info`, giving a
 *   non-extractable AES-256-GCM key. It encrypts the same vault data the passphrase path encrypts.
 * - Cipher: AES-256-GCM, 12-byte random IV per write, 128-bit tag. The header (lock, KDF, cipher fields)
 *   is bound as additional data, like the passphrase envelope, so swapping the credential id or salts fails.
 *
 * The envelope records which lock it uses in `lock`; envelopes without it are passphrase vaults
 * (vault/crypto.ts), so vaults written before D-35 keep opening unchanged.
 */
import { VAULT_FORMAT, VAULT_VERSION, VaultFormatError, fromBase64, toBase64, type VaultEnvelope } from "./crypto.js";

/** Fixed app salt for the PRF evaluation. Changing it would lock every passkey vault out. Exactly 32 bytes. */
export const PRF_SALT: Uint8Array<ArrayBuffer> = new TextEncoder().encode("soapay:recipient-vault:prf:v1:00");
export const HKDF_INFO = "soapay-vault/passkey-prf/v1";

export type PasskeyLock = { kind: "passkey"; credentialId: string; prfSalt: string };
export type LockInfo = PasskeyLock | { kind: "passphrase" };
export type LockKind = LockInfo["kind"];

export type PasskeyHeader = {
  format: typeof VAULT_FORMAT;
  version: typeof VAULT_VERSION;
  lock: PasskeyLock;
  kdf: { name: "HKDF"; hash: "SHA-256"; salt: string; info: typeof HKDF_INFO };
  cipher: { name: "AES-GCM"; iv: string };
};

export type PasskeyEnvelope = PasskeyHeader & { ciphertext: string; updatedAt: number };

/** What IndexedDB holds: a passphrase envelope (no `lock`) or a passkey envelope. */
export type StoredEnvelope = VaultEnvelope | PasskeyEnvelope;

export type PasskeyParams = { lock: PasskeyLock; salt: string };

export class PasskeyUnlockError extends Error {
  override name = "PasskeyUnlockError";
  constructor() {
    super("That passkey does not unlock this vault.");
  }
}

function subtle(): SubtleCrypto {
  const s = globalThis.crypto?.subtle;
  if (!s) throw new Error("WebCrypto is unavailable. Open the app over HTTPS or on localhost.");
  return s;
}

const random = (n: number): Uint8Array<ArrayBuffer> => globalThis.crypto.getRandomValues(new Uint8Array(n));

export function isPasskeyEnvelope(e: StoredEnvelope | null | undefined): e is PasskeyEnvelope {
  return (e as Partial<PasskeyEnvelope> | null | undefined)?.lock?.kind === "passkey";
}

/** Which lock an envelope uses. Absence of `lock` means a passphrase vault (pre-D-35 format). */
export function lockOf(e: StoredEnvelope): LockInfo {
  return isPasskeyEnvelope(e) ? e.lock : { kind: "passphrase" };
}

function aad(h: PasskeyHeader): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(
    JSON.stringify([
      h.format,
      h.version,
      h.lock.kind,
      h.lock.credentialId,
      h.lock.prfSalt,
      h.kdf.name,
      h.kdf.hash,
      h.kdf.salt,
      h.kdf.info,
      h.cipher.name,
      h.cipher.iv,
    ]),
  );
}

/** HKDF-SHA256(prf output) → non-extractable AES-256-GCM key. */
export async function derivePasskeyKey(prfOutput: Uint8Array, salt: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  if (prfOutput.length < 32) throw new VaultFormatError("The passkey returned too little key material.");
  const material = await subtle().importKey("raw", new Uint8Array(prfOutput), "HKDF", false, ["deriveKey"]);
  return subtle().deriveKey(
    { name: "HKDF", hash: "SHA-256", salt, info: new TextEncoder().encode(HKDF_INFO) },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

/** Encrypts `data` under an already-derived passkey key, with a fresh IV. */
export async function sealWithPasskeyKey(data: unknown, key: CryptoKey, params: PasskeyParams): Promise<PasskeyEnvelope> {
  const header: PasskeyHeader = {
    format: VAULT_FORMAT,
    version: VAULT_VERSION,
    lock: { kind: "passkey", credentialId: params.lock.credentialId, prfSalt: params.lock.prfSalt },
    kdf: { name: "HKDF", hash: "SHA-256", salt: params.salt, info: HKDF_INFO },
    cipher: { name: "AES-GCM", iv: toBase64(random(12)) },
  };
  const plaintext = new TextEncoder().encode(JSON.stringify(data));
  const ct = await subtle().encrypt(
    { name: "AES-GCM", iv: fromBase64(header.cipher.iv), additionalData: aad(header), tagLength: 128 },
    key,
    plaintext,
  );
  plaintext.fill(0);
  return { ...header, ciphertext: toBase64(new Uint8Array(ct)), updatedAt: Date.now() };
}

export type UnlockedPasskeyVault<T> = { data: T; key: CryptoKey; params: PasskeyParams };

/** New passkey vault: fresh HKDF salt. `credentialId` is the passkey's raw id; `prfOutput` its PRF result over PRF_SALT. */
export async function createPasskeyVault<T>(
  data: T,
  credentialId: Uint8Array,
  prfOutput: Uint8Array,
): Promise<{ envelope: PasskeyEnvelope } & UnlockedPasskeyVault<T>> {
  const params: PasskeyParams = {
    lock: { kind: "passkey", credentialId: toBase64(credentialId), prfSalt: toBase64(PRF_SALT) },
    salt: toBase64(random(16)),
  };
  const key = await derivePasskeyKey(prfOutput, fromBase64(params.salt));
  const envelope = await sealWithPasskeyKey(data, key, params);
  return { envelope, data, key, params };
}

export function assertPasskeyEnvelope(x: unknown): asserts x is PasskeyEnvelope {
  const e = x as Partial<PasskeyEnvelope> | null;
  if (
    !e ||
    e.format !== VAULT_FORMAT ||
    e.version !== VAULT_VERSION ||
    e.lock?.kind !== "passkey" ||
    typeof e.lock.credentialId !== "string" ||
    typeof e.lock.prfSalt !== "string" ||
    e.kdf?.name !== "HKDF" ||
    e.kdf.hash !== "SHA-256" ||
    e.kdf.info !== HKDF_INFO ||
    typeof e.kdf.salt !== "string" ||
    e.cipher?.name !== "AES-GCM" ||
    typeof e.cipher.iv !== "string" ||
    typeof e.ciphertext !== "string"
  ) {
    throw new VaultFormatError("This is not a Soapay passkey vault.");
  }
}

/** Decrypts a passkey vault with the PRF output. Throws `PasskeyUnlockError` on a wrong passkey or tampering. */
export async function openPasskeyVault<T>(envelope: PasskeyEnvelope, prfOutput: Uint8Array): Promise<UnlockedPasskeyVault<T>> {
  assertPasskeyEnvelope(envelope);
  const params: PasskeyParams = { lock: envelope.lock, salt: envelope.kdf.salt };
  const key = await derivePasskeyKey(prfOutput, fromBase64(params.salt));
  let pt: ArrayBuffer;
  try {
    pt = await subtle().decrypt(
      { name: "AES-GCM", iv: fromBase64(envelope.cipher.iv), additionalData: aad(envelope), tagLength: 128 },
      key,
      fromBase64(envelope.ciphertext),
    );
  } catch {
    throw new PasskeyUnlockError();
  }
  const bytes = new Uint8Array(pt);
  const data = JSON.parse(new TextDecoder().decode(bytes)) as T;
  bytes.fill(0);
  return { data, key, params };
}
