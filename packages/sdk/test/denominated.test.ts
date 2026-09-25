import { describe, it, expect } from 'vitest';
import { generateRandomStealthMetaAddress } from '@scopelift/stealth-address-sdk';
import { expandDenominated, deriveRows, TooManyLinesError, MAX_LINES_PER_RUN } from '../src/index.js';

const USDC = '0x036CbD53842c5426634e7929541eC2318f3dCF7e' as const;
const meta = () => generateRandomStealthMetaAddress().stealthMetaAddress;
const u = (n: number) => BigInt(Math.round(n * 1e6));

describe('expandDenominated', () => {
  it('splits into equal chunks plus one smaller remainder line', () => {
    const out = expandDenominated([{ input: 'a', metaAddress: meta(), amount: u(4200) }], u(500));
    expect(out.map((l) => l.amount)).toEqual([...Array(8).fill(u(500)), u(200)]);
    expect(out.every((l) => l.input === 'a')).toBe(true);
    expect(out[0]!.chunkIndex).toBe(0);
    expect(out[8]!.chunkIndex).toBe(8);
    expect(out[8]!.isRemainder).toBe(true);
  });
  it('exact multiple has no remainder line', () => {
    const out = expandDenominated([{ input: 'a', metaAddress: meta(), amount: u(1000) }], u(500));
    expect(out.map((l) => l.amount)).toEqual([u(500), u(500)]);
  });
  it('amount below the chunk is a single line', () => {
    const out = expandDenominated([{ input: 'a', metaAddress: meta(), amount: u(200) }], u(500));
    expect(out).toHaveLength(1);
    expect(out[0]!.amount).toBe(u(200));
    expect(out[0]!.isRemainder).toBe(true);
  });
  it('rejects a non-positive chunk', () => {
    expect(() => expandDenominated([{ input: 'a', metaAddress: meta(), amount: u(1) }], 0n)).toThrow(/chunk/i);
  });
});

describe('deriveRows with chunking', () => {
  it('gives every chunk its own fresh address and keeps global ascending order', () => {
    const rows = deriveRows(
      [
        { input: 'a', metaAddress: meta(), amount: u(1200) },
        { input: 'b', metaAddress: meta(), amount: u(500) },
      ],
      USDC,
      { chunk: u(500) },
    );
    expect(rows).toHaveLength(4); // 500,500,200 + 500
    expect(new Set(rows.map((r) => r.stealthAddress)).size).toBe(4);
    for (let i = 1; i < rows.length; i++) expect(BigInt(rows[i]!.stealthAddress) > BigInt(rows[i - 1]!.stealthAddress)).toBe(true);
    expect(rows.filter((r) => r.input === 'a').reduce((s, r) => s + r.amount, 0n)).toBe(u(1200));
  });
  it('throws TooManyLinesError past the per-run cap', () => {
    expect(MAX_LINES_PER_RUN).toBe(350);
    expect(() =>
      deriveRows([{ input: 'a', metaAddress: meta(), amount: u(351 * 10) }], USDC, { chunk: u(10) }),
    ).toThrow(TooManyLinesError);
  });
});
