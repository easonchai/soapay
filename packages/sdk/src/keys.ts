/**
 * Recipient key material (docs/mvp-spec.md §3, `keys.ts`).
 *
 * RECOVERY: the BIP-39 seed phrase (plus optional passphrase) is the ONLY secret a
 * recipient must back up. Every key below (spending, viewing and registrant) is
 * derived deterministically from it, so the seed alone recovers the meta-address,
 * the registry entry and every stealth payment ever received (PRD: Recovery).
 *
 * Never log, persist in plaintext, or send any value returned by `keysFromMnemonic`
 * except the public fields (public keys, registrantAddress, metaAddressURI).
 * Spending keys never leave the client (CLAUDE.md).
 */
import {
  generateMnemonic as bip39Generate,
  mnemonicToSeedSync,
  validateMnemonic as bip39Validate,
} from "@scure/bip39";
import { wordlist as english } from "@scure/bip39/wordlists/english.js";
import { HDKey } from "@scure/bip32";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { bytesToHex, hexToBytes, isHex, type Address, type Hex } from "viem";
import { privateKeyToAddress } from "viem/accounts";

/** BIP-32 derivation paths (ERC-5564 purpose 5564', scheme 1'). All hardened. */
export const SPENDING_KEY_PATH = "m/5564'/1'/0'";
export const VIEWING_KEY_PATH = "m/5564'/1'/1'";
export const REGISTRANT_KEY_PATH = "m/5564'/1'/2'";

/** ERC-5564 meta-address URI prefix for Ethereum (scheme 1, secp256k1). */
export const META_ADDRESS_URI_PREFIX = "st:eth:";

export type SoapayKeys = {
  /** SECRET. Spends every stealth payment; never leaves the client. */
  spendingKey: Hex;
  /** SECRET. Detects incoming payments (read-only capability). */
  viewingKey: Hex;
  /** SECRET. Signs ERC-6538 registration and name claims; holds no funds. */
  registrantKey: Hex;
  /** 33-byte compressed secp256k1 public key. */
  spendingPublicKey: Hex;
  /** 33-byte compressed secp256k1 public key. */
  viewingPublicKey: Hex;
  registrantAddress: Address;
  /** `st:eth:0x` + spendingPublicKey + viewingPublicKey (ERC-5564 scheme 1). */
  metaAddressURI: string;
};

/** New English BIP-39 mnemonic. 128 bits of entropy = 12 words, 256 = 24 words. */
export function generateMnemonic(strength: 128 | 160 | 192 | 224 | 256 = 128): string {
  return bip39Generate(english, strength);
}

/** True iff `mnemonic` is a valid English BIP-39 phrase (wordlist and checksum). */
export function validateMnemonic(mnemonic: string): boolean {
  return bip39Validate(normalizeMnemonic(mnemonic), english);
}

function normalizeMnemonic(mnemonic: string): string {
  return mnemonic.normalize("NFKD").trim().toLowerCase().split(/\s+/).join(" ");
}

function derivePrivateKey(root: HDKey, path: string): Uint8Array {
  const child = root.derive(path);
  const key = child.privateKey;
  if (!key) throw new Error("Soapay: key derivation failed");
  const copy = Uint8Array.from(key);
  child.wipePrivateData();
  return copy;
}

/**
 * Derive every Soapay key from a seed phrase. Deterministic: the same mnemonic and
 * passphrase always give the same keys and meta-address.
 */
export function keysFromMnemonic(mnemonic: string, passphrase?: string): SoapayKeys {
  const phrase = normalizeMnemonic(mnemonic);
  if (!bip39Validate(phrase, english)) throw new Error("Soapay: invalid mnemonic");

  const seed = mnemonicToSeedSync(phrase, passphrase ?? "");
  const root = HDKey.fromMasterSeed(seed);
  seed.fill(0);
  try {
    const spend = derivePrivateKey(root, SPENDING_KEY_PATH);
    const view = derivePrivateKey(root, VIEWING_KEY_PATH);
    const reg = derivePrivateKey(root, REGISTRANT_KEY_PATH);

    const spendingPublicKey = bytesToHex(secp256k1.getPublicKey(spend, true));
    const viewingPublicKey = bytesToHex(secp256k1.getPublicKey(view, true));
    const registrantKey = bytesToHex(reg);

    const keys: SoapayKeys = {
      spendingKey: bytesToHex(spend),
      viewingKey: bytesToHex(view),
      registrantKey,
      spendingPublicKey,
      viewingPublicKey,
      registrantAddress: privateKeyToAddress(registrantKey),
      metaAddressURI: formatMetaAddressURI(
        `0x${spendingPublicKey.slice(2)}${viewingPublicKey.slice(2)}` as Hex,
      ),
    };
    spend.fill(0);
    view.fill(0);
    reg.fill(0);
    return keys;
  } finally {
    root.wipePrivateData();
  }
}

function assertCompressedPoint(bytes: Uint8Array, what: string): void {
  if (bytes.length !== 33 || (bytes[0] !== 0x02 && bytes[0] !== 0x03)) {
    throw new Error(`Soapay: ${what} is not a 33-byte compressed public key`);
  }
  try {
    secp256k1.Point.fromBytes(bytes).assertValidity();
  } catch {
    throw new Error(`Soapay: ${what} is not on secp256k1`);
  }
}

/**
 * Parse a scheme-1 stealth meta-address given either as a URI (`st:eth:0x…`) or as
 * raw 66-byte hex (the ERC-6538 registry form). Returns lowercase 66-byte hex.
 * Throws if it is not two valid compressed secp256k1 points.
 */
export function parseMetaAddress(input: string): Hex {
  const raw = input.trim();
  const hex = raw.toLowerCase().startsWith(META_ADDRESS_URI_PREFIX)
    ? raw.slice(META_ADDRESS_URI_PREFIX.length)
    : raw;
  if (!isHex(hex, { strict: true }) || hex.length !== 2 + 66 * 2) {
    throw new Error("Soapay: meta-address must be 66 bytes (spend || view, compressed)");
  }
  const bytes = hexToBytes(hex);
  assertCompressedPoint(bytes.subarray(0, 33), "spending public key");
  assertCompressedPoint(bytes.subarray(33), "viewing public key");
  return hex.toLowerCase() as Hex;
}

/** `st:eth:0x…` URI for a meta-address (URI or raw bytes), canonical lowercase. */
export function formatMetaAddressURI(metaAddress: string): string {
  return `${META_ADDRESS_URI_PREFIX}${parseMetaAddress(metaAddress)}`;
}
