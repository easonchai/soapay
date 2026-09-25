import { describe, it, expect } from 'vitest';
import { generateRandomStealthMetaAddress, type AnnouncementLog } from '@scopelift/stealth-address-sdk';
import { deriveRows } from '../src/index.js';
import { scanRange, mergeLedger, decodeErc20Metadata } from '../src/index.js';

const USDC = '0x036CbD53842c5426634e7929541eC2318f3dCF7e' as const;
const PAYER = '0x00000000000000000000000000000000000000bb';
const CALLER = '0x00000000000000000000000000000000000000aa';

function log(row: { stealthAddress: `0x${string}`; ephemeralPublicKey: `0x${string}`; metadata: `0x${string}` }, block: bigint, tx: `0x${string}`): AnnouncementLog {
  return {
    schemeId: 1n, stealthAddress: row.stealthAddress, caller: CALLER,
    ephemeralPubKey: row.ephemeralPublicKey, metadata: row.metadata,
    blockNumber: block, transactionHash: tx, address: '0x55649E01B5Df198D18D95b5cc5051630cfD45564',
    blockHash: '0x00', data: '0x', logIndex: 0, removed: false, topics: [], transactionIndex: 0,
  } as unknown as AnnouncementLog;
}

describe('scanRange', () => {
  it('finds only my announcements, across chunks, and decodes amounts', async () => {
    const me = generateRandomStealthMetaAddress();
    const them = generateRandomStealthMetaAddress();
    const mine = deriveRows([{ input: 'a', metaAddress: me.stealthMetaAddress, amount: 5_000_000n }], USDC)[0]!;
    const theirs = deriveRows([{ input: 'b', metaAddress: them.stealthMetaAddress, amount: 1n }], USDC)[0]!;
    const logs = [log(theirs, 100n, '0x01'), log(mine, 2500n, '0x02')];
    const calls: [bigint, bigint][] = [];
    const { entries, scannedTo } = await scanRange({
      keys: { spendingPublicKey: me.spendingPublicKey, viewingPrivateKey: me.viewingPrivateKey },
      fromBlock: 0n, chunkSize: 1000n,
      deps: {
        latestBlock: async () => 3000n,
        getLogs: async (f, t) => { calls.push([f, t]); return logs.filter(l => l.blockNumber! >= f && l.blockNumber! <= t); },
      },
    });
    expect(calls).toEqual([[0n, 999n], [1000n, 1999n], [2000n, 2999n], [3000n, 3000n]]);
    expect(scannedTo).toBe(3000n);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      stealthAddress: mine.stealthAddress, txHash: '0x02', blockNumber: '2500',
      token: USDC.toLowerCase(), amount: '5000000', caller: CALLER, payer: CALLER,
    });
  });

  it('decodes 77-byte StealthDisperse metadata and reports the payer', async () => {
    const me = generateRandomStealthMetaAddress();
    const mine = deriveRows([{ input: 'a', metaAddress: me.stealthMetaAddress, amount: 2_000_000n }], USDC)[0]!;
    const withPayer = { ...mine, metadata: (mine.metadata + PAYER.slice(2)) as `0x${string}` };
    const { entries } = await scanRange({
      keys: { spendingPublicKey: me.spendingPublicKey, viewingPrivateKey: me.viewingPrivateKey },
      fromBlock: 0n, toBlock: 10n, chunkSize: 100n,
      deps: { latestBlock: async () => 10n, getLogs: async () => [log(withPayer, 5n, '0x04')] },
    });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ amount: '2000000', token: USDC.toLowerCase(), payer: PAYER, caller: CALLER });
  });

  it('keeps a matching announcement whose metadata is not ERC-20 shaped', async () => {
    const me = generateRandomStealthMetaAddress();
    const mine = deriveRows([{ input: 'a', metaAddress: me.stealthMetaAddress, amount: 1n }], USDC)[0]!;
    const weird = { ...mine, metadata: mine.viewTag as `0x${string}` };
    const { entries } = await scanRange({
      keys: { spendingPublicKey: me.spendingPublicKey, viewingPrivateKey: me.viewingPrivateKey },
      fromBlock: 0n, toBlock: 10n, chunkSize: 100n,
      deps: { latestBlock: async () => 10n, getLogs: async () => [log(weird, 5n, '0x03')] },
    });
    expect(entries).toHaveLength(1);
    expect(entries[0]!.amount).toBeUndefined();
    expect(entries[0]!.payer).toBe(CALLER);
  });
});

describe('decodeErc20Metadata', () => {
  it('returns null for short metadata', () => {
    expect(decodeErc20Metadata('0xab')).toBeNull();
  });
  it('returns payer only when 77 bytes', () => {
    const md57 = ('0x' + 'ee' + 'a9059cbb' + USDC.slice(2) + '1'.padStart(64, '0')) as `0x${string}`;
    expect(decodeErc20Metadata(md57)).toEqual({ token: USDC.toLowerCase(), amount: 1n, payer: undefined });
    expect(decodeErc20Metadata((md57 + PAYER.slice(2)) as `0x${string}`)).toEqual({ token: USDC.toLowerCase(), amount: 1n, payer: PAYER });
  });
});

describe('mergeLedger', () => {
  it('dedupes and sorts', () => {
    const a = { stealthAddress: '0x1', txHash: '0xa', blockNumber: '5' } as any;
    const b = { stealthAddress: '0x2', txHash: '0xb', blockNumber: '2' } as any;
    const out = mergeLedger([a], [a, b]);
    expect(out.map(e => e.txHash)).toEqual(['0xb', '0xa']);
  });
});

describe('sumLiveBalances', () => {
  it('sums only numeric balances and ignores metadata amounts', async () => {
    const { sumLiveBalances } = await import('../src/index.js');
    const ledger = [{ stealthAddress: '0x1', amount: '999' }, { stealthAddress: '0x2', amount: '999' }, { stealthAddress: '0x3' }] as any;
    expect(sumLiveBalances(ledger, { '0x1': '5', '0x2': 'error' })).toBe(5n);
  });
});
