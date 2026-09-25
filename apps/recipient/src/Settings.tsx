import { useEffect, useMemo, useState } from 'react';
import { chainConfig } from './config.js';
import { useKeys } from './KeysProvider.js';
import { createRecipientStore, browserStorage, type RecipientState, createSenderStore } from '@soapay/sdk';

export function Settings() {
  const cfg = chainConfig;
  const rstore = useMemo(() => createRecipientStore(browserStorage(), cfg.chainId), [cfg.chainId]);
  const sstore = useMemo(() => createSenderStore(browserStorage()), []);
  const { lock, keys } = useKeys();
  const [state, setState] = useState<RecipientState | null>(null);
  const [from, setFrom] = useState('');
  const [note, setNote] = useState<string>();

  useEffect(() => {
    const s = rstore.get();
    setState(s);
    setFrom(s?.scanFromBlock ?? '');
  }, [rstore]);

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
          <dt>Relayer</dt>
          <dd>
            <code>{cfg.relayUrl}</code>
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

      {state && (
        <>
          <h2>Receiving</h2>
          <div className="card">
            <dl className="facts">
              <dt>Registrant</dt>
              <dd>
                <code>{state.registrant}</code>
              </dd>
              <dt>Registered at block</dt>
              <dd>{state.registrationBlock ?? <span className="muted">Unknown. Registered in another browser?</span>}</dd>
              <dt>Scan from block</dt>
              <dd>
                <div className="actions" style={{ margin: 0 }}>
                  <input
                    value={from}
                    onChange={(e) => setFrom(e.target.value)}
                    placeholder={state.registrationBlock ?? String(cfg.scanStartBlock)}
                  />
                  <button
                    onClick={() => {
                      const v = from.trim();
                      if (v && !/^\d+$/.test(v)) {
                        setNote('Block must be a whole number.');
                        return;
                      }
                      rstore.update({ scanFromBlock: v || undefined, lastScannedBlock: undefined });
                      setState(rstore.get());
                      setNote('Saved. The next “Rescan from start” begins there.');
                    }}
                  >
                    Save
                  </button>
                </div>
                <span className="note">Overrides where a full rescan starts.</span>
              </dd>
            </dl>
          </div>
        </>
      )}

      {note && <p className="notice notice-ok">{note}</p>}

      <h2>Reset</h2>
      <p className="muted">Keys come back by signing again with the same wallet. Payments come back with a full rescan.</p>
      <div className="actions">
        <button onClick={lock} disabled={!keys}>
          Forget keys for this session
        </button>
        <button
          className="btn-danger"
          onClick={() => {
            rstore.clear();
            setState(null);
            setNote('Receiving data cleared.');
          }}
        >
          Reset receiving data
        </button>
        <button
          className="btn-danger"
          onClick={() => {
            sstore.clear();
            setNote('Sender pins and draft cleared.');
          }}
        >
          Reset sender pins and draft
        </button>
      </div>
    </div>
  );
}
