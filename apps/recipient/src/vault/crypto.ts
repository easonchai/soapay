/**
 * Vault encryption. WebCrypto only, no dependencies.
 *
 * - KDF: PBKDF2-HMAC-SHA256, 600,000 iterations (OWASP 2023 minimum for SHA-256), 16-byte random salt.
 * - Cipher: AES-256-GCM, 12-byte random IV per write, 128-bit tag.
 * - The envelope header (format, version, KDF and cipher parameters) is bound as GCM additional data,
 *   so downgrading the iteration count or swapping the salt makes decryption fail.
 * - The derived key is non-extractable. The app keeps it in memory while unlocked so re-encrypting on
 *   every save does not re-run the KDF; locking drops it.
 */

export const VAULT_FORMAT = "soapay-vault";
export const VAULT_VERSION = 1;
export const PBKDF2_ITERATIONS = 600_000;
/** Refuse to open (or create) vaults weaker than this; protects against a tampered header. */
export const MIN_PBKDF2_ITERATIONS = 600_000;
export const MIN_PASSPHRASE_LENGTH = 10;

export type VaultHeader = {
  format: typeof VAULT_FORMAT;
  version: typeof VAULT_VERSION;
  kdf: { name: "PBKDF2"; hash: "SHA-256"; iterations: number; salt: string };
  cipher: { name: "AES-GCM"; iv: string };
};

export type VaultEnvelope = VaultHeader & { ciphertext: string; updatedAt: number };

export class WrongPassphraseError extends Error {
  override name = "WrongPassphraseError";
  constructor() {
    super("That passphrase does not unlock this vault.");
  }
}

export class VaultFormatError extends Error {
  override name = "VaultFormatError";
}

function subtle(): SubtleCrypto {
  const s = globalThis.crypto?.subtle;
  if (!s) throw new Error("WebCrypto is unavailable. Open the app over HTTPS or on localhost.");
  return s;
}

function random(n: number): Uint8Array<ArrayBuffer> {
  return globalThis.crypto.getRandomValues(new Uint8Array(n));
}

export function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

export function fromBase64(b64: string): Uint8Array<ArrayBuffer> {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

/** Canonical bytes of the header fields that parameterise decryption (the GCM additional data). */
function headerAad(h: VaultHeader): Uint8Array<ArrayBuffer> {
  const canonical = JSON.stringify([
    h.format,
    h.version,
    h.kdf.name,
    h.kdf.hash,
    h.kdf.iterations,
    h.kdf.salt,
    h.cipher.name,
    h.cipher.iv,
  ]);
  return new TextEncoder().encode(canonical);
}

export async function deriveVaultKey(passphrase: string, salt: Uint8Array<ArrayBuffer>, iterations: number): Promise<CryptoKey> {
  if (iterations < MIN_PBKDF2_ITERATIONS) throw new VaultFormatError(`KDF iterations below ${MIN_PBKDF2_ITERATIONS}`);
  const material = await subtle().importKey("raw", new TextEncoder().encode(passphrase.normalize("NFKC")), "PBKDF2", false, [
    "deriveKey",
  ]);
  return subtle().deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

/** Encrypts `data` under an already-derived key, with a fresh IV. `salt`/`iterations` describe that key. */
export async function sealWithKey(
  data: unknown,
  key: CryptoKey,
  kdf: { salt: string; iterations: number },
): Promise<VaultEnvelope> {
  const header: VaultHeader = {
    format: VAULT_FORMAT,
    version: VAULT_VERSION,
    kdf: { name: "PBKDF2", hash: "SHA-256", iterations: kdf.iterations, salt: kdf.salt },
    cipher: { name: "AES-GCM", iv: toBase64(random(12)) },
  };
  const plaintext = new TextEncoder().encode(JSON.stringify(data));
  const ct = await subtle().encrypt(
    { name: "AES-GCM", iv: fromBase64(header.cipher.iv), additionalData: headerAad(header), tagLength: 128 },
    key,
    plaintext,
  );
  plaintext.fill(0);
  return { ...header, ciphertext: toBase64(new Uint8Array(ct)), updatedAt: Date.now() };
}

export type UnlockedVault<T> = { data: T; key: CryptoKey; kdf: { salt: string; iterations: number } };

/** New vault: fresh salt, full-strength KDF. */
export async function createVault<T>(
  data: T,
  passphrase: string,
  opts: { iterations?: number } = {},
): Promise<{ envelope: VaultEnvelope } & UnlockedVault<T>> {
  if (passphrase.length < MIN_PASSPHRASE_LENGTH) {
    throw new Error(`Passphrase needs at least ${MIN_PASSPHRASE_LENGTH} characters.`);
  }
  const iterations = opts.iterations ?? PBKDF2_ITERATIONS;
  const kdf = { salt: toBase64(random(16)), iterations };
  const key = await deriveVaultKey(passphrase, fromBase64(kdf.salt), iterations);
  const envelope = await sealWithKey(data, key, kdf);
  return { envelope, data, key, kdf };
}

export function assertEnvelope(x: unknown): asserts x is VaultEnvelope {
  const e = x as Partial<VaultEnvelope> | null;
  if (
    !e ||
    e.format !== VAULT_FORMAT ||
    e.version !== VAULT_VERSION ||
    e.kdf?.name !== "PBKDF2" ||
    e.kdf.hash !== "SHA-256" ||
    typeof e.kdf.iterations !== "number" ||
    typeof e.kdf.salt !== "string" ||
    e.cipher?.name !== "AES-GCM" ||
    typeof e.cipher.iv !== "string" ||
    typeof e.ciphertext !== "string"
  ) {
    throw new VaultFormatError("This is not a Soapay vault file.");
  }
}

/** Decrypts a vault. Throws `WrongPassphraseError` on a bad passphrase or a tampered envelope. */
export async function openVault<T>(envelope: VaultEnvelope, passphrase: string): Promise<UnlockedVault<T>> {
  assertEnvelope(envelope);
  const kdf = { salt: envelope.kdf.salt, iterations: envelope.kdf.iterations };
  const key = await deriveVaultKey(passphrase, fromBase64(kdf.salt), kdf.iterations);
  let pt: ArrayBuffer;
  try {
    pt = await subtle().decrypt(
      { name: "AES-GCM", iv: fromBase64(envelope.cipher.iv), additionalData: headerAad(envelope), tagLength: 128 },
      key,
      fromBase64(envelope.ciphertext),
    );
  } catch {
    throw new WrongPassphraseError();
  }
  const bytes = new Uint8Array(pt);
  const data = JSON.parse(new TextDecoder().decode(bytes)) as T;
  bytes.fill(0);
  return { data, key, kdf };
}
