import { keccak256, concat, stringToHex, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { generateKeysFromSignature, generateStealthMetaAddressFromKeys } from '@scopelift/stealth-address-sdk';

/** Fixed text. Changing it changes every user's keys. */
export const SIGN_MESSAGE =
  'Soapay stealth keys v1\n\nSign to derive your private stealth keys. Only sign this inside Soapay. This signature never goes on-chain.';

export type StealthKeys = {
  spendingPrivateKey: Hex;
  spendingPublicKey: Hex;
  viewingPrivateKey: Hex;
  viewingPublicKey: Hex;
  registrantPrivateKey: Hex;
  registrant: Hex;
  stealthMetaAddress: Hex;
  stealthMetaAddressURI: string;
};

export function metaAddressToURI(meta: Hex): string {
  return `st:eth:${meta}`;
}

export function deriveKeysFromSignature(signature: Hex): StealthKeys {
  const k = generateKeysFromSignature(signature);
  const stealthMetaAddress = generateStealthMetaAddressFromKeys({
    spendingPublicKey: k.spendingPublicKey,
    viewingPublicKey: k.viewingPublicKey,
  });
  // Throwaway registrant: domain-separated from the stealth keys, recoverable from the same signature.
  const registrantPrivateKey = keccak256(concat([signature, stringToHex('soapay/registrant/v1')]));
  const registrant = privateKeyToAccount(registrantPrivateKey).address;
  return {
    ...k,
    registrantPrivateKey,
    registrant,
    stealthMetaAddress,
    stealthMetaAddressURI: metaAddressToURI(stealthMetaAddress),
  };
}
