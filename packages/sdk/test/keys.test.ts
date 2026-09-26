import { describe, expect, it } from "vitest";
import { bytesToHex } from "viem";
import { mnemonicToAccount, privateKeyToAccount } from "viem/accounts";
import {
  checkStealthAddress,
  computeStealthKey,
  generateStealthAddress,
  generateStealthMetaAddressFromKeys,
  parseKeysFromStealthMetaAddress,
  parseStealthMetaAddressURI,
} from "@scopelift/stealth-address-sdk";
import {
  formatMetaAddressURI,
  generateMnemonic,
  keysFromMnemonic,
  parseMetaAddress,
  validateMnemonic,
} from "../src/keys.js";
import { SCHEME_ID } from "../src/constants.js";

// Standard BIP-39 test mnemonic (all-zero entropy).
const MNEMONIC =
  "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";

const VECTOR = {
  spendingKey: "0x83f9b420651197ee5e2a2343b1a5c16bacef40cff26517dd1d9d73f14522988f",
  viewingKey: "0x7d2e7dc61461ce9f255416feca1dc18260be91ade2e71a4b1dc6183929a7a8ba",
  registrantKey: "0xff1498e5d588338b6986e42b9e93c8d9e0cfcd1684d82808567d5c2a9fb0c1ca",
  spendingPublicKey: "0x02685b1f14a993c8bf6765c48962ee424627af44784648957da529969ffad53a60",
  viewingPublicKey: "0x03d7b40aa766a99c5c5bc7950d795c41f869592b8be0a998e9d441b04c9c5fd0b1",
  registrantAddress: "0xE6f58b6b0071957ef676A7397dA31F3e20fa8374",
  metaAddressURI:
    "st:eth:0x02685b1f14a993c8bf6765c48962ee424627af44784648957da529969ffad53a6003d7b40aa766a99c5c5bc7950d795c41f869592b8be0a998e9d441b04c9c5fd0b1",
} as const;

describe("mnemonic", () => {
  it("generates valid 12- and 24-word English phrases", () => {
    const m12 = generateMnemonic();
    expect(m12.split(" ")).toHaveLength(12);
    expect(validateMnemonic(m12)).toBe(true);
    const m24 = generateMnemonic(256);
    expect(m24.split(" ")).toHaveLength(24);
    expect(validateMnemonic(m24)).toBe(true);
    expect(generateMnemonic()).not.toBe(m12);
  });

  it("rejects bad checksums and unknown words", () => {
    expect(validateMnemonic(MNEMONIC)).toBe(true);
    expect(validateMnemonic(MNEMONIC.replace(/about$/, "abandon"))).toBe(false);
    expect(validateMnemonic(MNEMONIC.replace(/about$/, "soapay"))).toBe(false);
    expect(() => keysFromMnemonic(MNEMONIC.replace(/about$/, "abandon"))).toThrow(/invalid mnemonic/);
  });
});

describe("keysFromMnemonic", () => {
  it("matches the fixed test vector", () => {
    expect(keysFromMnemonic(MNEMONIC)).toEqual(VECTOR);
  });

  it("tolerates extra whitespace and case", () => {
    expect(keysFromMnemonic(`  ${MNEMONIC.toUpperCase().replace(/ /g, "  ")}\n`)).toEqual(VECTOR);
  });

  it("agrees with viem's independent HD derivation at each path", () => {
    // viem types `path` as m/44'/60'/…; the derivation itself accepts any path.
    type ViemPath = `m/44'/60'/${string}`;
    const at = (path: string) => {
      const pk = mnemonicToAccount(MNEMONIC, { path: path as ViemPath }).getHdKey().privateKey;
      if (!pk) throw new Error("no key");
      return bytesToHex(pk);
    };
    expect(at("m/5564'/1'/0'")).toBe(VECTOR.spendingKey);
    expect(at("m/5564'/1'/1'")).toBe(VECTOR.viewingKey);
    expect(at("m/5564'/1'/2'")).toBe(VECTOR.registrantKey);
    expect(mnemonicToAccount(MNEMONIC, { path: "m/5564'/1'/2'" as `m/44'/60'/${string}` }).address).toBe(VECTOR.registrantAddress);
    expect(privateKeyToAccount(VECTOR.registrantKey).address).toBe(VECTOR.registrantAddress);
  });

  it("keys are distinct and a passphrase changes everything", () => {
    const k = keysFromMnemonic(MNEMONIC);
    expect(new Set([k.spendingKey, k.viewingKey, k.registrantKey]).size).toBe(3);
    const p = keysFromMnemonic(MNEMONIC, "TREZOR");
    expect(p.metaAddressURI).toBe(
      "st:eth:0x024bc271bf412cd2ac9415517691963f793fc6940a4f8ef0031ef29fe65177c3a502c1df7f827ffd063fa24e9aa5b141077ffebb09058c7cd6c9e48f5713919c488e",
    );
    expect(p.spendingKey).not.toBe(k.spendingKey);
  });

  it("meta-address matches ScopeLift's generateStealthMetaAddressFromKeys", () => {
    const k = keysFromMnemonic(MNEMONIC);
    const bytes = generateStealthMetaAddressFromKeys({
      spendingPublicKey: k.spendingPublicKey,
      viewingPublicKey: k.viewingPublicKey,
    });
    expect(`st:eth:${bytes}`).toBe(k.metaAddressURI);
    const parsed = parseStealthMetaAddressURI({ stealthMetaAddressURI: k.metaAddressURI, schemeId: SCHEME_ID });
    expect(parsed).toBe(bytes);
    const pub = parseKeysFromStealthMetaAddress({ stealthMetaAddress: parsed, schemeId: SCHEME_ID });
    expect(bytesToHex(pub.spendingPublicKey)).toBe(k.spendingPublicKey);
    expect(bytesToHex(pub.viewingPublicKey)).toBe(k.viewingPublicKey);
  });

  it("round trip: a ScopeLift payment to the meta-address is detected and spendable", () => {
    const k = keysFromMnemonic(MNEMONIC);
    for (let i = 0; i < 5; i++) {
      const { stealthAddress, ephemeralPublicKey, viewTag } = generateStealthAddress({
        stealthMetaAddressURI: k.metaAddressURI,
        schemeId: SCHEME_ID,
      });
      expect(
        checkStealthAddress({
          userStealthAddress: stealthAddress,
          ephemeralPublicKey,
          viewTag,
          spendingPublicKey: k.spendingPublicKey,
          viewingPrivateKey: k.viewingKey,
          schemeId: SCHEME_ID,
        }),
      ).toBe(true);
      const stealthKey = computeStealthKey({
        ephemeralPublicKey,
        spendingPrivateKey: k.spendingKey,
        viewingPrivateKey: k.viewingKey,
        schemeId: SCHEME_ID,
      });
      expect(privateKeyToAccount(stealthKey).address).toBe(stealthAddress);

      // A different seed must not detect it.
      const other = keysFromMnemonic(MNEMONIC, "other");
      expect(
        checkStealthAddress({
          userStealthAddress: stealthAddress,
          ephemeralPublicKey,
          viewTag,
          spendingPublicKey: other.spendingPublicKey,
          viewingPrivateKey: other.viewingKey,
          schemeId: SCHEME_ID,
        }),
      ).toBe(false);
    }
  });
});

describe("meta-address parsing", () => {
  const raw = VECTOR.metaAddressURI.slice("st:eth:".length);

  it("accepts URI or raw bytes, any case, and canonicalises", () => {
    expect(parseMetaAddress(VECTOR.metaAddressURI)).toBe(raw);
    expect(parseMetaAddress(raw)).toBe(raw);
    expect(parseMetaAddress(`0x${raw.slice(2).toUpperCase()}`)).toBe(raw);
    expect(formatMetaAddressURI(raw)).toBe(VECTOR.metaAddressURI);
  });

  it("rejects wrong length, bad prefix byte and off-curve points", () => {
    expect(() => parseMetaAddress(raw.slice(0, -2))).toThrow();
    expect(() => parseMetaAddress(`0x04${raw.slice(4)}`)).toThrow(/compressed/);
    // x = 5 has no point on secp256k1 (5^3 + 7 = 132 is a non-residue mod p).
    const offCurve = `0x02${"00".repeat(31)}05${raw.slice(68)}`;
    expect(() => parseMetaAddress(offCurve)).toThrow(/not on secp256k1/);
    expect(() => parseMetaAddress("st:eth:nothex")).toThrow();
  });
});
