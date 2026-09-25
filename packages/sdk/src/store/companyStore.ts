import type { Hex } from 'viem';
import type { PlannedRow } from '../derive.js';
import type { BatchResult } from '../batch/types.js';
import type { StorageLike } from './recipientStore.js';
import { pinKey } from './senderStore.js';

/**
 * Company-side history. The employer is trusted under the team threat model and may know
 * name -> stealth wallet -> amount, so we keep what the company itself created. A stored
 * stealth address is a record, never a payment target: pay runs always derive fresh.
 */
export type Employee = {
  /** pinKey(input): lowercased, trimmed recipient string as first pasted. */
  key: string;
  /** Display name. Defaults to the input, or a shortened meta-address. Editable. */
  label: string;
  input: string;
  metaAddress: Hex;
  previousMetaAddresses: Hex[];
  firstPaidAt: number;
  lastPaidAt: number;
};

export type PaymentStatus = 'paid' | 'announced only' | 'not sent' | 'unknown';

export type PaymentRecord = {
  id: string;
  runId: string;
  employeeKey: string;
  stealthAddress: Hex;
  ephemeralPublicKey: Hex;
  viewTag: Hex;
  amount: string;
  txHashes: Hex[];
  sentAt: number;
  mode: BatchResult['mode'];
  status: PaymentStatus;
};

export type CompanyState = { employees: Record<string, Employee>; payments: PaymentRecord[] };
const KEY = 'soapay:company';
const empty = (): CompanyState => ({ employees: {}, payments: [] });

function defaultLabel(input: string): string {
  const t = input.trim();
  if (/^st:eth:0x/i.test(t)) return `${t.slice(0, 15).toLowerCase()}…${t.slice(-4)}`;
  if (/^0x[0-9a-fA-F]{40}$/.test(t)) return `${t.slice(0, 8)}…${t.slice(-4)}`;
  return t;
}

/** Same rule the Result screen uses, so history and the screen agree. */
export function rowStatus(result: BatchResult, index: number): PaymentStatus {
  const p = result.partial;
  if (!p) return 'paid';
  if (result.mode !== 'sequential') return p.pendingId || p.paidRows ? 'unknown' : 'not sent';
  if (index < p.paidRows) return 'paid';
  if (index < p.announcedRows) return 'announced only';
  return 'not sent';
}

/** What the live USDC balance says about a paid wallet. */
export type SpendStatus = 'unspent' | 'partly spent' | 'withdrawn' | 'unknown';
export function paymentStatus(amountPaid: bigint, liveBalance: bigint | undefined): SpendStatus {
  if (liveBalance === undefined) return 'unknown';
  if (liveBalance === 0n) return 'withdrawn';
  if (liveBalance < amountPaid) return 'partly spent';
  return 'unspent';
}

export function createCompanyStore(storage: StorageLike) {
  const get = (): CompanyState => {
    const raw = storage.getItem(KEY);
    if (!raw) return empty();
    try {
      const parsed = JSON.parse(raw) as Partial<CompanyState>;
      return { employees: parsed.employees ?? {}, payments: parsed.payments ?? [] };
    } catch {
      return empty();
    }
  };
  const save = (s: CompanyState) => storage.setItem(KEY, JSON.stringify(s));

  return {
    get,
    recordRun({ rows, result, sentAt }: { rows: PlannedRow[]; result: BatchResult; sentAt: number }): string {
      const s = get();
      const runId = `run-${sentAt}-${Math.random().toString(36).slice(2, 8)}`;
      rows.forEach((r, i) => {
        const key = pinKey(r.input);
        const meta = r.metaAddress.toLowerCase() as Hex;
        const existing = s.employees[key];
        if (!existing) {
          s.employees[key] = {
            key,
            label: defaultLabel(r.input),
            input: r.input.trim(),
            metaAddress: meta,
            previousMetaAddresses: [],
            firstPaidAt: sentAt,
            lastPaidAt: sentAt,
          };
        } else {
          if (existing.metaAddress !== meta) {
            existing.previousMetaAddresses = [...existing.previousMetaAddresses, existing.metaAddress];
            existing.metaAddress = meta;
          }
          existing.lastPaidAt = Math.max(existing.lastPaidAt, sentAt);
        }
        s.payments.push({
          id: `${runId}-${i}`,
          runId,
          employeeKey: key,
          stealthAddress: r.stealthAddress,
          ephemeralPublicKey: r.ephemeralPublicKey,
          viewTag: r.viewTag,
          amount: String(r.amount),
          txHashes: result.txHashes,
          sentAt,
          mode: result.mode,
          status: rowStatus(result, i),
        });
      });
      save(s);
      return runId;
    },
    listEmployees(): Employee[] {
      return Object.values(get().employees).sort((a, b) => b.lastPaidAt - a.lastPaidAt);
    },
    getEmployee(key: string): Employee | undefined {
      return get().employees[pinKey(key)];
    },
    renameEmployee(key: string, label: string) {
      const s = get();
      const e = s.employees[pinKey(key)];
      if (!e) return;
      e.label = label.trim() || e.label;
      save(s);
    },
    paymentsFor(key: string): PaymentRecord[] {
      const k = pinKey(key);
      return get()
        .payments.filter((p) => p.employeeKey === k)
        .sort((a, b) => b.sentAt - a.sentAt);
    },
    allPayments(): PaymentRecord[] {
      return get().payments.slice();
    },
    clear() {
      storage.removeItem(KEY);
    },
  };
}
