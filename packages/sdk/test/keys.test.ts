import { describe, it, expect } from 'vitest';
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts';
import { deriveKeysFromSignature, SIGN_MESSAGE, metaAddressToURI } from '../src/index.js';

const PK = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d' as const;
async function sig() {
  return privateKeyToAccount(PK).signMessage({ message: SIGN_MESSAGE });
}

describe('deriveKeysFromSignature', () => {
  it('is deterministic for the same signature', async () => {
    const s = await sig();
    expect(deriveKeysFromSignature(s)).toEqual(deriveKeysFromSignature(s));
  });

  it('produces a 66-byte meta-address and matching URI', async () => {
    const k = deriveKeysFromSignature(await sig());
    expect(k.stealthMetaAddress).toMatch(/^0x[0-9a-f]{132}$/i);
    expect(k.stealthMetaAddressURI).toBe(`st:eth:${k.stealthMetaAddress}`);
    expect(metaAddressToURI(k.stealthMetaAddress)).toBe(k.stealthMetaAddressURI);
  });

  it('registrant differs from the signer and from the stealth keys', async () => {
    const k = deriveKeysFromSignature(await sig());
    expect(k.registrant).not.toBe(privateKeyToAccount(PK).address);
    expect(k.registrantPrivateKey).not.toBe(k.spendingPrivateKey);
    expect(k.registrantPrivateKey).not.toBe(k.viewingPrivateKey);
    expect(privateKeyToAccount(k.registrantPrivateKey).address).toBe(k.registrant);
  });

  it('different signers give different keys', async () => {
    const other = privateKeyToAccount(generatePrivateKey());
    const s2 = await other.signMessage({ message: SIGN_MESSAGE });
    expect(deriveKeysFromSignature(await sig()).stealthMetaAddress)
      .not.toBe(deriveKeysFromSignature(s2).stealthMetaAddress);
  });
});
