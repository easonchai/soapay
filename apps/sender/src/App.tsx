import { useState } from 'react';
import { Shell } from '@soapay/ui';
import type { PlannedRow, BatchResult } from '@soapay/sdk';
import { chainConfig, OTHER_APP_URL } from './config.js';
import { Editor } from './Editor.js';
import { Review } from './Review.js';
import { Result } from './Result.js';
import { Settings } from './Settings.js';

type Stage =
  | { name: 'editor' }
  | { name: 'review'; rows: PlannedRow[] }
  | { name: 'result'; rows: PlannedRow[]; result: BatchResult };
type View = 'pay' | 'settings';

export function App() {
  const [view, setView] = useState<View>('pay');
  const [stage, setStage] = useState<Stage>({ name: 'editor' });

  let body;
  if (view === 'settings') body = <Settings />;
  else if (stage.name === 'editor') body = <Editor onContinue={(rows) => setStage({ name: 'review', rows })} />;
  else if (stage.name === 'review') {
    const rows = stage.rows;
    body = (
      <Review rows={rows} onBack={() => setStage({ name: 'editor' })} onSent={(result) => setStage({ name: 'result', rows, result })} />
    );
  } else body = <Result rows={stage.rows} result={stage.result} onNew={() => setStage({ name: 'editor' })} />;

  return (
    <Shell
      chainName={chainConfig.chain.name}
      tabs={[
        { label: 'Receive', href: OTHER_APP_URL },
        { label: 'Pay', active: view === 'pay', onSelect: () => setView('pay') },
        { label: 'Settings', active: view === 'settings', onSelect: () => setView('settings') },
      ]}
    >
      {body}
    </Shell>
  );
}
