import { describe, expect, it } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import {
  checkStealthAddress,
  computeStealthKey,
  generateRandomStealthMetaAddress,
  generateStealthAddress,
} from "@scopelift/stealth-address-sdk";
import { SCHEME_ID } from "../src/index.js";

// Smoke test that the upstream derivation path behaves as the PRD assumes:
// sender derives from the meta-address alone; recipient finds it by view tag
// and recovers a spending key that controls exactly that address.
describe("ERC-5564 scheme 1 round trip", () => {
  it("sender-derived address is detected and spendable by the recipient", () => {
    const keys = generateRandomStealthMetaAddress();
    const { stealthAddress, ephemeralPublicKey, viewTag } = generateStealthAddress({
      stealthMetaAddressURI: keys.stealthMetaAddressURI,
      schemeId: SCHEME_ID,
    });

    expect(
      checkStealthAddress({
        userStealthAddress: stealthAddress,
        ephemeralPublicKey,
        viewTag,
        spendingPublicKey: keys.spendingPublicKey,
        viewingPrivateKey: keys.viewingPrivateKey,
        schemeId: SCHEME_ID,
      }),
    ).toBe(true);

    const stealthKey = computeStealthKey({
      ephemeralPublicKey,
      spendingPrivateKey: keys.spendingPrivateKey,
      viewingPrivateKey: keys.viewingPrivateKey,
      schemeId: SCHEME_ID,
    });
    expect(privateKeyToAccount(stealthKey).address).toBe(stealthAddress);
  });

  it("never returns the same address twice for one meta-address", () => {
    const { stealthMetaAddressURI } = generateRandomStealthMetaAddress();
    const seen = new Set<string>();
    for (let i = 0; i < 50; i++) {
      seen.add(generateStealthAddress({ stealthMetaAddressURI, schemeId: SCHEME_ID }).stealthAddress);
    }
    expect(seen.size).toBe(50);
  });
});
