import { describe, it, expect } from 'vitest';
import { generateRandomStealthMetaAddress } from '@scopelift/stealth-address-sdk';
import { createCompanyStore, deriveRows, paymentStatus, type StorageLike } from '../src/index.js';

function mem(): StorageLike {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: (k) => void m.delete(k) };
}
const USDC = '0x036CbD53842c5426634e7929541eC2318f3dCF7e' as const;
const metaA = generateRandomStealthMetaAddress().stealthMetaAddress;
const metaB = generateRandomStealthMetaAddress().stealthMetaAddress;

describe('createCompanyStore', () => {
  it('recordRun creates employees from inputs and stores one payment per row', () => {
    const st = createCompanyStore(mem());
    const rows = deriveRows([
      { input: 'alice.eth', metaAddress: metaA, amount: 500_000_000n },
      { input: `st:eth:${metaB}`, metaAddress: metaB, amount: 250_000_000n },
    ], USDC);
    const runId = st.recordRun({ rows, result: { mode: 'atomic', txHashes: ['0xaa'] }, sentAt: 1_700_000_000_000 });
    expect(runId).toMatch(/^run-/);
    const emps = st.listEmployees();
    expect(emps).toHaveLength(2);
    const alice = emps.find((e) => e.key === 'alice.eth')!;
    expect(alice.label).toBe('alice.eth');
    expect(alice.metaAddress).toBe(metaA);
    const bob = emps.find((e) => e.metaAddress === metaB)!;
    expect(bob.label).toMatch(/^st:eth:0x[0-9a-f]{6}…/);
    const pays = st.paymentsFor(alice.key);
    expect(pays).toHaveLength(1);
    expect(pays[0]).toMatchObject({
      runId, employeeKey: 'alice.eth', amount: '500000000', txHashes: ['0xaa'], status: 'paid', sentAt: 1_700_000_000_000,
    });
    expect(pays[0]!.stealthAddress).toBe(rows.find((r) => r.input === 'alice.eth')!.stealthAddress);
    expect(pays[0]!.ephemeralPublicKey).toHaveLength(2 + 66);
  });

  it('keeps per-row status from a partial run', () => {
    const st = createCompanyStore(mem());
    const rows = deriveRows([
      { input: 'a.eth', metaAddress: metaA, amount: 1n },
      { input: 'b.eth', metaAddress: metaB, amount: 2n },
    ], USDC);
    st.recordRun({
      rows,
      result: { mode: 'sequential', txHashes: ['0x1', '0x2', '0x3'], partial: { announcedRows: 2, paidRows: 1, error: 'rejected' } },
      sentAt: 1,
    });
    const all = st.allPayments();
    expect(all.map((p) => p.status)).toEqual(['paid', 'announced only']);
  });

  it('second run for the same employee appends, never reuses, and rename sticks', () => {
    const st = createCompanyStore(mem());
    const r1 = deriveRows([{ input: 'alice.eth', metaAddress: metaA, amount: 1n }], USDC);
    const r2 = deriveRows([{ input: 'Alice.ETH ', metaAddress: metaA, amount: 2n }], USDC);
    st.recordRun({ rows: r1, result: { mode: 'atomic', txHashes: ['0x1'] }, sentAt: 1 });
    st.renameEmployee('alice.eth', 'Alice Tan');
    st.recordRun({ rows: r2, result: { mode: 'atomic', txHashes: ['0x2'] }, sentAt: 2 });
    expect(st.listEmployees()).toHaveLength(1);
    expect(st.listEmployees()[0]!.label).toBe('Alice Tan');
    const pays = st.paymentsFor('alice.eth');
    expect(pays).toHaveLength(2);
    expect(pays[0]!.stealthAddress).not.toBe(pays[1]!.stealthAddress);
    expect(pays.map((p) => p.sentAt)).toEqual([2, 1]); // newest first
  });

  it('flags a changed meta-address on the employee instead of splitting them', () => {
    const st = createCompanyStore(mem());
    st.recordRun({ rows: deriveRows([{ input: 'alice.eth', metaAddress: metaA, amount: 1n }], USDC), result: { mode: 'atomic', txHashes: [] }, sentAt: 1 });
    st.recordRun({ rows: deriveRows([{ input: 'alice.eth', metaAddress: metaB, amount: 1n }], USDC), result: { mode: 'atomic', txHashes: [] }, sentAt: 2 });
    const e = st.listEmployees()[0]!;
    expect(e.metaAddress).toBe(metaB);
    expect(e.previousMetaAddresses).toEqual([metaA]);
  });

  it('clear wipes everything', () => {
    const s = mem();
    const st = createCompanyStore(s);
    st.recordRun({ rows: deriveRows([{ input: 'x.eth', metaAddress: metaA, amount: 1n }], USDC), result: { mode: 'atomic', txHashes: [] }, sentAt: 1 });
    st.clear();
    expect(st.listEmployees()).toEqual([]);
    expect(s.getItem('soapay:company')).toBeNull();
  });
});

describe('paymentStatus', () => {
  it('classifies by live balance against amount paid', () => {
    expect(paymentStatus(100n, 100n)).toBe('unspent');
    expect(paymentStatus(100n, 150n)).toBe('unspent');
    expect(paymentStatus(100n, 40n)).toBe('partly spent');
    expect(paymentStatus(100n, 0n)).toBe('withdrawn');
    expect(paymentStatus(100n, undefined)).toBe('unknown');
  });
});
