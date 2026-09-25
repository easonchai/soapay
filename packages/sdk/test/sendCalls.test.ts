import { describe, it, expect } from 'vitest';
import { generateRandomStealthMetaAddress } from '@scopelift/stealth-address-sdk';
import { deriveRows } from '../src/index.js';
import { buildBatchCalls } from '../src/index.js';
import { createWalletBatchSender, permitV, BatchPartialError } from '../src/index.js';

const cfg = {
  usdc: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
  announcer: '0x55649E01B5Df198D18D95b5cc5051630cfD45564',
} as const;
const ACCT = { address: '0x00000000000000000000000000000000000000ee', type: 'json-rpc' } as const;

function rows(n: number) {
  return deriveRows(
    Array.from({ length: n }, (_, i) => ({ input: `r${i}`, metaAddress: generateRandomStealthMetaAddress().stealthMetaAddress, amount: BigInt(i + 1) })),
    cfg.usdc,
  );
}

function fakes(opts: { caps?: unknown; failAt?: number }) {
  const sent: `0x${string}`[] = [];
  let n = 0;
  const walletClient = {
    account: ACCT,
    chain: { id: 84532 },
    getCapabilities: async () => {
      if (opts.caps === 'throw') throw new Error('unsupported method');
      return opts.caps ?? {};
    },
    sendTransaction: async ({ to }: { to: `0x${string}` }) => {
      n += 1;
      if (opts.failAt === n) throw new Error('User rejected the request.');
      sent.push(to);
      return `0x${n.toString(16).padStart(64, '0')}` as `0x${string}`;
    },
  };
  const publicClient = { waitForTransactionReceipt: async () => ({}) };
  return { walletClient, publicClient, sent };
}

describe('detect', () => {
  it('reads final-spec atomic.status and legacy atomicBatch.supported', async () => {
    const r = rows(1);
    for (const caps of [{ atomic: { status: 'supported' } }, { atomic: { status: 'ready' } }, { atomicBatch: { supported: true } }]) {
      const f = fakes({ caps });
      const s = createWalletBatchSender({ walletClient: f.walletClient as never, publicClient: f.publicClient as never, chainId: 84532, token: cfg.usdc, rows: r });
      expect(await s.detect()).toBe('atomic');
    }
  });
  it('falls to permit when configured, else sequential, when capabilities are missing or throw', async () => {
    const r = rows(1);
    const a = fakes({ caps: 'throw' });
    expect(await createWalletBatchSender({ walletClient: a.walletClient as never, publicClient: a.publicClient as never, chainId: 84532, token: cfg.usdc, rows: r, stealthDisperse: '0x0000000000000000000000000000000000000002' }).detect()).toBe('permit');
    const b = fakes({ caps: {} });
    expect(await createWalletBatchSender({ walletClient: b.walletClient as never, publicClient: b.publicClient as never, chainId: 84532, token: cfg.usdc, rows: r }).detect()).toBe('sequential');
  });
});

describe('sequential mode', () => {
  it('announces every row before paying any', async () => {
    const r = rows(3);
    const f = fakes({});
    const s = createWalletBatchSender({ walletClient: f.walletClient as never, publicClient: f.publicClient as never, chainId: 84532, token: cfg.usdc, rows: r });
    const res = await s.send(buildBatchCalls(r, cfg), () => {});
    expect(res.mode).toBe('sequential');
    expect(res.txHashes).toHaveLength(6);
    expect(f.sent.slice(0, 3).every((t) => t === cfg.announcer)).toBe(true);
    expect(f.sent.slice(3).every((t) => t === cfg.usdc)).toBe(true);
  });

  it('on a mid-run failure throws BatchPartialError carrying what already confirmed', async () => {
    const r = rows(3);
    const f = fakes({ failAt: 5 }); // 3 announces ok, 1 pay ok, 2nd pay rejected
    const s = createWalletBatchSender({ walletClient: f.walletClient as never, publicClient: f.publicClient as never, chainId: 84532, token: cfg.usdc, rows: r });
    let caught: unknown;
    try {
      await s.send(buildBatchCalls(r, cfg), () => {});
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(BatchPartialError);
    const p = caught as BatchPartialError;
    expect(p.mode).toBe('sequential');
    expect(p.txHashes).toHaveLength(4);
    expect(p.announcedRows).toBe(3);
    expect(p.paidRows).toBe(1);
    expect(p.message).toMatch(/User rejected/);
  });
});

describe('permitV', () => {
  const body = 'ab'.repeat(64);
  it('maps recovery byte 27/28 and yParity 0/1 to 27/28', () => {
    expect(permitV(`0x${body}1b`)).toBe(27);
    expect(permitV(`0x${body}1c`)).toBe(28);
    expect(permitV(`0x${body}00`)).toBe(27);
    expect(permitV(`0x${body}01`)).toBe(28);
  });
});
