import { useEffect, useMemo, useRef, useState } from 'react';
import { useAccount, usePublicClient, useReadContract, useSwitchChain } from 'wagmi';
import { createPublicClient, erc20Abi, http } from 'viem';
import { mainnet } from 'viem/chains';
import { normalize } from 'viem/ens';
import {
  parseBatchText,
  resolveRecipient,
  deriveRows,
  expandDenominated,
  readRegisteredMeta,
  createSenderStore,
  createCompanyStore,
  browserStorage,
  pinKey,
  fmtAmount,
  short,
  MAX_LINES_PER_RUN,
  type Resolved,
  type PlannedRow,
} from '@soapay/sdk';
import { PageHead, NavyPanel, Toggle, ErrorLine, Pill } from '@soapay/ui';
import { chainConfig } from './config.js';

export type RunMeta = { title: string; chunk?: bigint | undefined };
const firstLine = (e: unknown) => (e as Error).message.split('\n')[0];
const DRAFT_KEY = 'soapay:payrun';

type Draft = { title: string; denom: boolean; chunk: string };
function loadDraft(): Draft {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (raw) return { title: 'Pay run', denom: true, chunk: '500', ...(JSON.parse(raw) as Partial<Draft>) };
  } catch {
    /* ignore */
  }
  return { title: 'Pay run', denom: true, chunk: '500' };
}

export function PayRun({
  prefill,
  onPrefillUsed,
  onReview,
}: {
  prefill?: string | undefined;
  onPrefillUsed?: (() => void) | undefined;
  onReview: (rows: PlannedRow[], meta: RunMeta) => void;
}) {
  const cfg = chainConfig;
  const { address, chain } = useAccount();
  const { switchChain, isPending: switching } = useSwitchChain();
  const wrongChain = !!chain && chain.id !== cfg.chainId;
  const publicClient = usePublicClient();
  const store = useMemo(() => createSenderStore(browserStorage()), []);
  const company = useMemo(() => createCompanyStore(browserStorage()), []);
  const roster = useMemo(() => company.listEmployees(), [company]);

  const [text, setText] = useState('');
  const [draft, setDraft] = useState<Draft>(loadDraft);
  const [showPaste, setShowPaste] = useState(true);
  const [resolved, setResolved] = useState<Resolved[]>([]);
  const [resolving, setResolving] = useState(false);
  const [err, setErr] = useState<string>();
  const textRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setText(store.get().draft);
  }, [store]);
  useEffect(() => {
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    } catch {
      /* ignore */
    }
  }, [draft]);
  useEffect(() => {
    if (prefill === undefined) return;
    if (prefill) onText(text.trim() ? `${text.trimEnd()}\n${prefill}` : prefill);
    setShowPaste(true);
    onPrefillUsed?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefill]);

  const { lines, errors } = useMemo(() => parseBatchText(text, cfg.usdcDecimals, MAX_LINES_PER_RUN), [text, cfg.usdcDecimals]);
  const total = lines.reduce((a, l) => a + l.amount, 0n);
  const chunk = draft.denom ? BigInt(Math.max(1, Math.round(Number(draft.chunk) || 0))) * 10n ** BigInt(cfg.usdcDecimals) : undefined;
  const lineCount = useMemo(() => {
    try {
      return expandDenominated(
        lines.map((l) => ({ input: l.input, metaAddress: '0x' as `0x${string}`, amount: l.amount })),
        chunk,
      ).length;
    } catch {
      return lines.length;
    }
  }, [lines, chunk]);
  const chunksFor = (amount: bigint) => (chunk ? Number(amount / chunk) + (amount % chunk > 0n ? 1 : 0) || 1 : 1);

  const { data: balance } = useReadContract({
    address: cfg.usdc,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    query: { enabled: !!address },
  });

  function onText(v: string) {
    setText(v);
    setResolved([]);
    store.setDraft(v);
  }

  async function resolveAll() {
    if (!publicClient) return;
    setResolving(true);
    setErr(undefined);
    try {
      const l1 = createPublicClient({ chain: mainnet, transport: http(cfg.mainnetRpcUrl) });
      const pins = store.get().pins;
      const out = await Promise.all(
        lines.map((l) =>
          resolveRecipient(l.input, {
            getEnsAddress: (n) => l1.getEnsAddress({ name: normalize(n) }),
            getRegistryMeta: (r) => readRegisteredMeta(publicClient, cfg.registry, r),
            pin: pins[pinKey(l.input)],
          }),
        ),
      );
      for (const r of out) {
        if (r.status === 'ok' && !pins[pinKey(r.input)]) {
          store.setPin(r.input, { registrant: r.registrant, metaAddress: r.metaAddress, pinnedAt: Date.now() });
        }
      }
      setResolved(out);
    } catch (e) {
      setErr(firstLine(e));
    } finally {
      setResolving(false);
    }
  }

  function acceptChange(r: Extract<Resolved, { status: 'changed' }>) {
    store.setPin(r.input, { registrant: r.registrant, metaAddress: r.metaAddress, pinnedAt: Date.now() });
    setResolved((rs) => rs.map((x) => (x.input === r.input ? { status: 'ok', input: r.input, registrant: r.registrant, metaAddress: r.metaAddress } : x)));
  }

  function loadGroup() {
    const rowsText = roster
      .map((e) => {
        const last = company.paymentsFor(e.key).filter((p) => p.status === 'paid');
        const lastRun = last[0]?.runId;
        const amt = last.filter((p) => p.runId === lastRun).reduce((s, p) => s + BigInt(p.amount), 0n);
        return `${e.input}, ${amt > 0n ? fmtAmount(amt, cfg.usdcDecimals).replace(/,/g, '') : ''}`.trim();
      })
      .join('\n');
    onText(rowsText);
    setShowPaste(true);
  }

  function review() {
    setErr(undefined);
    try {
      const rows = deriveRows(
        lines.map((l, i) => {
          const r = resolved[i];
          if (!r || r.status !== 'ok') throw new Error('Resolve every name first');
          return { input: l.input, metaAddress: r.metaAddress, amount: l.amount };
        }),
        cfg.usdc,
        { chunk },
      );
      onReview(rows, { title: draft.title.trim() || 'Pay run', chunk });
    } catch (e) {
      setErr(firstLine(e));
    }
  }

  const failed = resolved.filter((r) => r.status === 'error');
  const changed = resolved.filter((r) => r.status === 'changed');
  const allResolved = lines.length > 0 && resolved.length === lines.length;
  const allOk = allResolved && errors.length === 0 && resolved.every((r) => r.status === 'ok');
  const enough = balance === undefined || balance >= total;
  let reviewLabel = 'Review';
  if (lines.length === 0) reviewLabel = 'Review — add recipients first';
  else if (errors.length) reviewLabel = `Review — fix ${errors.length} line${errors.length === 1 ? '' : 's'} first`;
  else if (!allResolved) reviewLabel = 'Review — resolve names first';
  else if (failed.length) reviewLabel = `Review — fix ${failed.length} failed name${failed.length === 1 ? '' : 's'} first`;
  else if (changed.length) reviewLabel = `Review — accept ${changed.length} changed record${changed.length === 1 ? '' : 's'} first`;
  else if (wrongChain) reviewLabel = `Review — switch to ${cfg.chain.name} first`;
  else if (!enough) reviewLabel = 'Review — not enough USDC';
  else if (lineCount > MAX_LINES_PER_RUN) reviewLabel = `Review — ${lineCount} lines, cap is ${MAX_LINES_PER_RUN}`;
  const canReview = allOk && !wrongChain && enough && lineCount <= MAX_LINES_PER_RUN;

  const summary = (() => {
    if (lines.length === 0) return 'Paste rows to begin.';
    const parts = [`${lines.length} recipient${lines.length === 1 ? '' : 's'}.`];
    if (failed.length) {
      const f = failed[0]!;
      parts.push(`${failed.length} name${failed.length === 1 ? '' : 's'} failed: ${f.input} — ${f.message.replace(/^No stealth meta-address registered for .*/, 'no Soapay record')}. Remove the line or ask them to set up a name before you sign.`);
    }
    if (changed.length) parts.push(`${changed.length} record${changed.length === 1 ? '' : 's'} changed since last pinned; confirm with the person, then accept.`);
    if (!allResolved && errors.length === 0) parts.push('Press Resolve to check every name against the registry.');
    return parts.join(' ');
  })();

  return (
    <div className="stack-lg">
      <PageHead
        eyebrow={`Pay run · draft · ${lines.length} recipient${lines.length === 1 ? '' : 's'}`}
        title={
          <input
            aria-label="Run name"
            value={draft.title}
            onChange={(e) => setDraft({ ...draft, title: e.target.value })}
            style={{ font: 'inherit', fontSize: 26, fontWeight: 600, letterSpacing: '-0.02em', border: 0, padding: 0, height: 'auto', width: '100%', boxShadow: 'none', background: 'transparent' }}
          />
        }
        line="Paste name, amount from a spreadsheet. Names resolve when you press Resolve; nothing is sent until you sign."
        actions={
          <>
            <button onClick={loadGroup} disabled={roster.length === 0} title={roster.length ? 'Everyone you have paid, with their last amounts' : 'Pay someone first'}>
              Load group: All recipients
            </button>
            <button
              onClick={() => {
                setShowPaste(true);
                setTimeout(() => textRef.current?.focus(), 0);
              }}
            >
              Paste rows
            </button>
          </>
        }
      />

      {wrongChain && (
        <div className="notice notice-danger">
          Your wallet is on {chain?.name ?? `chain ${chain?.id}`}. This app pays on {cfg.chain.name}.
          <button onClick={() => switchChain({ chainId: cfg.chainId })} disabled={switching}>
            {switching ? 'Switching…' : `Switch to ${cfg.chain.name}`}
          </button>
        </div>
      )}
      <ErrorLine error={err} />

      <div className="grid-2">
        <div className="stack">
          {showPaste && (
            <textarea
              ref={textRef}
              value={text}
              onChange={(e) => onText(e.target.value)}
              placeholder={'alice.soapay.eth, 4200\nbram.eth, 3850\nst:eth:0x02ab…, 250\n\nOne recipient per line: name or address, comma, amount in USDC.'}
              aria-label="Recipients and amounts"
              style={{ minHeight: 96 }}
            />
          )}
          {errors.map((e) => (
            <ErrorLine key={`${e.line}-${e.message}`} error={e.line ? `Line ${e.line}: ${e.message}` : e.message} />
          ))}

          <div className="table">
            <div className="thead" style={{ gridTemplateColumns: '32px 1.4fr 1fr 80px 1.4fr' }}>
              <span>#</span>
              <span>Name</span>
              <span className="r">Amount</span>
              <span className="r">Token</span>
              <span className="r">Resolution</span>
            </div>
            {lines.map((l, i) => {
              const r = resolved[i];
              return (
                <div key={i} className="tr hover" style={{ gridTemplateColumns: '32px 1.4fr 1fr 80px 1.4fr' }}>
                  <span className="idx">{i + 1}</span>
                  <span className="mono">{l.input}</span>
                  <span className="r num">{fmtAmount(l.amount, cfg.usdcDecimals)}</span>
                  <span className="r ink2">USDC</span>
                  <span style={{ display: 'flex', justifyContent: 'flex-end' }}>
                    {!r && !resolving && <span className="res ink3">Not checked</span>}
                    {!r && resolving && (
                      <span className="res res-wait">
                        <span className="sq sq-wait" />
                        Resolving…
                      </span>
                    )}
                    {r?.status === 'ok' && (
                      <span className="res res-ok">
                        <span className="sq sq-ok" />
                        Resolved · {chunksFor(l.amount)} fresh address{chunksFor(l.amount) === 1 ? '' : 'es'}
                      </span>
                    )}
                    {r?.status === 'error' && (
                      <Pill tone="danger">{/no stealth meta-address/i.test(r.message) ? 'No Soapay record' : r.message}</Pill>
                    )}
                    {r?.status === 'changed' && (
                      <span className="res">
                        <Pill tone="warn">Record changed</Pill>
                        <button className="btn-inline" onClick={() => acceptChange(r)}>
                          Accept
                        </button>
                      </span>
                    )}
                  </span>
                </div>
              );
            })}
            <div className="tr empty-row" style={{ gridTemplateColumns: '32px 1fr' }}>
              <span className="idx">{lines.length + 1}</span>
              <button className="btn-text" style={{ justifyContent: 'flex-start', paddingLeft: 0, color: 'var(--ink-disabled)' }} onClick={() => { setShowPaste(true); setTimeout(() => textRef.current?.focus(), 0); }}>
                Type a name or paste more rows…
              </button>
            </div>
          </div>
          <div className="between">
            <span className="ink2">{summary}</span>
            <button className="btn" onClick={resolveAll} disabled={resolving || lines.length === 0 || errors.length > 0 || !publicClient}>
              {resolving ? 'Resolving…' : allResolved ? 'Resolve again' : 'Resolve names'}
            </button>
          </div>
        </div>

        <div className="stack">
          <div className="panel panel-pad stack">
            <div className="between">
              <span style={{ fontWeight: 500 }}>Denominated payouts</span>
              <Toggle on={draft.denom} onChange={(v) => setDraft({ ...draft, denom: v })} label="Denominated payouts" />
            </div>
            <p className="ink2 pretty">Splits each salary into equal chunks so amounts on chain don&apos;t identify people. Costs more gas.</p>
            <label className="field">
              <span>Chunk size</span>
              <div className="addon">
                <input className="mono-in" value={draft.chunk} onChange={(e) => setDraft({ ...draft, chunk: e.target.value.replace(/[^\d]/g, '') })} disabled={!draft.denom} inputMode="numeric" />
                <span className="suffix">USDC</span>
              </div>
            </label>
            <div className="navy-like rows" style={{ borderTop: '1px solid var(--hairline)', paddingTop: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div className="between num" style={{ fontSize: 12 }}>
                <span style={{ fontFamily: 'var(--sans)' }} className="ink2">
                  Recipients shown
                </span>
                <span>{lines.length}</span>
              </div>
              <div className="between num" style={{ fontSize: 12 }}>
                <span style={{ fontFamily: 'var(--sans)' }} className="ink2">
                  Becomes lines
                </span>
                <span className={lineCount > MAX_LINES_PER_RUN ? 'st-warn' : undefined}>{lineCount}</span>
              </div>
              <div className="between num" style={{ fontSize: 12 }}>
                <span style={{ fontFamily: 'var(--sans)' }} className="ink2">
                  Est. gas on {cfg.chain.name}
                </span>
                <span className="ink3">—</span>
              </div>
            </div>
          </div>

          <NavyPanel>
            <span className="label">
              Total · {lines.length} recipient{lines.length === 1 ? '' : 's'}
            </span>
            <span className="amount">
              {fmtAmount(total, cfg.usdcDecimals)}
              <span className="unit">USDC</span>
            </span>
            <div className="rows rule">
              <div>
                <span className="k">Wallet balance after</span>
                <span>{balance === undefined ? '…' : `${fmtAmount(balance - total < 0n ? 0n : balance - total, cfg.usdcDecimals)} USDC`}</span>
              </div>
            </div>
          </NavyPanel>

          <button className="btn-primary btn-lg" onClick={review} disabled={!canReview}>
            {reviewLabel}
          </button>
          <p className="hint">Nothing is cached between runs; every Resolve reads the chain. Sending from {address ? short(address) : 'your wallet'}.</p>
        </div>
      </div>
    </div>
  );
}
