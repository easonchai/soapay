import { useEffect, useMemo, useState } from 'react';
import { usePublicClient } from 'wagmi';
import { erc20Abi } from 'viem';
import {
  createCompanyStore,
  browserStorage,
  paymentStatus,
  explorerTx,
  explorerAddr,
  fmtUnits,
  short,
  type Employee,
  type PaymentRecord,
  type SpendStatus,
} from '@soapay/sdk';
import { Copy, Pill, type Tone } from '@soapay/ui';
import { chainConfig } from './config.js';

const TONE: Record<SpendStatus, Tone> = { unspent: 'ok', 'partly spent': 'warn', withdrawn: 'muted', unknown: 'muted' };
const when = (ms: number) => new Date(ms).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });

export function Employees({ onPay }: { onPay: (input: string) => void }) {
  const cfg = chainConfig;
  const publicClient = usePublicClient();
  const store = useMemo(() => createCompanyStore(browserStorage()), []);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [payments, setPayments] = useState<PaymentRecord[]>([]);
  const [balances, setBalances] = useState<Record<string, bigint | undefined>>({});
  const [openKey, setOpenKey] = useState<string>();
  const [editing, setEditing] = useState<string>();
  const [label, setLabel] = useState('');

  const reload = () => {
    setEmployees(store.listEmployees());
    setPayments(store.allPayments());
  };
  useEffect(reload, [store]);

  // Live balances for every wallet the company created. Read-only; nothing here is ever paid again.
  useEffect(() => {
    if (!publicClient || payments.length === 0) return;
    let live = true;
    (async () => {
      const out: Record<string, bigint | undefined> = {};
      await Promise.all(
        payments.map(async (p) => {
          try {
            out[p.stealthAddress] = await publicClient.readContract({
              address: cfg.usdc,
              abi: erc20Abi,
              functionName: 'balanceOf',
              args: [p.stealthAddress],
            });
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
  }, [publicClient, payments, cfg.usdc]);

  const byEmployee = useMemo(() => {
    const m = new Map<string, PaymentRecord[]>();
    for (const p of payments) m.set(p.employeeKey, [...(m.get(p.employeeKey) ?? []), p]);
    for (const list of m.values()) list.sort((a, b) => b.sentAt - a.sentAt);
    return m;
  }, [payments]);

  const sums = (list: PaymentRecord[]) => {
    let paid = 0n;
    let live = 0n;
    let pending = false;
    for (const p of list) {
      if (p.status !== 'paid') continue;
      paid += BigInt(p.amount);
      const b = balances[p.stealthAddress];
      if (b === undefined) pending = true;
      else live += b;
    }
    return { paid, live, pending };
  };

  if (employees.length === 0) {
    return (
      <div>
        <h1>Employees</h1>
        <p className="lead">Nobody yet. Everyone you pay shows up here, with every stealth wallet you created for them.</p>
        <div className="actions">
          <button className="btn-primary" onClick={() => onPay('')}>
            Pay your team
          </button>
        </div>
      </div>
    );
  }

  const open = openKey ? employees.find((e) => e.key === openKey) : undefined;

  if (open) {
    const list = byEmployee.get(open.key) ?? [];
    const t = sums(list);
    return (
      <div>
        <p className="muted" style={{ marginBottom: 4 }}>
          <a
            href="#"
            onClick={(e) => {
              e.preventDefault();
              setOpenKey(undefined);
            }}
          >
            All employees
          </a>
        </p>
        {editing === open.key ? (
          <div className="actions" style={{ marginTop: 0 }}>
            <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Name" />
            <button
              className="btn-primary"
              onClick={() => {
                store.renameEmployee(open.key, label);
                setEditing(undefined);
                reload();
              }}
            >
              Save name
            </button>
            <button onClick={() => setEditing(undefined)}>Cancel</button>
          </div>
        ) : (
          <h1>
            {open.label}{' '}
            <button
              className="btn-text btn-inline"
              onClick={() => {
                setEditing(open.key);
                setLabel(open.label);
              }}
            >
              Rename
            </button>
          </h1>
        )}
        <p className="lead">
          Paid <span className="mono">{fmtUnits(t.paid, cfg.usdcDecimals)}</span> USDC over {list.length}{' '}
          {list.length === 1 ? 'payment' : 'payments'}.{' '}
          {t.pending ? 'Checking balances…' : <>Still in their stealth wallets: <span className="mono">{fmtUnits(t.live, cfg.usdcDecimals)}</span> USDC.</>}
        </p>
        <div className="card">
          <dl className="facts">
            <dt>Soapay address</dt>
            <dd>
              <code>{open.metaAddress}</code>
              <Copy value={`st:eth:${open.metaAddress}`} />
              {open.previousMetaAddresses.length > 0 && (
                <span className="note">Changed {open.previousMetaAddresses.length} time(s) since first payment.</span>
              )}
            </dd>
            <dt>Paid as</dt>
            <dd>
              <code>{open.input}</code>
            </dd>
          </dl>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th className="num">Paid</th>
                <th className="num">Live balance</th>
                <th>Status</th>
                <th>Stealth wallet</th>
                <th>Tx</th>
              </tr>
            </thead>
            <tbody>
              {list.map((p) => {
                const b = balances[p.stealthAddress];
                const s = p.status === 'paid' ? paymentStatus(BigInt(p.amount), b) : undefined;
                return (
                  <tr key={p.id}>
                    <td>{when(p.sentAt)}</td>
                    <td className="num">{fmtUnits(p.amount, cfg.usdcDecimals)}</td>
                    <td className="num">{b === undefined ? '…' : fmtUnits(b, cfg.usdcDecimals)}</td>
                    <td>{s ? <Pill tone={TONE[s]}>{s}</Pill> : <Pill tone={p.status === 'not sent' ? 'muted' : 'warn'}>{p.status}</Pill>}</td>
                    <td>
                      <a href={explorerAddr(cfg, p.stealthAddress)} target="_blank" rel="noreferrer">
                        <code>{short(p.stealthAddress)}</code>
                      </a>
                      <Copy value={p.stealthAddress} />
                    </td>
                    <td>
                      {p.txHashes[0] ? (
                        <a href={explorerTx(cfg, p.txHashes[0])} target="_blank" rel="noreferrer">
                          {short(p.txHashes[0], 4)}
                        </a>
                      ) : (
                        <span className="muted">none</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="actions">
          <button className="btn-primary" onClick={() => onPay(open.input)}>
            Pay {open.label}
          </button>
        </div>
      </div>
    );
  }

  const all = sums(payments);
  return (
    <div>
      <h1>Employees</h1>
      <p className="lead">
        {employees.length} {employees.length === 1 ? 'person' : 'people'}, <span className="mono">{fmtUnits(all.paid, cfg.usdcDecimals)}</span> USDC paid in total.{' '}
        {all.pending ? 'Checking balances…' : <>Still sitting in stealth wallets: <span className="mono">{fmtUnits(all.live, cfg.usdcDecimals)}</span> USDC.</>}
      </p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Employee</th>
              <th>Soapay address</th>
              <th className="num">Payments</th>
              <th className="num">Paid</th>
              <th className="num">Unspent</th>
              <th>Last paid</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {employees.map((e) => {
              const list = byEmployee.get(e.key) ?? [];
              const t = sums(list);
              return (
                <tr key={e.key}>
                  <td>
                    <a
                      href="#"
                      onClick={(ev) => {
                        ev.preventDefault();
                        setOpenKey(e.key);
                      }}
                    >
                      {e.label}
                    </a>
                  </td>
                  <td>
                    <code>{short(e.metaAddress, 8)}</code>
                  </td>
                  <td className="num">{list.length}</td>
                  <td className="num">{fmtUnits(t.paid, cfg.usdcDecimals)}</td>
                  <td className="num">{t.pending ? '…' : fmtUnits(t.live, cfg.usdcDecimals)}</td>
                  <td>{when(e.lastPaidAt)}</td>
                  <td>
                    <button className="btn-text btn-inline" onClick={() => onPay(e.input)}>
                      Pay
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
