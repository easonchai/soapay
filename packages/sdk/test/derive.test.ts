import { describe, it, expect } from 'vitest';
import { generateRandomStealthMetaAddress, checkStealthAddress, parseMetadata, VALID_SCHEME_ID } from '@scopelift/stealth-address-sdk';
import { deriveRows } from '../src/index.js';

const USDC = '0x036CbD53842c5426634e7929541eC2318f3dCF7e' as const;

describe('deriveRows', () => {
  it('derives an address the recipient can recognise, with ERC-20 metadata', () => {
    const r = generateRandomStealthMetaAddress();
    const row = deriveRows([{ input: 'x', metaAddress: r.stealthMetaAddress, amount: 1_000_000n }], USDC)[0]!;
    expect(checkStealthAddress({
      userStealthAddress: row.stealthAddress,
      viewTag: row.viewTag,
      ephemeralPublicKey: row.ephemeralPublicKey,
      spendingPublicKey: r.spendingPublicKey,
      viewingPrivateKey: r.viewingPrivateKey,
      schemeId: VALID_SCHEME_ID.SCHEME_ID_1,
    })).toBe(true);
    const md = parseMetadata(row.metadata);
    expect(md.viewTag.toLowerCase()).toBe(row.viewTag.toLowerCase());
    expect(md.contractAddress.toLowerCase()).toBe(USDC.toLowerCase());
    expect(BigInt(md.amount)).toBe(1_000_000n);
    expect(row.metadata.length).toBe(2 + 57 * 2);
    expect(row.ephemeralPublicKey.length).toBe(2 + 33 * 2);
  });

  it('gives a fresh address and ephemeral key each call for the same recipient', () => {
    const r = generateRandomStealthMetaAddress();
    const a = deriveRows([{ input: 'x', metaAddress: r.stealthMetaAddress, amount: 1n }], USDC)[0]!;
    const b = deriveRows([{ input: 'x', metaAddress: r.stealthMetaAddress, amount: 1n }], USDC)[0]!;
    expect(a.stealthAddress).not.toBe(b.stealthAddress);
    expect(a.ephemeralPublicKey).not.toBe(b.ephemeralPublicKey);
  });

  it('sorts strictly ascending by address', () => {
    const rows = Array.from({ length: 12 }, (_, i) => ({
      input: `r${i}`, metaAddress: generateRandomStealthMetaAddress().stealthMetaAddress, amount: 1n,
    }));
    const out = deriveRows(rows, USDC);
    expect(out).toHaveLength(12);
    for (let i = 1; i < out.length; i++) {
      expect(BigInt(out[i]!.stealthAddress) > BigInt(out[i - 1]!.stealthAddress)).toBe(true);
    }
  });
});
