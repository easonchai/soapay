import { useEffect, useMemo, useState } from 'react';
import { Shell } from '@soapay/ui';
import { createRecipientStore, browserStorage, type RecipientState } from '@soapay/sdk';
import { chainConfig, OTHER_APP_URL } from './config.js';
import { Wizard } from './Wizard.js';
import { Dashboard } from './Dashboard.js';
import { Settings } from './Settings.js';

type View = 'receive' | 'settings';

export function App() {
  const [view, setView] = useState<View>('receive');
  const store = useMemo(() => createRecipientStore(browserStorage(), chainConfig.chainId), []);
  const [state, setState] = useState<RecipientState | null | undefined>(undefined);
  useEffect(() => {
    setState(store.get());
  }, [store]);

  return (
    <Shell
      chainName={chainConfig.chain.name}
      tabs={[
        { label: 'Receive', active: view === 'receive', onSelect: () => setView('receive') },
        { label: 'Pay', href: OTHER_APP_URL },
        { label: 'Settings', active: view === 'settings', onSelect: () => setView('settings') },
      ]}
    >
      {view === 'settings' ? (
        <Settings />
      ) : state === undefined ? (
        <p className="muted">Loading…</p>
      ) : !state ? (
        <Wizard onDone={() => setState(store.get())} />
      ) : (
        <Dashboard onReset={() => setState(null)} />
      )}
    </Shell>
  );
}
