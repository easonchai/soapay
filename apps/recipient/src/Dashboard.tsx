import { useCallback, useEffect, useMemo, useState } from 'react';
import { usePublicClient } from 'wagmi';
import { erc20Abi, type Hex } from 'viem';
import { chainConfig } from './config.js';
import { useKeys } from './KeysProvider.js';
import { Copy } from '@soapay/ui';
import { ErrorLine } from '@soapay/ui';
import { Pill } from '@soapay/ui';
import { scanRange, makeGetLogs, mergeLedger, sumLiveBalances, spendingKeyFor, type LedgerEntry, createRecipientStore, browserStorage, type RecipientState, explorerTx, fmtUnits, short } from '@soapay/sdk';

const firstLine = (e: unknown) => (e as Error).message.split('\n')[0];

export function Dashboard({ onReset }: { onReset: () => void }) {
  const cfg = chainConfig;
  const publicClient = usePublicClient();
  const { keys, unlock, busy, error: keyError } = useKeys();
  const store = useMemo(() => createRecipientStore(browserStorage(), cfg.chainId), [cfg.chainId]);
  const [state, setState] = useState<RecipientState | null>(() => store.get());
  const [scanning, setScanning] = useState<string>();
  const [err, setErr] = useState<string>();
  const [balances, setBalances] = useState<Record<string, string>>({});
  const [open, setOpen] = useState<string>();
  const [revealed, setRevealed] = useState<Record<string, Hex>>({});

  const keyMismatch = !!keys && !!state && keys.registrant.toLowerCase() !== state.registrant.toLowerCase();

  const refreshBalances = useCallback(
    async (ledger: LedgerEntry[]) => {
      if (!publicClient) return;
      const out: Record<string, string> = {};
      await Promise.all(
        ledger.map(async (e) => {
          try {
            const b = await publicClient.readContract({
              address: cfg.usdc,
              abi: erc20Abi,
              functionName: 'balanceOf',
              args: [e.stealthAddress],
            });
            out[e.stealthAddress] = String(b);
          } catch {
            out[e.stealthAddress] = 'error';
          }
        }),
      );
      setBalances(out);
    },
    [publicClient, cfg.usdc],
  );

  const ledgerLen = state?.ledger.length ?? 0;
  useEffect(() => {
    if (state && ledgerLen) void refreshBalances(state.ledger);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ledgerLen, refreshBalances]);

  async function rescan(full: boolean) {
    if (!keys || !state || !publicClient) return;
    setErr(undefined);
    try {
      const base = state.scanFromBlock ?? state.registrationBlock ?? String(cfg.scanStartBlock);
      const start = BigInt(full ? base : (state.lastScannedBlock ?? base));
      const { entries, scannedTo } = await scanRange({
        keys,
        fromBlock: start,
        chunkSize: cfg.scanChunkSize,
        deps: {
          getLogs: makeGetLogs(publicClient, cfg.announcer),
          latestBlock: () => publicClient.getBlockNumber(),
        },
        onProgress: (to, total) => setScanning(`Scanning block ${to} of ${total}`),
      });
      const ledger = mergeLedger(full ? [] : state.ledger, entries);
      store.update({ ledger, lastScannedBlock: String(scannedTo) });
      const next = store.get();
      setState(next);
      if (next) void refreshBalances(next.ledger);
    } catch (e) {
      setErr(firstLine(e));
    } finally {
      setScanning(undefined);
    }
  }

  function reveal(e: LedgerEntry) {
    if (!keys) return;
    const k = spendingKeyFor(e, keys);
    setRevealed((r) => ({ ...r, [e.stealthAddress]: k }));
  }

  if (!state) return null;
  const total = sumLiveBalances(state.ledger, balances);
  const balancesPending = state.ledger.some((e) => balances[e.stealthAddress] === undefined);
  const metaURI = `st:eth:${state.stealthMetaAddress}`;

  return (
    <div>
      <p className="muted" style={{ marginBottom: 4 }}>
        {state.ensName ? <strong style={{ color: 'var(--ink)' }}>{state.ensName}</strong> : 'Receiving as'}{' '}
        <code>{short(state.registrant)}</code>
      </p>
      <div className="figure">
        {state.ledger.length === 0 ? (
          'No payments yet'
        ) : (
          <>
            <span className="mono">{balancesPending ? '…' : fmtUnits(total, cfg.usdcDecimals)}</span> USDC across{' '}
            {state.ledger.length} {state.ledger.length === 1 ? 'address' : 'addresses'}
          </>
        )}
      </div>
      <p className="muted">
        Live balances on {cfg.chain.name}. Last scan: {state.lastScannedBlock ? `block ${state.lastScannedBlock}` : 'never'}.
      </p>

      <ErrorLine error={err ?? keyError} />
      {keyMismatch && (
        <ErrorLine
          error={`This wallet derives registrant ${short(keys.registrant)}, but this browser is set up for ${short(
            state.registrant,
          )}. Switch wallet, or reset local data below.`}
        />
      )}

      <div className="actions">
        {!keys ? (
          <>
            <button className="btn-primary" disabled={busy} onClick={() => unlock().catch(() => {})}>
              {busy ? 'Waiting for signature…' : 'Sign to unlock'}
            </button>
            <span className="status">Unlock derives your keys again for this session.</span>
          </>
        ) : (
          <>
            <button className="btn-primary" disabled={!!scanning || keyMismatch} onClick={() => rescan(false)}>
              {scanning ? 'Scanning…' : 'Rescan'}
            </button>
            <button disabled={!!scanning || keyMismatch} onClick={() => rescan(true)}>
              Rescan from start
            </button>
            {scanning && <span className="status">{scanning}</span>}
          </>
        )}
      </div>

      {state.ledger.length === 0 ? (
        <div className="share">
          <div className="label">Share this to get paid</div>
          <div className="value">{metaURI}</div>
          <Copy value={metaURI} />
        </div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Block</th>
                <th>From</th>
                <th>Token</th>
                <th className="num">Announced</th>
                <th className="num">Live balance</th>
                <th>Address</th>
                <th>Tx</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {state.ledger.map((e) => (
                <Row
                  key={`${e.txHash}:${e.stealthAddress}`}
                  e={e}
                  isOpen={open === e.stealthAddress}
                  onToggle={() => setOpen(open === e.stealthAddress ? undefined : e.stealthAddress)}
                  balance={balances[e.stealthAddress]}
                  revealed={revealed[e.stealthAddress]}
                  onReveal={() => reveal(e)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      <hr />
      <div className="actions">
        <button
          className="btn-text btn-danger"
          onClick={() => {
            store.clear();
            onReset();
          }}
        >
          Reset local data
        </button>
        <span className="status">Keys come back by signing again with the same wallet; payments come back with a rescan.</span>
      </div>
    </div>
  );
}

function Row({
  e,
  isOpen,
  onToggle,
  balance,
  revealed,
  onReveal,
}: {
  e: LedgerEntry;
  isOpen: boolean;
  onToggle: () => void;
  balance?: string | undefined;
  revealed?: Hex | undefined;
  onReveal: () => void;
}) {
  const cfg = chainConfig;
  const isUsdc = e.token === cfg.usdc.toLowerCase();
  return (
    <>
      <tr className={isOpen ? 'expanded' : undefined}>
        <td className="mono">{e.blockNumber}</td>
        <td>
          <code title={e.payer !== e.caller ? `Announced by ${e.caller}` : undefined}>{short(e.payer)}</code>
        </td>
        <td>{e.token ? isUsdc ? 'USDC' : <code>{short(e.token)}</code> : <span className="muted">unknown</span>}</td>
        <td className="num">{e.amount && isUsdc ? fmtUnits(e.amount, cfg.usdcDecimals) : <span className="muted">unknown</span>}</td>
        <td className="num">{balance === undefined ? '…' : balance === 'error' ? 'error' : fmtUnits(balance, cfg.usdcDecimals)}</td>
        <td>
          <code>{short(e.stealthAddress)}</code>
          <Copy value={e.stealthAddress} />
        </td>
        <td>
          <a href={explorerTx(cfg, e.txHash)} target="_blank" rel="noreferrer">
            {short(e.txHash, 4)}
          </a>
        </td>
        <td>
          <button className="btn-text btn-inline" onClick={onToggle}>
            {isOpen ? 'Hide' : 'Details'}
          </button>
        </td>
      </tr>
      {isOpen && (
        <tr className="expanded">
          <td colSpan={8}>
            <div className="detail">
              <div>
                Address <code>{e.stealthAddress}</code>
              </div>
              <div>
                Ephemeral key <code>{e.ephemeralPublicKey}</code>
              </div>
              <div>
                View tag <code>{e.viewTag}</code>, announced by <code>{e.caller}</code>
              </div>
              <div>
                Metadata <code>{e.metadata}</code>
              </div>
              <div>
                Spending private key{' '}
                {revealed ? (
                  <>
                    <code>{revealed}</code>
                    <Copy value={revealed} />
                  </>
                ) : (
                  <button className="btn-inline" onClick={onReveal}>
                    Reveal
                  </button>
                )}
                <span className="muted"> Import it into a wallet to spend. In-app spending comes in M2.</span>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
