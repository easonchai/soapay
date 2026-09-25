import { useState } from 'react';
import { motion } from 'framer-motion';
import { useAccount, useDisconnect } from 'wagmi';
import { TopBar, Presence } from '@soapay/ui';
import { short, type PlannedRow, type BatchResult } from '@soapay/sdk';
import { chainConfig, getOrgName } from './config.js';
import { Landing } from './Landing.js';
import { PayRun, type RunMeta } from './PayRun.js';
import { Review } from './Review.js';
import { History } from './History.js';
import { Recipients } from './Recipients.js';
import { Settings } from './Settings.js';

type View = 'pay' | 'review' | 'history' | 'recipients' | 'settings';

export function App() {
  const { address, isConnected, isReconnecting } = useAccount();
  const { disconnect } = useDisconnect();
  const [loggedOut, setLoggedOut] = useState<boolean>(() => {
    try {
      return sessionStorage.getItem('soapay:loggedOut') === '1';
    } catch {
      return false;
    }
  });
  const [view, setView] = useState<View>('pay');
  const [review, setReview] = useState<{ rows: PlannedRow[]; meta: RunMeta } | null>(null);
  const [openRun, setOpenRun] = useState<string>();
  const [prefill, setPrefill] = useState<string>();
  const [org, setOrg] = useState(getOrgName());

  if (!isConnected || loggedOut) {
    if (isReconnecting && !loggedOut) return <div className="land" aria-busy />;
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
    setReview(null);
    disconnect();
  }

  function startRun(prefillText?: string) {
    setPrefill(prefillText);
    setReview(null);
    setView('pay');
  }

  let body;
  if (view === 'settings') body = <Settings org={org} onOrgChange={setOrg} />;
  else if (view === 'history') body = <History openRunId={openRun} onStartRun={() => startRun()} />;
  else if (view === 'recipients') body = <Recipients onPay={startRun} />;
  else if (view === 'review' && review) {
    body = (
      <Review
        rows={review.rows}
        meta={review.meta}
        onBack={() => setView('pay')}
        onSent={(result: BatchResult, runId: string) => {
          setReview(null);
          setOpenRun(runId);
          setView('history');
        }}
      />
    );
  } else {
    body = (
      <PayRun
        prefill={prefill}
        onPrefillUsed={() => setPrefill(undefined)}
        onReview={(rows, meta) => {
          setReview({ rows, meta });
          setView('review');
        }}
      />
    );
  }

  const tab = (label: string, v: View, active: boolean) => ({ label, active, onSelect: () => setView(v) });
  return (
    <div className="page">
      <TopBar
        org={org || undefined}
        tabs={[
          tab('Pay run', 'pay', view === 'pay' || view === 'review'),
          tab('History', 'history', view === 'history'),
          tab('Recipients', 'recipients', view === 'recipients'),
          tab('Settings', 'settings', view === 'settings'),
        ]}
        right={
          <>
            <span className="chip">
              {address ? short(address, 4) : ''} · {chainConfig.chain.name}
            </span>
            <button className="btn-text" onClick={logout}>
              Log out
            </button>
          </>
        }
      />
      <main className="app-main">
        <Presence mode="wait" initial={false}>
          <motion.div
            key={view === 'review' ? 'review' : view}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
          >
            {body}
          </motion.div>
        </Presence>
      </main>
    </div>
  );
}
