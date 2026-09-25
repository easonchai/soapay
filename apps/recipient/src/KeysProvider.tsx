import { createContext, useCallback, useContext, useState } from 'react';
import { useSignMessage } from 'wagmi';
import { deriveKeysFromSignature, SIGN_MESSAGE, type StealthKeys } from '@soapay/sdk';

type Ctx = {
  keys: StealthKeys | null;
  unlock(): Promise<StealthKeys>;
  lock(): void;
  busy: boolean;
  error?: string | undefined;
};
const KeysCtx = createContext<Ctx | null>(null);

/** Session-only. Keys live in React state, never in storage. */
export function KeysProvider({ children }: { children: React.ReactNode }) {
  const [keys, setKeys] = useState<StealthKeys | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const { signMessageAsync } = useSignMessage();

  const unlock = useCallback(async () => {
    setBusy(true);
    setError(undefined);
    try {
      const sig = await signMessageAsync({ message: SIGN_MESSAGE });
      const k = deriveKeysFromSignature(sig);
      setKeys(k);
      return k;
    } catch (e) {
      setError((e as Error).message.split('\n')[0]);
      throw e;
    } finally {
      setBusy(false);
    }
  }, [signMessageAsync]);

  const lock = useCallback(() => setKeys(null), []);
  return <KeysCtx.Provider value={{ keys, unlock, lock, busy, error }}>{children}</KeysCtx.Provider>;
}

export function useKeys() {
  const c = useContext(KeysCtx);
  if (!c) throw new Error('useKeys outside KeysProvider');
  return c;
}
