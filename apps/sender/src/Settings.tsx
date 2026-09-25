import { useMemo, useState } from 'react';
import { createCompanyStore, createSenderStore, browserStorage } from '@soapay/sdk';
import { PageHead, toast } from '@soapay/ui';
import { chainConfig, setOrgName } from './config.js';

export function Settings({ org, onOrgChange }: { org: string; onOrgChange: (v: string) => void }) {
  const cfg = chainConfig;
  const sstore = useMemo(() => createSenderStore(browserStorage()), []);
  const company = useMemo(() => createCompanyStore(browserStorage()), []);
  const [name, setName] = useState(org);
  const pinCount = Object.keys(sstore.get().pins).length;
  const history = company.allPayments().length;

  return (
    <div className="stack-lg" style={{ maxWidth: 760 }}>
      <PageHead eyebrow="Settings" title="Where this app points, and what it keeps" line="Network facts come from the build. Everything below the line lives only in this browser." />

      <h2>Company</h2>
      <div className="panel panel-pad">
        <label className="field" style={{ maxWidth: 360 }}>
          <span>Company name, shown in the top bar</span>
          <div className="actions">
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Meridian Labs" />
            <button
              className="btn-primary"
              onClick={() => {
                setOrgName(name);
                onOrgChange(name.trim());
                toast.success('Company name saved');
              }}
            >
              Save
            </button>
          </div>
        </label>
      </div>

      <h2>Network</h2>
      <div className="panel panel-pad">
        <dl className="facts">
          <dt>Chain</dt>
          <dd>
            {cfg.chain.name} ({cfg.chainId})
          </dd>
          <dt>Payroll RPC</dt>
          <dd className="mono">{cfg.rpcUrl}</dd>
          <dt>Mainnet RPC</dt>
          <dd>
            <span className="mono">{cfg.mainnetRpcUrl}</span>
            <span className="note">Used only to resolve ENS names.</span>
          </dd>
          <dt>Announcer</dt>
          <dd className="mono">{cfg.announcer}</dd>
          <dt>Registry</dt>
          <dd className="mono">{cfg.registry}</dd>
          <dt>USDC</dt>
          <dd className="mono">{cfg.usdc}</dd>
          <dt>StealthDisperse</dt>
          <dd>{cfg.stealthDisperse ? <span className="mono">{cfg.stealthDisperse}</span> : <span className="ink2">Not configured. Wallets without batching fall back to one transaction per step.</span>}</dd>
        </dl>
      </div>

      <h2>Stored in this browser</h2>
      <p className="ink2 pretty">
        {pinCount} pinned {pinCount === 1 ? 'recipient' : 'recipients'}, the unsent draft, and {history} payment {history === 1 ? 'record' : 'records'} (which fresh address each
        recipient was paid into). Records are never reused as payment targets.
      </p>
      <div className="actions">
        <button
          className="btn-danger"
          onClick={() => {
            sstore.clear();
            toast('Pins and draft cleared', { description: 'The next Resolve pins recipients again.' });
          }}
        >
          Reset pins and draft
        </button>
        <button
          className="btn-danger"
          onClick={() => {
            company.clear();
            toast('History cleared', { description: 'Past payments are still on-chain; the app just no longer lists them.' });
          }}
        >
          Reset history
        </button>
      </div>
    </div>
  );
}
