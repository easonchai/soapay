import { useState, type FormEvent } from "react";
import { ANNOUNCER_ADDRESS, REGISTRY_ADDRESS, getChainConfig } from "@soapay/sdk";
import { Copy } from "@soapay/ui";
import { chainName } from "../config.js";
import { useSettings } from "../hooks/useSettings.js";
import { useServices } from "../services/ServicesProvider.js";
import { Addr, Alert, Button, Checkbox, Field, Input, PageHeader, errorMessage } from "../ui/kit.js";
import type { Settings as S } from "../vault/types.js";
import { LockSetting } from "./LockSetting.js";
import { BackupSetting } from "./BackupSetting.js";

/** CK's Settings layout (Network facts, Receiving, Reset) with our items: known payers, editable network, backups. */
export function Settings() {
  const st = useSettings();
  const svc = useServices();
  const [draft, setDraft] = useState<S>(st.settings);
  const [saved, setSaved] = useState(false);
  const [payer, setPayer] = useState({ address: "", name: "" });
  const [error, setError] = useState<string | null>(null);
  const [wipe, setWipe] = useState(false);
  const [keysAck, setKeysAck] = useState(false);
  const chainId = st.settings.chainId;
  const usdc = (() => {
    try {
      return getChainConfig(chainId).usdc;
    } catch {
      return undefined;
    }
  })();

  const text = (k: "apiUrl" | "rpcUrl" | "bundlerUrl" | "l1RpcUrl", label: string, hint?: string) => (
    <Field label={label} hint={hint}>
      {({ id }) => <Input id={id} className="font-mono" value={draft[k]} onChange={(e) => setDraft({ ...draft, [k]: e.target.value })} />}
    </Field>
  );

  const saveNetwork = async (e: FormEvent) => {
    e.preventDefault();
    await st.save({
      apiUrl: draft.apiUrl.trim(),
      rpcUrl: draft.rpcUrl.trim(),
      bundlerUrl: draft.bundlerUrl.trim(),
      l1RpcUrl: draft.l1RpcUrl.trim(),
      useRpcAnnouncements: draft.useRpcAnnouncements,
      queueWindowHours: [Math.max(0, draft.queueWindowHours[0]), Math.max(draft.queueWindowHours[0], draft.queueWindowHours[1])],
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

  const addPayer = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await st.addPayer(payer.address, payer.name);
      setPayer({ address: "", name: "" });
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  return (
    <div className="onb stack-lg">
      <PageHeader eyebrow="This browser" title="Settings" description="Where this app points, and what it keeps (encrypted) in this browser." />

      <section className="stack-sm">
        <h2>Network</h2>
        <div className="card">
          <dl className="facts">
            <dt>Chain</dt>
            <dd>
              {chainName(chainId)} ({chainId})
            </dd>
            <dt>Soapay API</dt>
            <dd>
              <code>{st.settings.apiUrl}</code>
              <span className="note">Registration relayer, names, invites, announcement index, gas sponsorship (testnet).</span>
            </dd>
            <dt>Announcer</dt>
            <dd>
              <code>{ANNOUNCER_ADDRESS}</code>
            </dd>
            <dt>Registry</dt>
            <dd>
              <code>{REGISTRY_ADDRESS}</code>
            </dd>
            {usdc && (
              <>
                <dt>USDC</dt>
                <dd>
                  <code>{usdc}</code>
                </dd>
              </>
            )}
            <dt>StealthDisperse</dt>
            <dd>
              {svc.stealthDisperse.length ? (
                svc.stealthDisperse.map((a) => <code key={a} className="block">{a}</code>)
              ) : (
                <span className="muted">None configured: payers are read from the announcing account.</span>
              )}
            </dd>
            <dt>Bundler</dt>
            <dd>{st.settings.bundlerUrl ? <code>{st.settings.bundlerUrl}</code> : <span className="muted">Not set: Send is off.</span>}</dd>
          </dl>
        </div>
        {svc.mock && <Alert variant="info">Mock mode: the values below are ignored until you run without VITE_MOCK_API.</Alert>}
        <form onSubmit={saveNetwork} className="card stack">
          {text("apiUrl", "Soapay API URL")}
          {text("rpcUrl", "Base RPC URL", "Empty = the chain's public RPC.")}
          {text("bundlerUrl", "Bundler URL", "Needed to send (e.g. a Pimlico URL).")}
          {text("l1RpcUrl", "Ethereum Sepolia RPC URL", "For the ENS record update when rotating keys.")}
          <Checkbox
            checked={draft.useRpcAnnouncements}
            onChange={(v) => setDraft({ ...draft, useRpcAnnouncements: v })}
            label="Read announcements over RPC instead of the Soapay API"
            description="Slower, but doesn't depend on our indexer."
          />
          <Field label="Spend window (hours)" hint="Queued sends and exit deposits go out one address per random window between these bounds.">
            {({ id }) => (
              <div className="actions">
                <Input id={id} aria-label="Window minimum (hours)" inputMode="decimal" className="w-20" value={String(draft.queueWindowHours[0])} onChange={(e) => setDraft({ ...draft, queueWindowHours: [Number(e.target.value) || 0, draft.queueWindowHours[1]] })} />
                <span className="muted">to</span>
                <Input aria-label="Window maximum (hours)" inputMode="decimal" className="w-20" value={String(draft.queueWindowHours[1])} onChange={(e) => setDraft({ ...draft, queueWindowHours: [draft.queueWindowHours[0], Number(e.target.value) || 0] })} />
              </div>
            )}
          </Field>
          <div className="actions">
            <Button type="submit">{saved ? "Saved" : "Save"}</Button>
          </div>
        </form>
      </section>

      <section className="stack-sm">
        <h2>Known payers</h2>
        <p className="muted">Payments announced by anyone else are flagged as unknown payer.</p>
        <div className="card stack">
          {st.settings.knownPayers.length > 0 && (
            <dl className="facts">
              {st.settings.knownPayers.map((p) => (
                <FactRow key={p.address} k={p.name}>
                  <Addr address={p.address} />
                  <button type="button" className="btn-text btn-inline btn-danger" onClick={() => void st.removePayer(p.address)} aria-label={`Remove ${p.name}`}>
                    Remove
                  </button>
                </FactRow>
              ))}
            </dl>
          )}
          <form onSubmit={addPayer} className="grid gap-2 sm:grid-cols-[1fr_10rem_auto] sm:items-end">
            <Field label="Payer address">
              {({ id }) => <Input id={id} className="font-mono" placeholder="0x…" value={payer.address} onChange={(e) => setPayer({ ...payer, address: e.target.value })} />}
            </Field>
            <Field label="Name">{({ id }) => <Input id={id} value={payer.name} onChange={(e) => setPayer({ ...payer, name: e.target.value })} />}</Field>
            <Button type="submit" variant="outline">
              Add
            </Button>
          </form>
          {error && <Alert variant="destructive">{error}</Alert>}
        </div>
      </section>

      <section className="stack-sm">
        <h2>Receiving</h2>
        <div className="card">
          <dl className="facts">
            <dt>Meta-address</dt>
            <dd>
              <code>{st.keys.metaAddressURI}</code>
              <Copy value={st.keys.metaAddressURI} />
            </dd>
            <dt>Registrant</dt>
            <dd>
              <code>{st.keys.registrantAddress}</code>
              <span className="note">A throwaway address that stands in for you on-chain. Never send it funds from your own wallet.</span>
            </dd>
            <dt>Keys from</dt>
            <dd>
              {st.keySource.kind === "wallet-signature" ? (
                <>
                  Wallet signature by <Addr address={st.keySource.wallet} />
                  <span className="note">Recovery: sign the Soapay message again with this same wallet. Key rotation isn't available for these keys.</span>
                </>
              ) : (
                <>
                  Recovery phrase
                  <span className="note">Your phrase recovers every key and every payment. It is never shown again.</span>
                </>
              )}
            </dd>
          </dl>
        </div>
      </section>

      <section className="stack-sm">
        <h2>This device</h2>
        <LockSetting />
        <BackupSetting />
        <div className="actions">
          <Button variant="outline" onClick={() => void st.exportBackup()}>
            Download encrypted backup
          </Button>
          <Button variant="outline" onClick={st.lock}>
            Lock now
          </Button>
          {!wipe && (
            <Button variant="ghost" className="btn-danger" onClick={() => setWipe(true)}>
              Delete vault from this browser
            </Button>
          )}
        </div>
        {wipe && (
          <Alert
            variant="destructive"
            title="Delete this vault?"
            action={
              <div className="flex gap-2">
                <Button size="sm" variant="destructive" onClick={() => void st.wipe()}>
                  Delete
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setWipe(false)}>
                  Cancel
                </Button>
              </div>
            }
          >
            {st.keySource.kind === "wallet-signature"
              ? "Only signing again with the same wallet can bring the keys back."
              : "Only your recovery phrase can bring it back."}
          </Alert>
        )}
      </section>

      <section className="stack-sm">
        <h2>Advanced recovery</h2>
        <Alert variant="warning" title="Exports your private keys in plain text">
          Anyone with this file can spend every payment sent to you, now and later. You don't need it to use Soapay: Send and Exit spend
          in-app without exposing a key. Use it only to move to other software, then delete the file.
        </Alert>
        <Checkbox checked={keysAck} onChange={setKeysAck} tone="destructive" label="I understand this file can spend all my payments" />
        <div className="actions">
          <Button variant="destructive" disabled={!keysAck} onClick={st.exportRawKeys}>
            Export private keys
          </Button>
        </div>
      </section>
    </div>
  );
}

function FactRow({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <>
      <dt>{k}</dt>
      <dd>{children}</dd>
    </>
  );
}
