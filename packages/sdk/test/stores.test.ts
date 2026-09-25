import { describe, it, expect } from 'vitest';
import { createRecipientStore, createSenderStore, type StorageLike } from '../src/index.js';

function mem(): StorageLike {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: (k) => void m.delete(k) };
}

describe('recipientStore', () => {
  it('round-trips and is namespaced by chain', () => {
    const s = mem();
    const a = createRecipientStore(s, 84532);
    const b = createRecipientStore(s, 8453);
    expect(a.get()).toBeNull();
    a.set({ registrant: '0x1', stealthMetaAddress: '0x2', ledger: [], chainId: 84532 });
    a.update({ registrationBlock: '10' });
    expect(a.get()?.registrationBlock).toBe('10');
    expect(b.get()).toBeNull();
    a.clear();
    expect(a.get()).toBeNull();
  });
  it('never stores private keys even if passed', () => {
    const s = mem();
    const a = createRecipientStore(s, 84532);
    a.set({ registrant: '0x1', stealthMetaAddress: '0x2', ledger: [], chainId: 84532, spendingPrivateKey: '0xdead' } as never);
    expect(s.getItem('soapay:recipient:84532')).not.toContain('dead');
  });
});

describe('senderStore', () => {
  it('manages pins and draft', () => {
    const st = createSenderStore(mem());
    st.setPin('Alice.eth ', { metaAddress: '0xabc', pinnedAt: 1 });
    st.setDraft('alice.eth, 5');
    expect(st.get().pins['alice.eth']?.metaAddress).toBe('0xabc');
    expect(st.get().draft).toBe('alice.eth, 5');
    st.removePin('alice.eth');
    expect(st.get().pins['alice.eth']).toBeUndefined();
  });
});
