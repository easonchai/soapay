import { useMemo, useState } from 'react';
import { createCompanyStore, browserStorage, explorerTx, fmtAmount, fmtDate, short, type PaymentRecord, type RunRecord } from '@soapay/sdk';
import { PageHead, NavyPanel } from '@soapay/ui';
import { chainConfig } from './config.js';

export function History({ openRunId, onStartRun }: { openRunId?: string | undefined; onStartRun: () => void }) {
  const cfg = chainConfig;
  const company = useMemo(() => createCompanyStore(browserStorage()), []);
  const runs = useMemo(() => company.listRuns(), [company]);
  const payments = useMemo(() => company.allPayments(), [company]);
  const [open, setOpen] = useState<string | undefined>(openRunId ?? runs[0]?.id);

  const year = new Date().getFullYear();
  const paidThisYear = runs.filter((r) => new Date(r.sentAt).getFullYear() === year).reduce((s, r) => s + BigInt(r.total), 0n);
  const funded = payments.filter((p) => p.status === 'paid').length;
  const first = runs.length ? runs[runs.length - 1]!.sentAt : undefined;

  function linesOf(run: RunRecord) {
    const list = company.paymentsForRun(run.id);
    const by = new Map<string, PaymentRecord[]>();
    for (const p of list) by.set(p.employeeKey, [...(by.get(p.employeeKey) ?? []), p]);
    return [...by.entries()].map(([key, ps]) => {
      const emp = company.getEmployee(key);
      const status = ps.every((p) => p.status === 'paid') ? 'Confirmed' : ps.some((p) => p.status === 'paid') ? 'Partly paid' : ps[0]?.status === 'announced only' ? 'Announced only' : ps[0]?.status === 'unknown' ? 'Unknown' : 'Not sent';
      return { key, name: emp?.label ?? key, amount: ps.reduce((s, p) => s + BigInt(p.amount), 0n), lines: ps.length, status };
    });
  }

  function exportCsv() {
    const head = 'run,date,recipient,stealth_address,amount_usdc,status,tx_hashes';
    const body = payments
      .map((p) => {
        const run = runs.find((r) => r.id === p.runId);
        return `${JSON.stringify(run?.label ?? p.runId)},${fmtDate(p.sentAt)},${p.employeeKey},${p.stealthAddress},${fmtAmount(p.amount, cfg.usdcDecimals).replace(/,/g, '')},${p.status},"${p.txHashes.join(' ')}"`;
      })
      .join('\n');
    const blob = new Blob([`${head}\n${body}\n`], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `soapay-history-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  if (runs.length === 0) {
    return (
      <div className="stack-lg">
        <PageHead eyebrow="History · no runs yet" title="Every run this wallet has signed" line="Your audit trail. Names, amounts and the fresh addresses each run created." />
        <div className="panel" style={{ padding: '48px 24px', maxWidth: 520 }}>
          <span className="eyebrow">Nothing sent yet</span>
          <h2 style={{ fontSize: 22, marginTop: 12, letterSpacing: '-0.02em' }}>Your first pay run will appear here.</h2>
          <p className="ink2 pretty" style={{ marginTop: 8 }}>
            Each run keeps who was paid, how much, and which fresh addresses were created, so you can audit it later.
          </p>
          <button className="btn-primary btn-lg" style={{ marginTop: 20 }} onClick={onStartRun}>
            Start a pay run
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="stack-lg">
      <PageHead
        eyebrow={`History · ${runs.length} run${runs.length === 1 ? '' : 's'}${first ? ` since ${fmtDate(first).slice(3)}` : ''}`}
        title="Every run this wallet has signed"
        line="Your audit trail. Names, amounts and the fresh addresses each run created."
        actions={<button onClick={exportCsv}>Export CSV</button>}
      />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
        <NavyPanel className="stat" dots={false}>
          <span className="k">Paid in {year}</span>
          <span className="v">
            {fmtAmount(paidThisYear, cfg.usdcDecimals)} <span className="unit">USDC</span>
          </span>
        </NavyPanel>
        <div className="stat">
          <span className="k">Fresh addresses funded</span>
          <span className="v">{funded}</span>
        </div>
        <div className="stat">
          <span className="k">Runs</span>
          <span className="v">{runs.length}</span>
        </div>
      </div>
      <div className="table">
        <div className="thead" style={{ gridTemplateColumns: '130px 1.4fr 100px 1fr 1fr 24px' }}>
          <span>Date</span>
          <span>Run</span>
          <span className="r">Lines</span>
          <span className="r">Total</span>
          <span className="r">Transaction</span>
          <span />
        </div>
        {runs.map((r) => {
          const isOpen = open === r.id;
          const tx = r.txHashes[0];
          return (
            <div key={r.id}>
              <div className="tr tall click" style={{ gridTemplateColumns: '130px 1.4fr 100px 1fr 1fr 24px' }} onClick={() => setOpen(isOpen ? undefined : r.id)}>
                <span className="ink2">{fmtDate(r.sentAt)}</span>
                <span style={{ fontWeight: 500 }}>
                  {r.label}
                  {r.partial && (
                    <span className="st-warn" style={{ marginLeft: 8, fontWeight: 400 }}>
                      stopped early
                    </span>
                  )}
                </span>
                <span className="r mono">{r.lines}</span>
                <span className="r num">
                  {fmtAmount(r.total, cfg.usdcDecimals)} <span className="ink2">USDC</span>
                </span>
                <span className="r mono">
                  {tx ? (
                    <a href={explorerTx(cfg, tx)} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
                      {short(tx, 4)} ↗
                    </a>
                  ) : (
                    <span className="ink3">none</span>
                  )}
                </span>
                <span style={{ display: 'flex', justifyContent: 'flex-end' }}>
                  <span style={{ width: 7, height: 7, borderRight: '1.5px solid var(--ink2)', borderBottom: '1.5px solid var(--ink2)', transform: isOpen ? 'rotate(-135deg)' : 'rotate(45deg)' }} />
                </span>
              </div>
              {isOpen && (
                <div className="sub">
                  <div className="thead" style={{ gridTemplateColumns: '1.4fr 1fr 1fr 1.2fr' }}>
                    <span>Name</span>
                    <span className="r">Amount</span>
                    <span className="r">Lines</span>
                    <span className="r">Status</span>
                  </div>
                  {linesOf(r).map((l) => (
                    <div key={l.key} className="tr mono" style={{ gridTemplateColumns: '1.4fr 1fr 1fr 1.2fr' }}>
                      <span>{l.name}</span>
                      <span className="r num">{fmtAmount(l.amount, cfg.usdcDecimals)}</span>
                      <span className="r ink2">{l.lines}</span>
                      <span className={`r ${l.status === 'Confirmed' ? 'st-ok' : l.status === 'Not sent' ? 'ink3' : 'st-warn'}`} style={{ fontFamily: 'var(--sans)' }}>
                        {l.status}
                      </span>
                    </div>
                  ))}
                  <div className="between" style={{ paddingTop: 10, fontSize: 12 }}>
                    <span className="ink2">
                      {r.mode === 'atomic' ? 'One atomic transaction.' : r.mode === 'permit' ? 'One transaction via StealthDisperse.' : `${r.txHashes.length} transactions.`}{' '}
                      Sent {fmtDate(r.sentAt)}.
                    </span>
                    {tx && (
                      <a href={explorerTx(cfg, tx)} target="_blank" rel="noreferrer">
                        Open in explorer ↗
                      </a>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
