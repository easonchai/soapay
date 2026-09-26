import { describe, expect, it } from "vitest";
import { concat, keccak256, stringToHex, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount, privateKeyToAddress } from "viem/accounts";
import { generateKeysFromSignature, generateStealthMetaAddressFromKeys } from "@scopelift/stealth-address-sdk";
import {
  assertPlainEoa,
  assertPlainEoaSignature,
  keysFromMnemonic,
  keysFromSignature,
  keysFromWalletSignature,
  SIGN_MESSAGE,
  SignatureKeysUnsupported,
} from "../src/keys.js";

const alice = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");
const bob = privateKeyToAccount("0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a");

describe("wallet-signature keys (EOA-only option)", () => {
  it("signing twice with the same wallet yields the same keys (RFC 6979)", async () => {
    const s1 = await alice.signMessage({ message: SIGN_MESSAGE });
    const s2 = await alice.signMessage({ message: SIGN_MESSAGE });
    expect(s1).toBe(s2);
    const k1 = await keysFromWalletSignature({ address: alice.address, code: "0x", signature: s1, confirmSignature: s2 });
    const k2 = await keysFromWalletSignature({ address: alice.address, code: undefined, signature: s2 });
    expect(k2).toEqual(k1);
  });

  it("matches CK's M1 derivation: ScopeLift generateKeysFromSignature + domain-separated registrant", async () => {
    const sig = await alice.signMessage({ message: SIGN_MESSAGE });
    const k = keysFromSignature(sig);
    const ref = generateKeysFromSignature(sig);
    expect(k.spendingKey).toBe(ref.spendingPrivateKey);
    expect(k.viewingKey).toBe(ref.viewingPrivateKey);
    expect(k.spendingPublicKey).toBe(ref.spendingPublicKey);
    expect(k.viewingPublicKey).toBe(ref.viewingPublicKey);
    const meta = generateStealthMetaAddressFromKeys({ spendingPublicKey: ref.spendingPublicKey, viewingPublicKey: ref.viewingPublicKey });
    expect(k.metaAddressURI).toBe(`st:eth:${meta.toLowerCase()}`);
    const reg = keccak256(concat([sig, stringToHex("soapay/registrant/v1")]));
    expect(k.registrantKey).toBe(reg);
    expect(k.registrantAddress).toBe(privateKeyToAddress(reg));
  });

  it("different derivations yield different meta-addresses", async () => {
    const a = keysFromSignature(await alice.signMessage({ message: SIGN_MESSAGE }));
    const b = keysFromSignature(await bob.signMessage({ message: SIGN_MESSAGE }));
    const phrase = keysFromMnemonic("abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about");
    expect(new Set([a.metaAddressURI, b.metaAddressURI, phrase.metaAddressURI]).size).toBe(3);
    expect(new Set([a.registrantAddress, b.registrantAddress, phrase.registrantAddress]).size).toBe(3);
    // Spending, viewing and registrant keys are all distinct from each other.
    expect(new Set([a.spendingKey, a.viewingKey, a.registrantKey]).size).toBe(3);
  });

  it("refuses an address with code (smart account or 7702 delegate) before any signature", () => {
    expect(() => assertPlainEoa(alice.address, "0x6080604052")).toThrow(SignatureKeysUnsupported);
    expect(() => assertPlainEoa(alice.address, `0xef0100${"11".repeat(20)}` as Hex)).toThrow(/smart account/);
    expect(() => assertPlainEoa(alice.address, "0x")).not.toThrow();
  });

  it("refuses ERC-1271-style (non-65-byte) and ERC-6492 signatures", async () => {
    const long = `0x${"ab".repeat(200)}` as Hex;
    await expect(assertPlainEoaSignature({ address: alice.address, code: "0x", signature: long })).rejects.toMatchObject({
      reason: "not-ecdsa",
    });
    const wrapped = `0x${"cd".repeat(100)}${"6492".repeat(16)}` as Hex;
    await expect(assertPlainEoaSignature({ address: alice.address, code: "0x", signature: wrapped })).rejects.toMatchObject({
      reason: "erc6492",
    });
  });

  it("refuses a signature by another key", async () => {
    const sig = await bob.signMessage({ message: SIGN_MESSAGE });
    await expect(keysFromWalletSignature({ address: alice.address, code: "0x", signature: sig })).rejects.toMatchObject({
      reason: "wrong-signer",
    });
  });

  it("refuses a wallet that signs non-deterministically", async () => {
    const s1 = await alice.signMessage({ message: SIGN_MESSAGE });
    const other = privateKeyToAccount(generatePrivateKey());
    // Simulate a wallet whose second signature differs (same signer check passes on s1 only).
    const s2 = await other.signMessage({ message: SIGN_MESSAGE });
    await expect(
      keysFromWalletSignature({ address: alice.address, code: "0x", signature: s1, confirmSignature: s2 }),
    ).rejects.toMatchObject({ reason: "not-deterministic" });
  });
});
