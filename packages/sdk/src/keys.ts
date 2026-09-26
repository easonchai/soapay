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
import {
  bytesToHex,
  concat,
  hexToBytes,
  isHex,
  keccak256,
  recoverMessageAddress,
  stringToHex,
  type Address,
  type Hex,
} from "viem";
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

// ---------------------------------------------------------------------------
// Wallet-signature keys (CK's M1 derivation), an OPTION for plain EOAs only.
//
// The recovery phrase above stays the default. This path derives the same key set from one
// personal_sign signature over SIGN_MESSAGE: spending = keccak256(r), viewing = keccak256(s)
// (identical to ScopeLift `generateKeysFromSignature`), registrant = keccak256(sig ‖
// "soapay/registrant/v1"). Recovery = sign the same message again with the same wallet.
//
// That only works when the wallet's signature is a deterministic 65-byte ECDSA signature by the
// address's own key (RFC 6979). Smart accounts and passkey wallets return ERC-1271 / ERC-6492
// signatures that can change per request or per deployment, which would silently lose funds, so
// they are refused: the address must have no code and the signature must recover to it.

/** Fixed text. Changing it changes every signature-derived user's keys. */
export const SIGN_MESSAGE =
  "Soapay stealth keys v1\n\nSign to derive your private stealth keys. Only sign this inside Soapay. This signature never goes on-chain.";

/** Domain separator for the registrant key derived from the signature. */
export const SIGNATURE_REGISTRANT_DOMAIN = "soapay/registrant/v1";

/** ERC-6492 wrapped-signature magic suffix (counterfactual smart accounts). */
const ERC6492_MAGIC = "6492649264926492649264926492649264926492649264926492649264926492";

export type SignatureKeysRefusal = "has-code" | "erc6492" | "not-ecdsa" | "wrong-signer" | "not-deterministic";

export class SignatureKeysUnsupported extends Error {
  readonly reason: SignatureKeysRefusal;
  constructor(reason: SignatureKeysRefusal, message: string) {
    super(message);
    this.name = "SignatureKeysUnsupported";
    this.reason = reason;
  }
}

const SMART_WALLET_HELP =
  "Wallet-signature keys work only with a plain EOA wallet (MetaMask, Rabby, a hardware wallet). " +
  "Smart and passkey wallets can't derive stable keys from a signature. Use a recovery phrase instead.";

/**
 * Throws `SignatureKeysUnsupported` unless `code` (eth_getCode of `address`) is empty. Run it
 * BEFORE asking for a signature, so a smart wallet is refused up front. An EIP-7702 delegated
 * EOA counts as having code: its wallet may answer through ERC-1271.
 */
export function assertPlainEoa(address: Address, code: Hex | undefined): void {
  if (code && code !== "0x") {
    throw new SignatureKeysUnsupported("has-code", `${address} is a smart account (it has code). ${SMART_WALLET_HELP}`);
  }
}

/**
 * Throws `SignatureKeysUnsupported` unless `signature` is a plain 65-byte ECDSA signature over
 * SIGN_MESSAGE by `address` itself and `address` has no code.
 */
export async function assertPlainEoaSignature(params: { address: Address; code: Hex | undefined; signature: Hex }): Promise<void> {
  const { address, code, signature } = params;
  assertPlainEoa(address, code);
  const sig = signature.toLowerCase();
  if (sig.endsWith(ERC6492_MAGIC)) {
    throw new SignatureKeysUnsupported("erc6492", `The wallet returned an ERC-6492 smart-account signature. ${SMART_WALLET_HELP}`);
  }
  if (!isHex(sig, { strict: true }) || sig.length !== 2 + 65 * 2) {
    throw new SignatureKeysUnsupported(
      "not-ecdsa",
      `The wallet returned a ${Math.max(0, (sig.length - 2) / 2)}-byte signature, not a 65-byte ECDSA one (ERC-1271 wallet?). ${SMART_WALLET_HELP}`,
    );
  }
  let signer: Address;
  try {
    signer = await recoverMessageAddress({ message: SIGN_MESSAGE, signature });
  } catch {
    throw new SignatureKeysUnsupported("not-ecdsa", `The signature doesn't recover to an address. ${SMART_WALLET_HELP}`);
  }
  if (signer.toLowerCase() !== address.toLowerCase()) {
    throw new SignatureKeysUnsupported("wrong-signer", `The signature was not made by ${address}'s own key. ${SMART_WALLET_HELP}`);
  }
}

/**
 * Pure: derive every Soapay key from one 65-byte signature over SIGN_MESSAGE. Callers must have
 * run `assertPlainEoaSignature` (`keysFromWalletSignature` does both).
 */
export function keysFromSignature(signature: Hex): SoapayKeys {
  if (!isHex(signature, { strict: true }) || signature.length !== 2 + 65 * 2) {
    throw new Error("Soapay: key signature must be 65 bytes");
  }
  const sig = signature.toLowerCase() as Hex;
  const spendingKey = keccak256(`0x${sig.slice(2, 66)}`);
  const viewingKey = keccak256(`0x${sig.slice(66, 130)}`);
  const registrantKey = keccak256(concat([sig, stringToHex(SIGNATURE_REGISTRANT_DOMAIN)]));
  const spendingPublicKey = bytesToHex(secp256k1.getPublicKey(hexToBytes(spendingKey), true));
  const viewingPublicKey = bytesToHex(secp256k1.getPublicKey(hexToBytes(viewingKey), true));
  return {
    spendingKey,
    viewingKey,
    registrantKey,
    spendingPublicKey,
    viewingPublicKey,
    registrantAddress: privateKeyToAddress(registrantKey),
    metaAddressURI: formatMetaAddressURI(`0x${spendingPublicKey.slice(2)}${viewingPublicKey.slice(2)}`),
  };
}

/**
 * Wallet-signature keys with every guard: plain EOA only, and, when a second signature is given,
 * the wallet must sign deterministically (both identical), else signing again later would not
 * recover the keys.
 */
export async function keysFromWalletSignature(params: {
  address: Address;
  code: Hex | undefined;
  signature: Hex;
  confirmSignature?: Hex | undefined;
}): Promise<SoapayKeys> {
  await assertPlainEoaSignature(params);
  if (params.confirmSignature !== undefined && params.confirmSignature.toLowerCase() !== params.signature.toLowerCase()) {
    throw new SignatureKeysUnsupported(
      "not-deterministic",
      "This wallet signed the same message two different ways, so signing again would not recover your keys. Use a recovery phrase instead.",
    );
  }
  return keysFromSignature(params.signature);
}
