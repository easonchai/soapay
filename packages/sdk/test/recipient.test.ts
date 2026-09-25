import { describe, it, expect } from 'vitest';
import { generateRandomStealthMetaAddress } from '@scopelift/stealth-address-sdk';
import { parseRecipient, parseAmount, resolveRecipient, parseBatchText } from '../src/index.js';

const meta = generateRandomStealthMetaAddress().stealthMetaAddress;
const REG = '0x1111111111111111111111111111111111111111' as const;

describe('parseRecipient', () => {
  it('detects ENS, registrant and meta inputs', () => {
    expect(parseRecipient(' Alice.ETH ')).toEqual({ kind: 'ens', name: 'alice.eth' });
    expect(parseRecipient('bob.base.eth')).toEqual({ kind: 'ens', name: 'bob.base.eth' });
    expect(parseRecipient(REG)).toEqual({ kind: 'registrant', address: REG });
    expect(parseRecipient(`st:eth:${meta}`)).toEqual({ kind: 'meta', metaAddress: meta.toLowerCase() });
  });
  it('rejects garbage', () => {
    expect(() => parseRecipient('hello')).toThrow(/not a name, address or meta-address/i);
    expect(() => parseRecipient('st:eth:0x1234')).toThrow(/meta-address/i);
    expect(() => parseRecipient('0x12')).toThrow();
  });
});

describe('parseAmount', () => {
  it('parses USDC amounts', () => {
    expect(parseAmount('500', 6)).toBe(500_000_000n);
    expect(parseAmount('0.5', 6)).toBe(500_000n);
  });
  it('rejects too many decimals, zero, negative, junk', () => {
    expect(() => parseAmount('1.1234567', 6)).toThrow(/decimals/i);
    expect(() => parseAmount('0', 6)).toThrow(/greater than zero/i);
    expect(() => parseAmount('-1', 6)).toThrow();
    expect(() => parseAmount('abc', 6)).toThrow();
  });
});

describe('resolveRecipient', () => {
  const deps = {
    getEnsAddress: async (n: string) => (n === 'alice.eth' ? REG : null),
    getRegistryMeta: async (r: `0x${string}`) => (r === REG ? meta : ('0x' as `0x${string}`)),
  };
  it('resolves a name through the registry', async () => {
    const r = await resolveRecipient('alice.eth', deps);
    expect(r).toEqual({ status: 'ok', input: 'alice.eth', registrant: REG, metaAddress: meta.toLowerCase() });
  });
  it('resolves a raw meta-address without network', async () => {
    const r = await resolveRecipient(`st:eth:${meta}`, { ...deps, getEnsAddress: async () => { throw new Error('no'); } });
    expect(r.status).toBe('ok');
  });
  it('errors on unresolved name and on empty registry', async () => {
    expect((await resolveRecipient('nobody.eth', deps)).status).toBe('error');
    const r = await resolveRecipient('0x2222222222222222222222222222222222222222', deps);
    expect(r).toMatchObject({ status: 'error', message: expect.stringMatching(/no stealth meta-address registered/i) });
  });
  it('flags a changed meta-address against the pin', async () => {
    const other = generateRandomStealthMetaAddress().stealthMetaAddress;
    const r = await resolveRecipient('alice.eth', { ...deps, pin: { metaAddress: other, pinnedAt: 1 } });
    expect(r).toMatchObject({ status: 'changed', pinned: other, metaAddress: meta.toLowerCase() });
  });
  it('is ok when pin matches', async () => {
    const r = await resolveRecipient('alice.eth', { ...deps, pin: { metaAddress: meta, pinnedAt: 1 } });
    expect(r.status).toBe('ok');
  });
});

describe('parseBatchText', () => {
  it('parses lines, skips blanks, reports bad lines with numbers', () => {
    const { lines, errors } = parseBatchText(`alice.eth, 500\n\n${REG},0.25\nbad line\nbob.eth, 1.1234567`, 6, 350);
    expect(lines.map(l => l.amount)).toEqual([500_000_000n, 250_000n]);
    expect(errors.map(e => e.line)).toEqual([4, 5]);
  });
  it('caps rows', () => {
    const text = Array.from({ length: 351 }, () => `${REG}, 1`).join('\n');
    const { errors } = parseBatchText(text, 6, 350);
    expect(errors.some(e => /at most 350/i.test(e.message))).toBe(true);
  });
});
