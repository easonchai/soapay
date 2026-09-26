import { useEffect, useMemo, useState } from 'react';
import { useAccount, usePublicClient, useSwitchChain, useWalletClient } from 'wagmi';
import {
  buildBatchCalls,
  createWalletBatchSender,
  createCompanyStore,
  browserStorage,
  BatchPartialError,
  fmtAmount,
  short,
  type PlannedRow,
  type BatchMode,
  type BatchProgress,
  type BatchResult,
} from '@soapay/sdk';
import { Dots, ErrorLine, FreshMark, NavyPanel, CountUp, Stagger, StaggerItem } from '@soapay/ui';
import { chainConfig } from './config.js';
import type { RunMeta } from './PayRun.js';

const firstLine = (e: unknown) => (e as Error).message.split('\n')[0];

export function Review({
  rows,
  meta,
  onBack,
  onSent,
}: {
  rows: PlannedRow[];
  meta: RunMeta;
  onBack: () => void;
  onSent: (result: BatchResult, runId: string) => void;
}) {
  const cfg = chainConfig;
  const { data: walletClient, error: walletError } = useWalletClient();
  const publicClient = usePublicClient();
  const { address, chain } = useAccount();
  const { switchChain, isPending: switching } = useSwitchChain();
  const wrongChain = !!chain && chain.id !== cfg.chainId;
  const company = useMemo(() => createCompanyStore(browserStorage()), []);
  const [mode, setMode] = useState<BatchMode>();
  const [progress, setProgress] = useState<BatchProgress>();
  const [err, setErr] = useState<string>();
  const [sending, setSending] = useState(false);
  const [burned, setBurned] = useState(false);

  const sender = useMemo(
    () =>
      walletClient && publicClient
        ? createWalletBatchSender({ walletClient, publicClient, chainId: cfg.chainId, token: cfg.usdc, stealthDisperse: cfg.stealthDisperse, rows })
        : null,
    [walletClient, publicClient, cfg.chainId, cfg.usdc, cfg.stealthDisperse, rows],
  );
  useEffect(() => {
    let live = true;
    sender?.detect().then((m) => live && setMode(m));
    return () => {
      live = false;
    };
  }, [sender]);

  const total = rows.reduce((a, r) => a + r.amount, 0n);
  const people = useMemo(() => {
    const m = new Map<string, { input: string; amount: bigint; lines: PlannedRow[] }>();
    for (const r of rows) {
      const cur = m.get(r.input) ?? { input: r.input, amount: 0n, lines: [] };
      cur.amount += r.amount;
      cur.lines.push(r);
      m.set(r.input, cur);
    }
    for (const p of m.values()) p.lines.sort((a, b) => a.chunkIndex - b.chunkIndex);
    return [...m.values()];
  }, [rows]);
  const chunkLabel = meta.chunk ? fmtAmount(meta.chunk, cfg.usdcDecimals).replace(/\.00$/, '') : undefined;
  const linesText = (p: { amount: bigint; lines: PlannedRow[] }) => {
    if (!meta.chunk || p.lines.length === 1) return String(p.lines.length);
    const full = p.lines.filter((l) => !l.isRemainder).length;
    const rem = p.lines.find((l) => l.isRemainder);
    return `${full} × ${chunkLabel}${rem ? ` (+${fmtAmount(rem.amount, cfg.usdcDecimals).replace(/\.00$/, '')})` : ''}`;
  };

  function finish(result: BatchResult) {
    const runId = company.recordRun({ rows, result, sentAt: Date.now(), label: meta.title });
    onSent(result, runId);
  }

  async function send() {
    if (!sender || mode === undefined) return;
    setSending(true);
    setErr(undefined);
    try {
      const result = await sender.send(buildBatchCalls(rows, cfg), setProgress, mode);
      finish(result);
    } catch (e) {
      if (e instanceof BatchPartialError) {
        finish(e.toResult());
        return;
      }
      setBurned(true);
      setErr(`${firstLine(e)} Nothing should have been sent. Go back and start a new run; do not reuse this list.`);
    } finally {
      setSending(false);
    }
  }

  const modeCard =
    mode === 'atomic'
      ? { h: 'One transaction, one signature', p: 'Your wallet batches every transfer and announcement atomically. Either the whole run lands or none of it does.' }
      : mode === 'permit'
        ? { h: 'One transaction via StealthDisperse', p: 'You sign a USDC permit for the exact total, then confirm one payment. The contract pays every line and announces each one.' }
        : mode === 'sequential'
          ? { h: `${rows.length * 2} transactions, announce first`, p: 'Your wallet cannot batch and no StealthDisperse is configured. Announcements go first, then payments, one confirmation each. Not atomic.' }
          : { h: 'Checking what your wallet supports…', p: '' };

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '420px 1fr', gap: 48, padding: '8px 0' }}>
      <div className="stack-lg">
        <span className="eyebrow">Review · {meta.title}</span>
        <h1>
          <CountUp value={Number(total) / 10 ** cfg.usdcDecimals} format={(n) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} duration={0.8} /> USDC to{' '}
          {people.length} {people.length === 1 ? 'person' : 'people'}, on {rows.length} fresh address
          {rows.length === 1 ? '' : 'es'}.
        </h1>
        <p className="ink2 pretty">
          {mode === 'sequential' ? `${rows.length * 2} transactions.` : 'One transaction.'} Each recipient&apos;s addresses are new and known only to them.{' '}
          {meta.chunk
            ? `On chain this looks like ${rows.length} payments of about ${chunkLabel} USDC to ${rows.length} strangers.`
            : `On chain this looks like ${rows.length} payments to ${rows.length} strangers.`}
        </p>
        <NavyPanel dots={false}>
          <div className="rows">
            <div>
              <span className="k">Recipients</span>
              <span>{people.length}</span>
            </div>
            <div>
              <span className="k">{meta.chunk ? `Lines (${chunkLabel} USDC chunks)` : 'Lines'}</span>
              <span>{rows.length}</span>
            </div>
            <div className="total">
              <span className="k">Total</span>
              <span className="v">{fmtAmount(total, cfg.usdcDecimals)} USDC</span>
            </div>
            <div>
              <span className="k">Network</span>
              <span>{cfg.chain.name}</span>
            </div>
            <div>
              <span className="k">From</span>
              <span>{address ? short(address) : '—'}</span>
            </div>
          </div>
        </NavyPanel>
        <div className="panel" style={{ padding: '16px 20px' }}>
          <div style={{ fontWeight: 500 }}>{modeCard.h}</div>
          {modeCard.p && <p className="ink2 pretty" style={{ marginTop: 4 }}>{modeCard.p}</p>}
        </div>
        <Dots mode="diamond" style={{ flex: 1, minHeight: 120, width: '100%' }} />
        {wrongChain && (
          <div className="notice notice-danger">
            Your wallet is on {chain?.name ?? `chain ${chain?.id}`}. This app pays on {cfg.chain.name}.
            <button onClick={() => switchChain({ chainId: cfg.chainId })} disabled={switching}>
              {switching ? 'Switching…' : `Switch to ${cfg.chain.name}`}
            </button>
          </div>
        )}
        {!wrongChain && walletError && <ErrorLine error={firstLine(walletError)} />}
        <ErrorLine error={err} />
        {progress && (
          <p className="hint">
            {progress.step} ({progress.done}/{progress.total})
          </p>
        )}
        <div className="actions">
          <button className="btn-lg" onClick={onBack} disabled={sending}>
            Back to edit
          </button>
          <button className="btn-primary btn-lg" style={{ flex: 1 }} onClick={send} disabled={sending || burned || wrongChain || !sender || mode === undefined}>
            {sending ? 'Sending…' : burned ? 'Run retired' : mode === 'sequential' ? `Sign ${rows.length * 2} transactions` : 'Sign and send'}
          </button>
        </div>
      </div>

      <div className="stack-sm" style={{ gap: 12 }}>
        <div className="between" style={{ alignItems: 'baseline' }}>
          <span style={{ fontWeight: 500 }}>What each person receives</span>
          <span className="ink2">Addresses are kept in History for your audit trail. A run always derives new ones.</span>
        </div>
        <div className="table">
          <div className="thead" style={{ gridTemplateColumns: '1.3fr 1fr 0.9fr 1.6fr' }}>
            <span>Name</span>
            <span className="r">Amount</span>
            <span className="r">Lines</span>
            <span className="r">First fresh address</span>
          </div>
          <Stagger>
          {people.slice(0, 12).map((p, i) => (
            <StaggerItem key={p.input} index={i} className="tr mono" style={{ gridTemplateColumns: '1.3fr 1fr 0.9fr 1.6fr', display: 'grid' }}>
              <span>{p.input}</span>
              <span className="r num">{fmtAmount(p.amount, cfg.usdcDecimals)}</span>
              <span className="r ink2">{linesText(p)}</span>
              <span className="r" style={{ display: 'inline-flex', justifyContent: 'flex-end', alignItems: 'center', gap: 6 }}>
                <FreshMark />
                {short(p.lines[0]!.stealthAddress, 4)}
                {p.lines.length > 1 && <span className="ink3">+{p.lines.length - 1}</span>}
              </span>
            </StaggerItem>
          ))}
          </Stagger>
          <div className="foot">
            <span>
              {people.length > 12 ? `…and ${people.length - 12} more. ` : ''}
              {meta.chunk ? 'Remainders are sent as one smaller final line.' : 'One line per recipient.'}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
