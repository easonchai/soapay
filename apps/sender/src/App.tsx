import { useState } from 'react';
import { useAccount, useDisconnect } from 'wagmi';
import { Shell } from '@soapay/ui';
import { short, type PlannedRow, type BatchResult } from '@soapay/sdk';
import { chainConfig } from './config.js';
import { Landing } from './Landing.js';
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
  const { address, isConnected, isReconnecting } = useAccount();
  const { disconnect } = useDisconnect();
  // Explicit session flag: Log out shows the hero at once even if the wallet takes its time
  // to drop the connection; Login clears it (and connects if the wallet is not connected).
  const [loggedOut, setLoggedOut] = useState<boolean>(() => {
    try {
      return sessionStorage.getItem('soapay:loggedOut') === '1';
    } catch {
      return false;
    }
  });
  const [view, setView] = useState<View>('pay');
  const [stage, setStage] = useState<Stage>({ name: 'editor' });
  const [prefill, setPrefill] = useState<string>();

  // Hero until the wallet is connected. wagmi restores the last connection on reload.
  if (!isConnected || loggedOut) {
    if (isReconnecting && !loggedOut) return <div className="l-hero" aria-busy />;
    return (
      <Landing
        connected={isConnected}
        onLogin={() => {
          try {
            sessionStorage.removeItem('soapay:loggedOut');
          } catch {
            /* ignore */
          }
          setLoggedOut(false);
        }}
      />
    );
  }

  function logout() {
    try {
      sessionStorage.setItem('soapay:loggedOut', '1');
    } catch {
      /* ignore */
    }
    setLoggedOut(true);
    setView('pay');
    setStage({ name: 'editor' });
    disconnect();
  }

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
      ]}
      right={
        <>
          {address && <code className="muted">{short(address)}</code>}
          <button className="btn-text" onClick={logout}>
            Log out
          </button>
        </>
      }
    >
      {body}
    </Shell>
  );
}
