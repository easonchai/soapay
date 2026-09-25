import { describe, it, expect } from 'vitest';
import { generateRandomStealthMetaAddress } from '@scopelift/stealth-address-sdk';
import { createCompanyStore, deriveRows, fmtAmount, fmtDate, type StorageLike } from '../src/index.js';

function mem(): StorageLike {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: (k) => void m.delete(k) };
}
const USDC = '0x036CbD53842c5426634e7929541eC2318f3dCF7e' as const;
const meta = () => generateRandomStealthMetaAddress().stealthMetaAddress;

describe('runs', () => {
  it('recordRun stores a run summary and lines are grouped under it', () => {
    const st = createCompanyStore(mem());
    const rows = deriveRows(
      [
        { input: 'alice.eth', metaAddress: meta(), amount: 4_200_000_000n },
        { input: 'bram.eth', metaAddress: meta(), amount: 3_850_000_000n },
      ],
      USDC,
      { chunk: 500_000_000n },
    );
    const id = st.recordRun({ rows, result: { mode: 'atomic', txHashes: ['0xaa'] }, sentAt: 1_758_700_000_000, label: 'September salaries' });
    const runs = st.listRuns();
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ id, label: 'September salaries', mode: 'atomic', recipients: 2, lines: 17, total: '8050000000', txHashes: ['0xaa'] });
    expect(st.paymentsForRun(id)).toHaveLength(17);
    expect(st.paymentsForRun(id).filter((p) => p.employeeKey === 'alice.eth')).toHaveLength(9);
  });
  it('lists runs newest first and rebuilds runs for legacy state without them', () => {
    const s = mem();
    const st = createCompanyStore(s);
    st.recordRun({ rows: deriveRows([{ input: 'a.eth', metaAddress: meta(), amount: 1n }], USDC), result: { mode: 'atomic', txHashes: [] }, sentAt: 1 });
    st.recordRun({ rows: deriveRows([{ input: 'b.eth', metaAddress: meta(), amount: 2n }], USDC), result: { mode: 'atomic', txHashes: [] }, sentAt: 2 });
    expect(st.listRuns().map((r) => r.sentAt)).toEqual([2, 1]);
    // strip runs to simulate an older store
    const raw = JSON.parse(s.getItem('soapay:company')!);
    delete raw.runs;
    s.setItem('soapay:company', JSON.stringify(raw));
    const st2 = createCompanyStore(s);
    expect(st2.listRuns()).toHaveLength(2);
    expect(st2.listRuns()[0]!.label).toBe('Pay run');
  });
});

describe('format helpers', () => {
  it('fmtAmount shows two decimals with thousands separators', () => {
    expect(fmtAmount(4_200_000_000n, 6)).toBe('4,200.00');
    expect(fmtAmount('168400000000', 6)).toBe('168,400.00');
    expect(fmtAmount(1_234_567n, 6)).toBe('1.23');
    expect(fmtAmount(0n, 6)).toBe('0.00');
  });
  it('fmtDate renders day, short month, year', () => {
    expect(fmtDate(Date.UTC(2026, 8, 24, 10, 41))).toMatch(/^24 Sep 2026$/);
  });
});
