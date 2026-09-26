/**
 * Passkey-synced vault backup (D-63). Pure WebCrypto + viem signing, no I/O, so it is unit-testable.
 *
 * The vault's passkey already evaluates PRF over the fixed app salt `PRF_SALT` (passkeyCrypto.ts). From
 * that same 32-byte PRF output this module derives, with HKDF-SHA256 and fixed info strings:
 *
 *  - a non-extractable AES-256-GCM key that encrypts the backup, and
 *  - a secp256k1 "backup signer" key (48 HKDF bytes reduced mod n, 0 rejected). Its address names the
 *    backup on the API and its EIP-191 signature authorises each upload.
 *
 * Nothing here depends on local state (no per-vault salt): a fresh browser with the same synced passkey
 * reproduces the same keys and address. The signer is not derived from the recovery phrase, so the
 * backup address has no link to the user's stealth, registrant or name keys.
 *
 * Ciphertext wire format (base64): `0x01 | iv (12) | AES-GCM ciphertext + 128-bit tag`. The additional
 * data binds the backup address and the upload version, so the server can't relabel an old ciphertext
 * as a newer version or move it to another address.
 */
import { getAddress, keccak256, numberToHex, stringToBytes, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { fromBase64, toBase64 } from "./crypto.js";

export const BACKUP_FORMAT_BYTE = 0x01;
/** Fixed HKDF salt. Changing it (or the info strings) would orphan every existing backup. */
export const BACKUP_HKDF_SALT = "soapay-backup/v1/salt";
export const BACKUP_ENC_INFO = "soapay-backup/v1/aes-256-gcm";
export const BACKUP_SIGNER_INFO = "soapay-backup/v1/secp256k1-signer";
/** The API's limit on the base64 ciphertext. */
export const MAX_BACKUP_CIPHERTEXT = 512 * 1024;

export class BackupDecryptError extends Error {
  override name = "BackupDecryptError";
  constructor() {
    super("This backup can't be opened with this passkey.");
  }
}

export class BackupTooLargeError extends Error {
  override name = "BackupTooLargeError";
  constructor(size: number) {
    super(`The encrypted backup is ${Math.ceil(size / 1024)} KiB, over the ${MAX_BACKUP_CIPHERTEXT / 1024} KiB limit.`);
  }
}

/** In-memory backup keys for an unlocked passkey vault. Never persisted; dropped on lock. */
export type BackupKeys = {
  /** Checksummed address of the backup signer. */
  address: Address;
  /** Encrypts `data` for upload as `version`. */
  seal(data: unknown, version: number): Promise<string>;
  /** Decrypts a downloaded backup. Throws `BackupDecryptError`. */
  open<T>(ciphertext: string, version: number): Promise<T>;
  /** EIP-191 personal_sign by the backup signer. */
  signMessage(message: string): Promise<Hex>;
};

function subtle(): SubtleCrypto {
  const s = globalThis.crypto?.subtle;
  if (!s) throw new Error("WebCrypto is unavailable. Open the app over HTTPS or on localhost.");
  return s;
}

const utf8 = (s: string) => new TextEncoder().encode(s);

async function hkdfMaterial(prf: Uint8Array): Promise<CryptoKey> {
  if (prf.length < 32) throw new Error("The passkey returned too little key material.");
  return subtle().importKey("raw", new Uint8Array(prf), "HKDF", false, ["deriveKey", "deriveBits"]);
}

const hkdf = (info: string) => ({ name: "HKDF", hash: "SHA-256", salt: utf8(BACKUP_HKDF_SALT), info: utf8(info) });

/**
 * The backup signer's private key scalar: 48 HKDF bytes (384 bits, so the mod-n bias is ~2^-128)
 * reduced mod the secp256k1 order. Throws on the (practically impossible) zero scalar.
 */
export async function backupSignerKey(prf: Uint8Array): Promise<Hex> {
  const bits = new Uint8Array(await subtle().deriveBits(hkdf(BACKUP_SIGNER_INFO), await hkdfMaterial(prf), 384));
  let x = 0n;
  for (const b of bits) x = (x << 8n) | BigInt(b);
  bits.fill(0);
  const k = x % secp256k1.Point.CURVE().n;
  if (k === 0n) throw new Error("Backup signer key derivation produced zero.");
  return numberToHex(k, { size: 32 });
}

function aad(address: Address, version: number): Uint8Array<ArrayBuffer> {
  return utf8(`soapay-backup:v1:${address}:${version}`);
}

/** Derives the backup keys from the vault passkey's PRF output (over PRF_SALT). */
export async function deriveBackupKeys(prf: Uint8Array): Promise<BackupKeys> {
  const material = await hkdfMaterial(prf);
  const encKey = await subtle().deriveKey(hkdf(BACKUP_ENC_INFO), material, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  // viem keeps the key inside the account's closure; we never read it back out.
  const account = privateKeyToAccount(await backupSignerKey(prf));
  const address = getAddress(account.address);

  return {
    address,
    async seal(data, version) {
      const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
      const plaintext = utf8(JSON.stringify(data));
      const ct = new Uint8Array(
        await subtle().encrypt({ name: "AES-GCM", iv, additionalData: aad(address, version), tagLength: 128 }, encKey, plaintext),
      );
      plaintext.fill(0);
      const out = new Uint8Array(1 + iv.length + ct.length);
      out[0] = BACKUP_FORMAT_BYTE;
      out.set(iv, 1);
      out.set(ct, 1 + iv.length);
      const b64 = toBase64(out);
      if (b64.length > MAX_BACKUP_CIPHERTEXT) throw new BackupTooLargeError(b64.length);
      return b64;
    },
    async open<T>(ciphertext: string, version: number): Promise<T> {
      let bytes: Uint8Array<ArrayBuffer>;
      try {
        bytes = fromBase64(ciphertext);
      } catch {
        throw new BackupDecryptError();
      }
      if (bytes.length < 1 + 12 + 16 || bytes[0] !== BACKUP_FORMAT_BYTE) throw new BackupDecryptError();
      let pt: Uint8Array;
      try {
        pt = new Uint8Array(
          await subtle().decrypt(
            { name: "AES-GCM", iv: bytes.slice(1, 13), additionalData: aad(address, version), tagLength: 128 },
            encKey,
            bytes.slice(13),
          ),
        );
      } catch {
        throw new BackupDecryptError();
      }
      const data = JSON.parse(new TextDecoder().decode(pt)) as T;
      pt.fill(0);
      return data;
    },
    signMessage: (message) => account.signMessage({ message }),
  };
}

/** The exact message the API verifies for `PUT /backups/:address` (EIP-191 personal_sign). */
export function backupSigningMessage(address: Address, version: number, ciphertext: string): string {
  return `soapay-backup:v1:${getAddress(address)}:${version}:${keccak256(stringToBytes(ciphertext))}`;
}

/** SHA-256 over the backed-up content, to skip uploads when nothing changed. */
export async function contentHash(data: unknown): Promise<string> {
  const d = new Uint8Array(await subtle().digest("SHA-256", utf8(JSON.stringify(data))));
  return Array.from(d, (b) => b.toString(16).padStart(2, "0")).join("");
}
