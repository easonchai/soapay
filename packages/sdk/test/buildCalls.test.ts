import { describe, it, expect } from 'vitest';
import { decodeFunctionData, erc20Abi } from 'viem';
import { ERC5564AnnouncerAbi, generateRandomStealthMetaAddress } from '@scopelift/stealth-address-sdk';
import { deriveRows } from '../src/index.js';
import { buildBatchCalls, buildDispersePayments, STEALTH_DISPERSE_ABI } from '../src/index.js';

const cfg = {
  usdc: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
  announcer: '0x55649E01B5Df198D18D95b5cc5051630cfD45564',
} as const;

function rows() {
  return deriveRows([
    { input: 'a', metaAddress: generateRandomStealthMetaAddress().stealthMetaAddress, amount: 7n },
    { input: 'b', metaAddress: generateRandomStealthMetaAddress().stealthMetaAddress, amount: 9n },
  ], cfg.usdc);
}

describe('buildBatchCalls', () => {
  it('emits N transfers then N announces, matching rows', () => {
    const r = rows();
    const calls = buildBatchCalls(r, cfg);
    expect(calls).toHaveLength(4);
    const t0 = decodeFunctionData({ abi: erc20Abi, data: calls[0]!.data });
    expect(calls[0]!.to).toBe(cfg.usdc);
    expect(t0.functionName).toBe('transfer');
    expect(t0.args).toEqual([r[0]!.stealthAddress, r[0]!.amount]);
    const a1 = decodeFunctionData({ abi: ERC5564AnnouncerAbi, data: calls[3]!.data });
    expect(calls[3]!.to).toBe(cfg.announcer);
    expect(a1.functionName).toBe('announce');
    expect(a1.args).toEqual([1n, r[1]!.stealthAddress, r[1]!.ephemeralPublicKey, r[1]!.metadata]);
  });
});

describe('buildDispersePayments', () => {
  it('maps rows to StealthDisperse.Payment tuples in order', () => {
    const r = rows();
    const p = buildDispersePayments(r);
    expect(p).toEqual([
      { stealthAddress: r[0]!.stealthAddress, amount: r[0]!.amount, ephemeralPubKey: r[0]!.ephemeralPublicKey, viewTag: r[0]!.viewTag },
      { stealthAddress: r[1]!.stealthAddress, amount: r[1]!.amount, ephemeralPubKey: r[1]!.ephemeralPublicKey, viewTag: r[1]!.viewTag },
    ]);
    // ABI has both entry points the contract exposes
    const names = STEALTH_DISPERSE_ABI.filter((x) => x.type === 'function').map((x) => (x as { name: string }).name);
    expect(names).toEqual(expect.arrayContaining(['pay', 'payWithPermit']));
  });
});
