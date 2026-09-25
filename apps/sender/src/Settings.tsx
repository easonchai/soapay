import { useMemo, useState } from 'react';
import { createSenderStore, browserStorage, createCompanyStore } from '@soapay/sdk';
import { chainConfig } from './config.js';

export function Settings() {
  const cfg = chainConfig;
  const sstore = useMemo(() => createSenderStore(browserStorage()), []);
  const company = useMemo(() => createCompanyStore(browserStorage()), []);
  const history = company.allPayments().length;
  const [note, setNote] = useState<string>();
  const pinCount = Object.keys(sstore.get().pins).length;

  return (
    <div>
      <h1>Settings</h1>
      <p className="lead">Where this app points, and what it keeps in this browser.</p>

      <h2>Network</h2>
      <div className="card">
        <dl className="facts">
          <dt>Chain</dt>
          <dd>
            {cfg.chain.name} ({cfg.chainId})
          </dd>
          <dt>Payroll RPC</dt>
          <dd>
            <code>{cfg.rpcUrl}</code>
          </dd>
          <dt>Mainnet RPC</dt>
          <dd>
            <code>{cfg.mainnetRpcUrl}</code>
            <span className="note">Used only to resolve ENS names.</span>
          </dd>
          <dt>Announcer</dt>
          <dd>
            <code>{cfg.announcer}</code>
          </dd>
          <dt>Registry</dt>
          <dd>
            <code>{cfg.registry}</code>
          </dd>
          <dt>USDC</dt>
          <dd>
            <code>{cfg.usdc}</code>
          </dd>
          <dt>StealthDisperse</dt>
          <dd>
            {cfg.stealthDisperse ? (
              <code>{cfg.stealthDisperse}</code>
            ) : (
              <span className="muted">Not configured. Wallets without batching fall back to one transaction per step.</span>
            )}
          </dd>
        </dl>
      </div>

      <h2>Stored here</h2>
      <p className="muted">
        {pinCount} pinned {pinCount === 1 ? 'recipient' : 'recipients'}, the unsent draft, and {history} payment{' '}
        {history === 1 ? 'record' : 'records'} (which stealth wallet each employee was paid into). Records are never reused as
        payment targets.
      </p>
      {note && <p className="notice notice-ok">{note}</p>}
      <div className="actions">
        <button
          className="btn-danger"
          onClick={() => {
            sstore.clear();
            setNote('Pins and draft cleared. The next Resolve pins recipients again.');
          }}
        >
          Reset pins and draft
        </button>
        <button
          className="btn-danger"
          onClick={() => {
            company.clear();
            setNote('Employee history cleared. Past payments are still on-chain; the app just no longer lists them.');
          }}
        >
          Reset employee history
        </button>
      </div>
    </div>
  );
}
