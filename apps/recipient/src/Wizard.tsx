import { useMemo, useState } from 'react';
import { useAccount, useConnect, usePublicClient } from 'wagmi';
import { createPublicClient, http, type Hex } from 'viem';
import { mainnet } from 'viem/chains';
import { normalize } from 'viem/ens';
import { chainConfig } from './config.js';
import { useKeys } from './KeysProvider.js';
import { Copy } from '@soapay/ui';
import { ErrorLine } from '@soapay/ui';
import { Steps } from '@soapay/ui';
import { Pill } from '@soapay/ui';
import { signRegisterOnBehalf, readNonce, readRegisteredMeta, submitToRelay, findRegistrationBlock, createRecipientStore, browserStorage, explorerTx, short } from '@soapay/sdk';

type Step = 1 | 2 | 3 | 4;
const STEP_LABELS = ['Keys', 'Register', 'Name', 'Share'];
const firstLine = (e: unknown) => (e as Error).message.split('\n')[0];

export function Wizard({ onDone }: { onDone: () => void }) {
  const cfg = chainConfig;
  const { address, isConnected } = useAccount();
  const { connect, connectors } = useConnect();
  const publicClient = usePublicClient();
  const { keys, unlock, busy, error: keyError } = useKeys();
  const store = useMemo(() => createRecipientStore(browserStorage(), cfg.chainId), [cfg.chainId]);

  const [step, setStep] = useState<Step>(1);
  const [err, setErr] = useState<string>();
  const [regTx, setRegTx] = useState<Hex>();
  const [regBlock, setRegBlock] = useState<bigint>();
  const [registered, setRegistered] = useState(false);
  const [registering, setRegistering] = useState(false);
  const [blockLookup, setBlockLookup] = useState<'idle' | 'searching' | 'failed'>('idle');
  const [manualBlock, setManualBlock] = useState('');
  const [name, setName] = useState('');
  const [nameStatus, setNameStatus] = useState<string>();
  const [linkedName, setLinkedName] = useState<string>();

  function exportBackup() {
    if (!keys) return;
    const blob = new Blob(
      [
        JSON.stringify(
          {
            warning: 'Private keys. Anyone with this file can spend your payments.',
            chainId: cfg.chainId,
            registrant: keys.registrant,
            stealthMetaAddress: keys.stealthMetaAddress,
            spendingPrivateKey: keys.spendingPrivateKey,
            viewingPrivateKey: keys.viewingPrivateKey,
            registrantPrivateKey: keys.registrantPrivateKey,
          },
          null,
          2,
        ),
      ],
      { type: 'application/json' },
    );
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `soapay-keys-${short(keys.registrant)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  async function checkRegistered(): Promise<boolean> {
    if (!keys || !publicClient) return false;
    try {
      const meta = await readRegisteredMeta(publicClient, cfg.registry, keys.registrant);
      const ok = meta.toLowerCase() === keys.stealthMetaAddress.toLowerCase();
      setRegistered(ok);
      if (ok && regBlock === undefined) void recoverBlock();
      return ok;
    } catch (e) {
      setErr(firstLine(e));
      return false;
    }
  }

  /** Registered in another browser: find the block once so the scanner does not start at genesis. */
  async function recoverBlock() {
    if (!keys || !publicClient || blockLookup === 'searching') return;
    setBlockLookup('searching');
    try {
      const b = await findRegistrationBlock(publicClient, cfg.registry, keys.registrant, cfg.scanStartBlock);
      if (b === null) {
        setBlockLookup('failed');
        return;
      }
      setRegBlock(b);
      setBlockLookup('idle');
    } catch {
      setBlockLookup('failed');
    }
  }

  async function register() {
    if (!keys || !publicClient) return;
    setErr(undefined);
    setRegistering(true);
    try {
      if (await checkRegistered()) return;
      const nonce = await readNonce(publicClient, cfg.registry, keys.registrant);
      const req = await signRegisterOnBehalf({ keys, chainId: cfg.chainId, registry: cfg.registry, nonce });
      const tx = await submitToRelay(cfg.relayUrl, req);
      setRegTx(tx);
      const receipt = await publicClient.waitForTransactionReceipt({ hash: tx });
      setRegBlock(receipt.blockNumber);
      if (!(await checkRegistered())) {
        throw new Error('Transaction confirmed but the registry does not show the meta-address');
      }
    } catch (e) {
      setErr(firstLine(e));
    } finally {
      setRegistering(false);
    }
  }

  async function checkName() {
    setNameStatus(undefined);
    setErr(undefined);
    try {
      const n = normalize(name.trim());
      const l1 = createPublicClient({ chain: mainnet, transport: http(cfg.mainnetRpcUrl) });
      const addr = await l1.getEnsAddress({ name: n });
      if (!addr) setNameStatus(`${n} has no address record yet.`);
      else if (keys && addr.toLowerCase() === keys.registrant.toLowerCase()) {
        setNameStatus(`${n} points to your registrant. Linked.`);
        setLinkedName(n);
      } else {
        setNameStatus(`${n} points to ${short(addr)}, not your registrant ${keys ? short(keys.registrant) : ''}.`);
      }
    } catch (e) {
      setErr(firstLine(e));
    }
  }

  function finish() {
    if (!keys) return;
    store.set({
      registrant: keys.registrant,
      stealthMetaAddress: keys.stealthMetaAddress,
      chainId: cfg.chainId,
      ledger: [],
      ...(regBlock !== undefined ? { registrationBlock: String(regBlock) } : {}),
      ...(linkedName ? { ensName: linkedName } : {}),
    });
    onDone();
  }

  return (
    <div>
      <Steps current={step} labels={STEP_LABELS} />
      <ErrorLine error={err ?? keyError} />

      {step === 1 && (
        <section>
          <h1>Create your keys</h1>
          <p className="lead">
            Your wallet signs one message. The keys come from that signature and stay in this browser tab; nothing
            is sent on-chain.
          </p>

          {!keys && (
            <div className="actions">
              {!isConnected ? (
                <button className="btn-primary" onClick={() => { const c = connectors[0]; if (c) connect({ connector: c }); }} disabled={!connectors[0]}>
                  {connectors[0] ? 'Connect wallet' : 'No wallet extension found'}
                </button>
              ) : (
                <>
                  <button className="btn-primary" disabled={busy} onClick={() => unlock().catch(() => {})}>
                    {busy ? 'Waiting for signature…' : 'Sign to create keys'}
                  </button>
                  <span className="status">Connected as {address && short(address)}</span>
                </>
              )}
            </div>
          )}

          {keys && (
            <>
              <div className="share">
                <div className="label">Your meta-address</div>
                <div className="value">{keys.stealthMetaAddressURI}</div>
                <Copy value={keys.stealthMetaAddressURI} />
              </div>
              <div className="card">
                <dl className="facts">
                  <dt>Registrant</dt>
                  <dd>
                    <code>{keys.registrant}</code>
                    <Copy value={keys.registrant} />
                    <span className="note">A throwaway address that stands in for you on-chain. Never send it funds from your own wallet.</span>
                  </dd>
                  <dt>Spending key</dt>
                  <dd>
                    <code>{keys.spendingPublicKey}</code>
                  </dd>
                  <dt>Viewing key</dt>
                  <dd>
                    <code>{keys.viewingPublicKey}</code>
                  </dd>
                </dl>
              </div>
              <div className="actions">
                <button className="btn-primary" onClick={() => setStep(2)}>
                  Continue
                </button>
                <button className="btn-text" onClick={exportBackup}>
                  Export backup file
                </button>
                <span className="status">If you lose this wallet and the backup, the payments are gone.</span>
              </div>
            </>
          )}
        </section>
      )}

      {step === 2 && keys && (
        <section>
          <h1>Register on {cfg.chain.name}</h1>
          <p className="lead">
            Publishes your meta-address in the ERC-6538 registry under the registrant address. A relayer pays the
            gas, so your wallet stays out of it.
          </p>
          <div className="card">
            <dl className="facts">
              <dt>Status</dt>
              <dd>
                {registered ? (
                  <Pill tone="ok">Registered{regBlock ? ` at block ${regBlock}` : ''}</Pill>
                ) : (
                  <Pill>Not registered</Pill>
                )}
                {regTx && (
                  <span className="note">
                    Transaction{' '}
                    <a href={explorerTx(cfg, regTx)} target="_blank" rel="noreferrer">
                      {short(regTx)}
                    </a>
                  </span>
                )}
              </dd>
              <dt>Registry</dt>
              <dd>
                <code>{cfg.registry}</code>
              </dd>
            </dl>
          </div>
          {registered && regBlock === undefined && blockLookup === 'searching' && (
            <p className="muted">Looking up the registration block…</p>
          )}
          {registered && regBlock === undefined && blockLookup === 'failed' && (
            <div className="notice notice-warn">
              Could not find the registration block from this RPC. Enter it from the explorer so scans start there,
              or leave it blank to scan from the contract deployment block, which is slow.
              <div className="actions">
                <input value={manualBlock} onChange={(e) => setManualBlock(e.target.value)} placeholder="Block number" />
                <button
                  onClick={() => {
                    if (/^\d+$/.test(manualBlock.trim())) setRegBlock(BigInt(manualBlock.trim()));
                  }}
                >
                  Use this block
                </button>
              </div>
            </div>
          )}
          <div className="actions">
            {registered ? (
              <button className="btn-primary" onClick={() => setStep(3)}>
                Continue
              </button>
            ) : (
              <button className="btn-primary" onClick={register} disabled={registering}>
                {registering ? 'Registering…' : 'Register'}
              </button>
            )}
            <button className="btn-text" onClick={checkRegistered} disabled={registering}>
              Check again
            </button>
          </div>
        </section>
      )}

      {step === 3 && keys && (
        <section>
          <h1>Link a name (optional)</h1>
          <p className="lead">
            If you own an ENS name or a Basename, point its address record at your registrant from the wallet that
            owns the name, then check it here. Senders can then pay the name instead of the address.
          </p>
          <div className="card">
            <div className="actions" style={{ margin: 0 }}>
              <input placeholder="alice.eth or alice.base.eth" value={name} onChange={(e) => setName(e.target.value)} />
              <button onClick={checkName} disabled={!name.trim()}>
                Check name
              </button>
            </div>
            {nameStatus && <p style={{ marginTop: 12 }}>{nameStatus}</p>}
            <p className="muted" style={{ marginTop: 12 }}>
              Set the record to <code>{keys.registrant}</code> in the{' '}
              <a href="https://app.ens.domains" target="_blank" rel="noreferrer">
                ENS manager
              </a>{' '}
              or{' '}
              <a href="https://www.base.org/names" target="_blank" rel="noreferrer">
                Basenames
              </a>
              .
            </p>
          </div>
          <div className="actions">
            <button className="btn-primary" onClick={() => setStep(4)}>
              {linkedName ? 'Continue' : 'Skip for now'}
            </button>
          </div>
        </section>
      )}

      {step === 4 && keys && (
        <section>
          <h1>Share your address</h1>
          <p className="lead">Give whoever pays you any one of these. Each payment lands on a fresh address only you can open.</p>
          <div className="share">
            <div className="label">Meta-address</div>
            <div className="value">{keys.stealthMetaAddressURI}</div>
            <Copy value={keys.stealthMetaAddressURI} />
          </div>
          <div className="card">
            <dl className="facts">
              {linkedName && (
                <>
                  <dt>Name</dt>
                  <dd>
                    {linkedName}
                    <Copy value={linkedName} />
                  </dd>
                </>
              )}
              <dt>Registrant address</dt>
              <dd>
                <code>{keys.registrant}</code>
                <Copy value={keys.registrant} />
              </dd>
            </dl>
          </div>
          <div className="actions">
            <button className="btn-primary" onClick={finish}>
              Open dashboard
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
