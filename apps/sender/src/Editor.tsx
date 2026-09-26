import { useEffect, useMemo, useState } from 'react';
import { useAccount, useConnect, usePublicClient, useReadContract, useSwitchChain } from 'wagmi';
import { createPublicClient, erc20Abi, http } from 'viem';
import { mainnet } from 'viem/chains';
import { normalize } from 'viem/ens';
import { chainConfig } from './config.js';
import { ErrorLine } from '@soapay/ui';
import { Pill } from '@soapay/ui';
import { parseBatchText, resolveRecipient, type Resolved, deriveRows, type PlannedRow, readRegisteredMeta, createSenderStore, pinKey, browserStorage, fmtUnits, short, createCompanyStore } from '@soapay/sdk';

/** Per contracts/PLAN.md: ~42k gas per line, 350 keeps margin under the per-tx cap. */
const MAX_ROWS = 350;
const firstLine = (e: unknown) => (e as Error).message.split('\n')[0];

export function Editor({
  onContinue,
  prefill,
  onPrefillUsed,
}: {
  onContinue: (rows: PlannedRow[]) => void;
  prefill?: string | undefined;
  onPrefillUsed?: (() => void) | undefined;
}) {
  const cfg = chainConfig;
  const { address, isConnected, chain } = useAccount();
  const { connect, connectors } = useConnect();
  const { switchChain, isPending: switching } = useSwitchChain();
  const wrongChain = isConnected && !!chain && chain.id !== cfg.chainId;
  const publicClient = usePublicClient();
  const store = useMemo(() => createSenderStore(browserStorage()), []);
  const company = useMemo(() => createCompanyStore(browserStorage()), []);
  const roster = useMemo(() => company.listEmployees(), [company]);
  const [text, setText] = useState('');
  const [resolved, setResolved] = useState<Resolved[]>([]);
  const [resolving, setResolving] = useState(false);
  const [err, setErr] = useState<string>();

  // Load the unsent draft after mount so server and first client render match.
  useEffect(() => {
    setText(store.get().draft);
  }, [store]);

  // "Pay <employee>" from the Employees view lands here with the recipient prefilled.
  useEffect(() => {
    if (prefill === undefined) return;
    if (prefill) setText((t) => (t.trim() ? `${t.trimEnd()}\n${prefill}, ` : `${prefill}, `));
    onPrefillUsed?.();
  }, [prefill, onPrefillUsed]);

  function insert(input: string) {
    onText(text.trim() ? `${text.trimEnd()}\n${input}, ` : `${input}, `);
  }

  const { lines, errors } = useMemo(() => parseBatchText(text, cfg.usdcDecimals, MAX_ROWS), [text, cfg.usdcDecimals]);
  const total = lines.reduce((a, l) => a + l.amount, 0n);
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
    setResolved((rs) =>
      rs.map((x) =>
        x.input === r.input ? { status: 'ok', input: r.input, registrant: r.registrant, metaAddress: r.metaAddress } : x,
      ),
    );
  }

  function proceed() {
    setErr(undefined);
    try {
      const rows = deriveRows(
        lines.map((l, i) => {
          const r = resolved[i];
          if (!r || r.status !== 'ok') throw new Error('Resolve every row first');
          return { input: l.input, metaAddress: r.metaAddress, amount: l.amount };
        }),
        cfg.usdc,
      );
      onContinue(rows);
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  const allOk =
    lines.length > 0 && errors.length === 0 && resolved.length === lines.length && resolved.every((r) => r.status === 'ok');
  const enough = balance === undefined || balance >= total;

  return (
    <div>
      <h1>Pay a batch</h1>
      <p className="lead">
        One recipient per line as <code>recipient, amount</code>. A recipient is an ENS name, a registrant address, or a{' '}
        <code>st:eth:0x…</code> meta-address. Up to {MAX_ROWS} rows.
      </p>

      {!isConnected ? (
        <div className="actions">
          <button className="btn-primary" onClick={() => { const c = connectors[0]; if (c) connect({ connector: c }); }} disabled={!connectors[0]}>
            {connectors[0] ? 'Connect wallet' : 'No wallet extension found'}
          </button>
        </div>
      ) : (
        <p className="muted">
          Paying from <code>{address && short(address)}</code>, USDC balance{' '}
          <span className="mono">{balance === undefined ? '…' : fmtUnits(balance, cfg.usdcDecimals)}</span>
        </p>
      )}
      {wrongChain && (
        <div className="notice notice-danger">
          Your wallet is on {chain?.name ?? `chain ${chain?.id}`}. This app pays on {cfg.chain.name}.
          <button onClick={() => switchChain({ chainId: cfg.chainId })} disabled={switching}>
            {switching ? 'Switching…' : `Switch to ${cfg.chain.name}`}
          </button>
        </div>
      )}

      {roster.length > 0 && (
        <p className="muted">
          Add from your team:{' '}
          {roster.map((e) => (
            <button key={e.key} className="btn-inline" onClick={() => insert(e.input)} title={e.input}>
              {e.label}
            </button>
          ))}
        </p>
      )}
      <div className="card">
        <textarea
          value={text}
          onChange={(e) => onText(e.target.value)}
          placeholder={'alice.eth, 500\n0x9f3c…c2a1, 500\nst:eth:0x02ab…, 250'}
          aria-label="Recipients and amounts"
        />
      </div>
      <ErrorLine error={err} />
      {errors.map((e) => (
        <ErrorLine key={`${e.line}-${e.message}`} error={e.line ? `Line ${e.line}: ${e.message}` : e.message} />
      ))}

      <div className="actions">
        <button
          className={resolved.length ? undefined : 'btn-primary'}
          onClick={resolveAll}
          disabled={resolving || lines.length === 0 || errors.length > 0 || !publicClient}
        >
          {resolving ? 'Resolving…' : 'Resolve recipients'}
        </button>
        <span className="status">
          {lines.length} {lines.length === 1 ? 'row' : 'rows'}, total <span className="mono">{fmtUnits(total, cfg.usdcDecimals)}</span> USDC
          {!enough && <Pill tone="warn">exceeds balance</Pill>}
        </span>
      </div>

      {resolved.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>Recipient</th>
                <th className="num">Amount</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => {
                const r = resolved[i];
                if (!r) return null;
                return (
                  <tr key={i}>
                    <td className="mono">{i + 1}</td>
                    <td>
                      <code>{l.input}</code>
                    </td>
                    <td className="num">{l.amountText}</td>
                    <td>
                      {r.status === 'ok' && (
                        <>
                          <Pill tone="ok">Ready</Pill>{' '}
                          <span className="muted">
                            {r.registrant ? `${short(r.registrant)} → ` : ''}
                            <code>{short(r.metaAddress, 8)}</code>
                          </span>
                        </>
                      )}
                      {r.status === 'error' && (
                        <>
                          <Pill tone="danger">Error</Pill> <span>{r.message}</span>
                        </>
                      )}
                      {r.status === 'changed' && (
                        <>
                          <Pill tone="warn">Changed</Pill>{' '}
                          <span>
                            Meta-address differs from the one pinned earlier ({short(r.pinned, 8)} → {short(r.metaAddress, 8)}).
                          </span>
                          <button className="btn-inline" onClick={() => acceptChange(r)}>
                            Accept new
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {resolved.length > 0 && (
        <div className="actions">
          <button className="btn-primary" disabled={!allOk || !isConnected || wrongChain || !enough} onClick={proceed}>
            Review batch
          </button>
          <span className="status">Nothing is cached between runs; every Resolve reads the chain.</span>
        </div>
      )}
    </div>
  );
}
