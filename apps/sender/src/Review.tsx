import { useEffect, useMemo, useState } from 'react';
import { useAccount, usePublicClient, useSwitchChain, useWalletClient } from 'wagmi';
import { chainConfig } from './config.js';
import { ErrorLine } from '@soapay/ui';
import { Pill } from '@soapay/ui';
import { type PlannedRow, buildBatchCalls, createWalletBatchSender, BatchPartialError, type BatchMode, type BatchProgress, type BatchResult, fmtUnits } from '@soapay/sdk';

const firstLine = (e: unknown) => (e as Error).message.split('\n')[0];

export function Review({
  rows,
  onBack,
  onSent,
}: {
  rows: PlannedRow[];
  onBack: () => void;
  onSent: (r: BatchResult) => void;
}) {
  const cfg = chainConfig;
  const { data: walletClient, error: walletError } = useWalletClient();
  const publicClient = usePublicClient();
  const { chain } = useAccount();
  const { switchChain, isPending: switching } = useSwitchChain();
  const wrongChain = !!chain && chain.id !== cfg.chainId;
  const [mode, setMode] = useState<BatchMode>();
  const [progress, setProgress] = useState<BatchProgress>();
  const [err, setErr] = useState<string>();
  const [sending, setSending] = useState(false);
  /** After any failure the rows are burned: some may be paid. Only Back is allowed. */
  const [burned, setBurned] = useState(false);

  const sender = useMemo(
    () =>
      walletClient && publicClient
        ? createWalletBatchSender({
            walletClient,
            publicClient,
            chainId: cfg.chainId,
            token: cfg.usdc,
            stealthDisperse: cfg.stealthDisperse,
            rows,
          })
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

  async function send() {
    if (!sender || mode === undefined) return;
    setSending(true);
    setErr(undefined);
    try {
      const result = await sender.send(buildBatchCalls(rows, cfg), setProgress, mode);
      onSent(result);
    } catch (e) {
      if (e instanceof BatchPartialError) {
        // Something reached the chain. Show it; never re-offer Send for these rows.
        onSent(e.toResult());
        return;
      }
      setBurned(true);
      setErr(`${firstLine(e)} Nothing should have been sent. Go back and start a new run; do not reuse this list.`);
    } finally {
      setSending(false);
    }
  }

  const total = rows.reduce((a, r) => a + r.amount, 0n);
  const sendLabel = sending
    ? 'Sending…'
    : burned
      ? 'Run retired'
      : mode === 'sequential'
        ? `Send ${rows.length * 2} transactions`
        : 'Send batch';

  return (
    <div>
      <h1>Review batch</h1>
      <p className="lead">
        {rows.length} {rows.length === 1 ? 'payment' : 'payments'}, <span className="mono">{fmtUnits(total, cfg.usdcDecimals)}</span> USDC
        in total. Each row goes to a fresh address created for this run only.
      </p>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>Recipient</th>
              <th>Fresh address</th>
              <th className="num">Amount</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.stealthAddress}>
                <td className="mono">{i + 1}</td>
                <td>
                  <code>{r.input}</code>
                </td>
                <td>
                  <code>{r.stealthAddress}</code>
                </td>
                <td className="num">{fmtUnits(r.amount, cfg.usdcDecimals)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card">
        <dl className="facts">
          <dt>How it sends</dt>
          <dd>
            {mode === undefined && <span className="muted">Checking what your wallet supports…</span>}
            {mode === 'atomic' && (
              <>
                <Pill tone="ok">One transaction</Pill> <span>Your wallet batches all transfers and announcements atomically. One signature.</span>
              </>
            )}
            {mode === 'permit' && (
              <>
                <Pill tone="ok">One transaction</Pill>{' '}
                <span>Sign a USDC permit for the exact total, then confirm one payment through StealthDisperse.</span>
              </>
            )}
            {mode === 'sequential' && (
              <>
                <Pill tone="warn">{rows.length * 2} transactions</Pill>{' '}
                <span>
                  Your wallet cannot batch and no StealthDisperse is configured. Announcements go first, then payments, each
                  its own transaction. Not atomic.
                </span>
              </>
            )}
          </dd>
          <dt>Order</dt>
          <dd>Rows are sorted by address, so the on-chain order says nothing about who is who.</dd>
        </dl>
      </div>

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
        <p className="muted">
          {progress.step} ({progress.done}/{progress.total})
        </p>
      )}

      <div className="actions">
        <button className="btn-primary" onClick={send} disabled={sending || burned || wrongChain || !sender || mode === undefined}>
          {sendLabel}
        </button>
        <button onClick={onBack} disabled={sending}>
          Back
        </button>
      </div>
    </div>
  );
}
