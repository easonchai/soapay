import type { Hex } from 'viem';
import type { LedgerEntry } from '../scan.js';
export { createSenderStore } from './senderStore.js';

export type StorageLike = {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
  removeItem(k: string): void;
};

/** Public recipient state only. Private keys are never written here. */
export type RecipientState = {
  registrant: Hex;
  stealthMetaAddress: Hex;
  registrationBlock?: string | undefined;
  /** User override for the start of a full rescan. */
  scanFromBlock?: string | undefined;
  lastScannedBlock?: string | undefined;
  ledger: LedgerEntry[];
  ensName?: string | undefined;
  chainId: number;
};

const ALLOWED: (keyof RecipientState)[] = [
  'registrant',
  'stealthMetaAddress',
  'registrationBlock',
  'scanFromBlock',
  'lastScannedBlock',
  'ledger',
  'ensName',
  'chainId',
];

function pick(s: RecipientState): RecipientState {
  const out: Partial<RecipientState> = {};
  for (const k of ALLOWED) if (s[k] !== undefined) (out as Record<string, unknown>)[k] = s[k];
  return out as RecipientState;
}

export function createRecipientStore(storage: StorageLike, chainId: number) {
  const key = `soapay:recipient:${chainId}`;
  const get = (): RecipientState | null => {
    const raw = storage.getItem(key);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as RecipientState;
    } catch {
      return null;
    }
  };
  const set = (s: RecipientState) => storage.setItem(key, JSON.stringify(pick(s)));
  return {
    get,
    set,
    update(p: Partial<RecipientState>) {
      const cur = get();
      if (!cur) throw new Error('No recipient state to update');
      set({ ...cur, ...p });
    },
    clear() {
      storage.removeItem(key);
    },
  };
}

export function browserStorage(): StorageLike {
  if (typeof window !== 'undefined' && window.localStorage) return window.localStorage;
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: (k) => void m.delete(k) };
}
