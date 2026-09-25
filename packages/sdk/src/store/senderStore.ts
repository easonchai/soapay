import type { Pin } from '../recipient.js';
import type { StorageLike } from './recipientStore.js';

/** Pinned meta-addresses per recipient input, plus the unsent draft. Never stealth addresses. */
export type SenderState = { pins: Record<string, Pin>; draft: string };
const KEY = 'soapay:sender';

export const pinKey = (input: string) => input.trim().toLowerCase();

export function createSenderStore(storage: StorageLike) {
  const get = (): SenderState => {
    const raw = storage.getItem(KEY);
    if (!raw) return { pins: {}, draft: '' };
    try {
      return { pins: {}, draft: '', ...(JSON.parse(raw) as Partial<SenderState>) };
    } catch {
      return { pins: {}, draft: '' };
    }
  };
  const save = (s: SenderState) => storage.setItem(KEY, JSON.stringify(s));
  return {
    get,
    setPin(input: string, pin: Pin) {
      const s = get();
      s.pins[pinKey(input)] = pin;
      save(s);
    },
    removePin(input: string) {
      const s = get();
      delete s.pins[pinKey(input)];
      save(s);
    },
    setDraft(draft: string) {
      save({ ...get(), draft });
    },
    clear() {
      storage.removeItem(KEY);
    },
  };
}
