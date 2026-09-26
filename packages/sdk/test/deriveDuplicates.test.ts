import { describe, it, expect, vi } from 'vitest';

// Force the SDK to repeat outputs so the duplicate guards in deriveRows are exercised.
let mode: 'same-address' | 'same-ephemeral' = 'same-address';
vi.mock('@scopelift/stealth-address-sdk', async (importOriginal) => {
  const m = await importOriginal<typeof import('@scopelift/stealth-address-sdk')>();
  let first: ReturnType<typeof m.generateStealthAddress> | undefined;
  return {
    ...m,
    generateStealthAddress: (args: Parameters<typeof m.generateStealthAddress>[0]) => {
      const real = m.generateStealthAddress(args);
      if (!first) {
        first = real;
        return real;
      }
      return mode === 'same-address' ? first : { ...real, ephemeralPublicKey: first.ephemeralPublicKey };
    },
  };
});

import { generateRandomStealthMetaAddress } from '@scopelift/stealth-address-sdk';
import { deriveRows, DuplicateStealthAddressError, DuplicateEphemeralKeyError } from '../src/index.js';

const USDC = '0x036CbD53842c5426634e7929541eC2318f3dCF7e' as const;
const two = () => [
  { input: 'a', metaAddress: generateRandomStealthMetaAddress().stealthMetaAddress, amount: 1n },
  { input: 'b', metaAddress: generateRandomStealthMetaAddress().stealthMetaAddress, amount: 2n },
];

describe('deriveRows duplicate guards', () => {
  it('aborts when two rows derive the same stealth address', () => {
    mode = 'same-address';
    expect(() => deriveRows(two(), USDC)).toThrow(DuplicateStealthAddressError);
  });
  it('aborts when an ephemeral key repeats across rows', () => {
    mode = 'same-ephemeral';
    expect(() => deriveRows(two(), USDC)).toThrow(DuplicateEphemeralKeyError);
  });
});
