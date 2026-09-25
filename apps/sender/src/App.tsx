import { useState } from 'react';
import { Shell } from '@soapay/ui';
import type { PlannedRow, BatchResult } from '@soapay/sdk';
import { chainConfig, OTHER_APP_URL } from './config.js';
import { Editor } from './Editor.js';
import { Review } from './Review.js';
import { Result } from './Result.js';
import { Employees } from './Employees.js';
import { Settings } from './Settings.js';

type Stage =
  | { name: 'editor' }
  | { name: 'review'; rows: PlannedRow[] }
  | { name: 'result'; rows: PlannedRow[]; result: BatchResult };
type View = 'pay' | 'employees' | 'settings';

export function App() {
  const [view, setView] = useState<View>('pay');
  const [stage, setStage] = useState<Stage>({ name: 'editor' });
  const [prefill, setPrefill] = useState<string>();

  function payFromEmployees(input: string) {
    setPrefill(input);
    setStage({ name: 'editor' });
    setView('pay');
  }

  let body;
  if (view === 'settings') body = <Settings />;
  else if (view === 'employees') body = <Employees onPay={payFromEmployees} />;
  else if (stage.name === 'editor') {
    body = <Editor prefill={prefill} onPrefillUsed={() => setPrefill(undefined)} onContinue={(rows) => setStage({ name: 'review', rows })} />;
  } else if (stage.name === 'review') {
    const rows = stage.rows;
    body = (
      <Review rows={rows} onBack={() => setStage({ name: 'editor' })} onSent={(result) => setStage({ name: 'result', rows, result })} />
    );
  } else {
    body = (
      <Result
        rows={stage.rows}
        result={stage.result}
        onNew={() => setStage({ name: 'editor' })}
        onEmployees={() => {
          setStage({ name: 'editor' });
          setView('employees');
        }}
      />
    );
  }

  return (
    <Shell
      chainName={chainConfig.chain.name}
      tabs={[
        { label: 'Pay', active: view === 'pay', onSelect: () => setView('pay') },
        { label: 'Employees', active: view === 'employees', onSelect: () => setView('employees') },
        { label: 'Settings', active: view === 'settings', onSelect: () => setView('settings') },
        { label: 'Employee app', href: OTHER_APP_URL },
      ]}
    >
      {body}
    </Shell>
  );
}
