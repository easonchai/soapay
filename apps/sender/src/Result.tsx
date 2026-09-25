import { chainConfig } from './config.js';
import { Pill } from '@soapay/ui';
import { type PlannedRow, type BatchResult, explorerTx, fmtUnits, short } from '@soapay/sdk';

export function Result({ rows, result, onNew }: { rows: PlannedRow[]; result: BatchResult; onNew: () => void }) {
  const cfg = chainConfig;
  const p = result.partial;

  function rowStatus(i: number): 'paid' | 'announced only' | 'not sent' | 'unknown' {
    if (!p) return 'paid';
    if (result.mode !== 'sequential') return p.pendingId || p.paidRows ? 'unknown' : 'not sent';
    if (i < p.paidRows) return 'paid';
    if (i < p.announcedRows) return 'announced only';
    return 'not sent';
  }
  const tone = (s: ReturnType<typeof rowStatus>) => (s === 'paid' ? 'ok' : s === 'not sent' ? 'muted' : 'warn');

  function exportCsv() {
    const head = 'recipient,stealth_address,amount_usdc,status,tx_hashes';
    const body = rows
      .map((r, i) => `${r.input},${r.stealthAddress},${fmtUnits(r.amount, cfg.usdcDecimals)},${rowStatus(i)},"${result.txHashes.join(' ')}"`)
      .join('\n');
    const blob = new Blob([`${head}\n${body}\n`], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `soapay-run-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <div>
      <h1>{p ? 'Run stopped early' : 'Payments sent'}</h1>
      <p className="lead">
        {p
          ? 'Some rows may already be paid. Do not send this list again; that would pay them twice.'
          : 'Ephemeral keys are discarded. This page is the only record, so download it if you need one.'}
      </p>
      {p && (
        <div className="notice notice-danger">
          {p.error} Start a new batch with only the rows marked “not sent”.
          {p.pendingId && (
            <>
              {' '}
              Bundle <code>{p.pendingId}</code> may still confirm; check your wallet activity.
            </>
          )}
        </div>
      )}

      <div className="card">
        <dl className="facts">
          <dt>Mode</dt>
          <dd>{result.mode}</dd>
          <dt>{result.txHashes.length === 1 ? 'Transaction' : 'Transactions'}</dt>
          <dd>
            {result.txHashes.length === 0 && <span className="muted">none confirmed</span>}
            {result.txHashes.map((h) => (
              <div key={h}>
                <a href={explorerTx(cfg, h)} target="_blank" rel="noreferrer">
                  <code>{short(h, 8)}</code>
                </a>
              </div>
            ))}
          </dd>
        </dl>
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Recipient</th>
              <th>Address</th>
              <th className="num">Amount</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const s = rowStatus(i);
              return (
                <tr key={r.stealthAddress}>
                  <td>
                    <code>{r.input}</code>
                  </td>
                  <td>
                    <code>{r.stealthAddress}</code>
                  </td>
                  <td className="num">{fmtUnits(r.amount, cfg.usdcDecimals)}</td>
                  <td>
                    <Pill tone={tone(s)}>{s}</Pill>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="actions">
        <button className="btn-primary" onClick={onNew}>
          Start another batch
        </button>
        <button onClick={exportCsv}>Download CSV</button>
      </div>
    </div>
  );
}
