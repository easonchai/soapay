import { useEffect, useMemo, useState } from 'react';
import { usePublicClient } from 'wagmi';
import { erc20Abi } from 'viem';
import {
  createCompanyStore,
  browserStorage,
  paymentStatus,
  explorerTx,
  explorerAddr,
  fmtAmount,
  fmtDate,
  short,
  type Employee,
  type PaymentRecord,
  type SpendStatus,
} from '@soapay/sdk';
import { Copy, NavyPanel, Pill, FreshMark, Skeleton, Stagger, StaggerItem, Presence, Fade, toast } from '@soapay/ui';
import { chainConfig } from './config.js';

export function Recipients({ onPay }: { onPay: (prefill: string) => void }) {
  const cfg = chainConfig;
  const publicClient = usePublicClient();
  const company = useMemo(() => createCompanyStore(browserStorage()), []);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [payments, setPayments] = useState<PaymentRecord[]>([]);
  const [openKey, setOpenKey] = useState<string>();
  const [editing, setEditing] = useState(false);
  const [label, setLabel] = useState('');
  const [balances, setBalances] = useState<Record<string, bigint | undefined>>({});

  const reload = () => {
    setEmployees(company.listEmployees());
    setPayments(company.allPayments());
  };
  useEffect(reload, [company]);

  const open = openKey ? employees.find((e) => e.key === openKey) : undefined;
  const openPays = useMemo(() => (open ? payments.filter((p) => p.employeeKey === open.key).sort((a, b) => b.sentAt - a.sentAt) : []), [open, payments]);

  useEffect(() => {
    if (!publicClient || openPays.length === 0) return;
    let live = true;
    (async () => {
      const out: Record<string, bigint | undefined> = {};
      await Promise.all(
        openPays.map(async (p) => {
          try {
            out[p.stealthAddress] = await publicClient.readContract({ address: cfg.usdc, abi: erc20Abi, functionName: 'balanceOf', args: [p.stealthAddress] });
          } catch {
            out[p.stealthAddress] = undefined;
          }
        }),
      );
      if (live) setBalances(out);
    })();
    return () => {
      live = false;
    };
  }, [publicClient, openPays, cfg.usdc]);

  const lastAmount = (key: string) => {
    const paid = payments.filter((p) => p.employeeKey === key && p.status === 'paid').sort((a, b) => b.sentAt - a.sentAt);
    const runId = paid[0]?.runId;
    return runId ? paid.filter((p) => p.runId === runId).reduce((s, p) => s + BigInt(p.amount), 0n) : 0n;
  };
  const runsUsed = new Set(payments.map((p) => p.runId)).size;
  const lastUsed = employees.length ? Math.max(...employees.map((e) => e.lastPaidAt)) : undefined;
  const groupRows = () => employees.map((e) => `${e.input}, ${fmtAmount(lastAmount(e.key), cfg.usdcDecimals).replace(/,/g, '')}`).join('\n');

  if (employees.length === 0) {
    return (
      <div className="stack-lg">
        <div>
          <span className="eyebrow">Recipients · 0 names</span>
          <h1 style={{ marginTop: 8 }}>Everyone you&apos;ve paid</h1>
        </div>
        <div className="panel" style={{ padding: '48px 24px', maxWidth: 520 }}>
          <span className="eyebrow">Nobody yet</span>
          <h2 style={{ fontSize: 22, marginTop: 12, letterSpacing: '-0.02em' }}>Pay someone and they show up here.</h2>
          <p className="ink2 pretty" style={{ marginTop: 8 }}>
            A recipient is a name. Every run derives fresh addresses for them; past ones are kept only for your audit trail.
          </p>
          <button className="btn-primary btn-lg" style={{ marginTop: 20 }} onClick={() => onPay('')}>
            Start a pay run
          </button>
        </div>
      </div>
    );
  }

  const TONE: Record<SpendStatus, 'ok' | 'warn' | 'muted'> = { unspent: 'ok', 'partly spent': 'warn', withdrawn: 'muted', unknown: 'muted' };

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '340px 1fr', gap: 32 }}>
      <div className="stack-sm" style={{ gap: 12 }}>
        <span className="eyebrow">
          Recipients · 1 group · {employees.length} name{employees.length === 1 ? '' : 's'}
        </span>
        <h1 style={{ marginBottom: 8 }}>Groups</h1>
        <div className="panel" style={{ padding: 16, cursor: 'pointer', borderColor: open ? 'var(--line)' : 'var(--line-strong)' }} onClick={() => setOpenKey(undefined)}>
          <div className="between" style={{ alignItems: 'baseline' }}>
            <span style={{ fontWeight: 500 }}>All recipients</span>
            <span className="mono ink2">{employees.length} names</span>
          </div>
          <div className="mono ink2" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', marginTop: 6 }}>
            {employees
              .slice(0, 5)
              .map((e) => e.label.split('.')[0])
              .join(', ')}
            {employees.length > 5 ? `, +${employees.length - 5}` : ''}
          </div>
          <div className="ink3" style={{ fontSize: 12, marginTop: 6 }}>{lastUsed ? `Updated ${fmtDate(lastUsed)}` : ''}</div>
        </div>
        <button disabled title="Named groups come next">
          New group
        </button>
        <NavyPanel className="stack-sm" >
          <div style={{ fontWeight: 500 }}>Addresses live in History.</div>
          <p className="body" style={{ maxWidth: 240 }}>
            A recipient is a name. Every run derives fresh addresses; past ones are kept only for your audit trail and never paid again.
          </p>
        </NavyPanel>
      </div>

      <Presence mode="wait" initial={false}>
      {!open ? (
        <Fade key="list" className="stack" x={-16}>
          <div className="between" style={{ alignItems: 'flex-end', borderBottom: '1px solid var(--line)', paddingBottom: 16 }}>
            <div>
              <div style={{ fontSize: 20, fontWeight: 600, letterSpacing: '-0.02em' }}>All recipients</div>
              <div className="ink2" style={{ marginTop: 4 }}>
                {employees.length} name{employees.length === 1 ? '' : 's'} · used in {runsUsed} run{runsUsed === 1 ? '' : 's'}
                {lastUsed ? ` · last used ${fmtDate(lastUsed)}` : ''}
              </div>
            </div>
            <div className="actions">
              <button onClick={() => onPay('')}>Paste names</button>
              <button className="btn-primary" onClick={() => onPay(groupRows())}>
                Start pay run
              </button>
            </div>
          </div>
          <div className="table">
            <div className="thead" style={{ gridTemplateColumns: '32px 1.4fr 1fr 1fr 1.2fr' }}>
              <span>#</span>
              <span>Name</span>
              <span>Default amount</span>
              <span>Last paid</span>
              <span className="r">Record</span>
            </div>
            <Stagger>
            {employees.map((e, i) => (
              <StaggerItem key={e.key} index={i} className="tr click mono" style={{ gridTemplateColumns: '32px 1.4fr 1fr 1fr 1.2fr', display: 'grid' }} onClick={() => setOpenKey(e.key)}>
                <span className="idx">{i + 1}</span>
                <span>{e.label}</span>
                <span>{fmtAmount(lastAmount(e.key), cfg.usdcDecimals)} USDC</span>
                <span className="ink2">{fmtDate(e.lastPaidAt)}</span>
                <span className="r" style={{ fontFamily: 'var(--sans)' }}>
                  {e.previousMetaAddresses.length ? <span className="st-warn">Record changed</span> : <span className="st-ok">Active</span>}
                </span>
              </StaggerItem>
            ))}
            </Stagger>
            <div className="foot">
              <span>&quot;Record changed&quot; means the name now points to new keys; confirm with the person before the next run.</span>
            </div>
          </div>
        </Fade>
      ) : (
        <Fade key={open.key} className="stack" x={24} duration={0.22}>
          <div className="between" style={{ alignItems: 'flex-end', borderBottom: '1px solid var(--line)', paddingBottom: 16 }}>
            <div>
              <a
                href="#"
                className="ink2"
                style={{ fontSize: 12 }}
                onClick={(ev) => {
                  ev.preventDefault();
                  setOpenKey(undefined);
                  setEditing(false);
                }}
              >
                ← All recipients
              </a>
              {editing ? (
                <div className="actions" style={{ marginTop: 6 }}>
                  <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Name" />
                  <button
                    className="btn-primary"
                    onClick={() => {
                      company.renameEmployee(open.key, label);
                      setEditing(false);
                      reload();
                      toast.success('Name saved');
                    }}
                  >
                    Save
                  </button>
                  <button onClick={() => setEditing(false)}>Cancel</button>
                </div>
              ) : (
                <div style={{ fontSize: 20, fontWeight: 600, letterSpacing: '-0.02em', marginTop: 4 }}>
                  {open.label}
                  <button
                    className="btn-text btn-inline"
                    onClick={() => {
                      setLabel(open.label);
                      setEditing(true);
                    }}
                  >
                    Rename
                  </button>
                </div>
              )}
              <div className="ink2" style={{ marginTop: 4 }}>
                {openPays.length} line{openPays.length === 1 ? '' : 's'} · first paid {fmtDate(open.firstPaidAt)} · last {fmtDate(open.lastPaidAt)}
              </div>
            </div>
            <div className="actions">
              <button className="btn-primary" onClick={() => onPay(`${open.input}, ${fmtAmount(lastAmount(open.key), cfg.usdcDecimals).replace(/,/g, '')}`)}>
                Pay {open.label}
              </button>
            </div>
          </div>
          <div className="panel" style={{ padding: '14px 20px' }}>
            <dl className="facts">
              <dt>Soapay address</dt>
              <dd className="mono">
                {open.metaAddress}
                <Copy value={`st:eth:${open.metaAddress}`} />
                {open.previousMetaAddresses.length > 0 && <span className="note">Changed {open.previousMetaAddresses.length} time(s) since first payment. Confirm with the person before paying again.</span>}
              </dd>
              <dt>Paid as</dt>
              <dd className="mono">{open.input}</dd>
            </dl>
          </div>
          <div className="table">
            <div className="thead" style={{ gridTemplateColumns: '110px 0.9fr 0.9fr 1.1fr 1.8fr 90px' }}>
              <span>Date</span>
              <span className="r">Paid</span>
              <span className="r">Live balance</span>
              <span className="r" style={{ paddingRight: 20 }}>
                Status
              </span>
              <span>Fresh address</span>
              <span className="r">Tx</span>
            </div>
            <Stagger>
            {openPays.map((p, i) => {
              const b = balances[p.stealthAddress];
              const s = p.status === 'paid' ? paymentStatus(BigInt(p.amount), b) : undefined;
              return (
                <StaggerItem key={p.id} index={i} className="tr" style={{ gridTemplateColumns: '110px 0.9fr 0.9fr 1.1fr 1.8fr 90px', display: 'grid' }}>
                  <span className="ink2">{fmtDate(p.sentAt)}</span>
                  <span className="r num">{fmtAmount(p.amount, cfg.usdcDecimals)}</span>
                  <span className="r num">{b === undefined ? <Skeleton width={52} /> : fmtAmount(b, cfg.usdcDecimals)}</span>
                  <span className="r" style={{ paddingRight: 20 }}>
                    {b === undefined && p.status === 'paid' ? (
                      <Skeleton width={64} />
                    ) : s ? (
                      s === 'unspent' ? (
                        <span className="st-plain">unspent</span>
                      ) : s === 'withdrawn' ? (
                        <span className="st-muted">withdrawn</span>
                      ) : (
                        <Pill tone={TONE[s]}>{s}</Pill>
                      )
                    ) : (
                      <Pill tone={p.status === 'not sent' ? 'muted' : 'warn'}>{p.status}</Pill>
                    )}
                  </span>
                  <span className="mono" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    <FreshMark />
                    <a href={explorerAddr(cfg, p.stealthAddress)} target="_blank" rel="noreferrer">
                      {short(p.stealthAddress)}
                    </a>
                    <Copy value={p.stealthAddress} />
                  </span>
                  <span className="r mono">
                    {p.txHashes[0] ? (
                      <a href={explorerTx(cfg, p.txHashes[0])} target="_blank" rel="noreferrer">
                        {short(p.txHashes[0], 3)}
                      </a>
                    ) : (
                      <span className="ink3">—</span>
                    )}
                  </span>
                </StaggerItem>
              );
            })}
            </Stagger>
            <div className="foot">
              <span>Live balances are read from the chain. A stored address is a record, never a payment target.</span>
              <span className="legend">
                <span className="fresh" />
                fresh address, used once
              </span>
            </div>
          </div>
        </Fade>
      )}
      </Presence>
    </div>
  );
}
