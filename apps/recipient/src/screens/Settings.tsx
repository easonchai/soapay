import { useId, useState, type FormEvent, type ReactNode } from "react";
import { ANNOUNCER_ADDRESS, REGISTRY_ADDRESS, getChainConfig } from "@soapay/sdk";
import { Collapse, Copy, toast } from "@soapay/ui";
import { chainName } from "../config.js";
import { useSettings } from "../hooks/useSettings.js";
import { useServices } from "../services/ServicesProvider.js";
import { Addr, Alert, Button, Card, CardHeader, Checkbox, Field, Input, PageHeader, errorMessage } from "../ui/kit.js";
import type { Settings as S } from "../vault/types.js";
import { LockSetting } from "./LockSetting.js";
import { BackupSetting } from "./BackupSetting.js";
import { useBackupSync } from "../vault/BackupSync.js";

type TextKey = "apiUrl" | "rpcUrl" | "bundlerUrl" | "l1RpcUrl";

/** `.rows-grid .row .v input` stretches inputs to the row; a checkbox inside a row keeps its own size. */
const CHECK = "[&_input]:w-4!";

/** CK's Settings layout (Network facts, Receiving, Reset) with our items: known payers, editable network, backups. */
export function Settings() {
  const st = useSettings();
  const svc = useServices();
  const backup = useBackupSync();
  const [draft, setDraft] = useState<S>(st.settings);
  const [saved, setSaved] = useState(false);
  const [payer, setPayer] = useState({ address: "", name: "" });
  const [error, setError] = useState<string | null>(null);
  const [wipe, setWipe] = useState(false);
  const [keysAck, setKeysAck] = useState(false);
  const windowId = useId();
  const chainId = st.settings.chainId;
  const usdc = (() => {
    try {
      return getChainConfig(chainId).usdc;
    } catch {
      return undefined;
    }
  })();

  const text = (k: TextKey, label: string, note?: ReactNode) => (
    <InputRow label={label} note={note} value={draft[k]} onChange={(value) => setDraft({ ...draft, [k]: value })} />
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
    toast.success("Saved");
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

      <form onSubmit={saveNetwork}>
        <Card reveal={0}>
          <CardHeader title="Network" />
          <div className="rows-grid">
            <Row k="Chain">
              {chainName(chainId)} ({chainId})
            </Row>
            {text("apiUrl", "Soapay API URL", "Registration relayer, names, invites, announcement index, gas sponsorship (testnet).")}
            {text("rpcUrl", "Base RPC URL", "Empty = the chain's public RPC.")}
            {text(
              "bundlerUrl",
              "Bundler URL",
              <>
                Needed to send (e.g. a Pimlico URL).{!st.settings.bundlerUrl && " Not set: Send is off."}
              </>,
            )}
            {text("l1RpcUrl", "Ethereum Sepolia RPC URL", "For the ENS record update when rotating keys.")}
            <Row k="Announcer">
              <code>{ANNOUNCER_ADDRESS}</code>
            </Row>
            <Row k="Registry">
              <code>{REGISTRY_ADDRESS}</code>
            </Row>
            {usdc && (
              <Row k="USDC">
                <code>{usdc}</code>
              </Row>
            )}
            <Row k="StealthDisperse">
              {svc.stealthDisperse.length ? (
                svc.stealthDisperse.map((a) => (
                  <code key={a} className="block">
                    {a}
                  </code>
                ))
              ) : (
                <span className="muted">None configured: payers are read from the announcing account.</span>
              )}
            </Row>
            <Row k="Announcements">
              <div className={CHECK}>
                <Checkbox
                  checked={draft.useRpcAnnouncements}
                  onChange={(v) => setDraft({ ...draft, useRpcAnnouncements: v })}
                  label="Read announcements over RPC instead of the Soapay API"
                  description="Slower, but doesn't depend on our indexer."
                />
              </div>
            </Row>
            <div className="row">
              <label className="k" htmlFor={windowId}>
                Spend window (hours)
              </label>
              <div className="v">
                <div className="actions">
                  <Input id={windowId} aria-label="Window minimum (hours)" inputMode="decimal" className="w-20" style={{ width: "5rem" }} value={String(draft.queueWindowHours[0])} onChange={(e) => setDraft({ ...draft, queueWindowHours: [Number(e.target.value) || 0, draft.queueWindowHours[1]] })} />
                  <span className="muted">to</span>
                  <Input aria-label="Window maximum (hours)" inputMode="decimal" className="w-20" style={{ width: "5rem" }} value={String(draft.queueWindowHours[1])} onChange={(e) => setDraft({ ...draft, queueWindowHours: [draft.queueWindowHours[0], Number(e.target.value) || 0] })} />
                </div>
                <span className="note">Queued sends and exit deposits go out one address per random window between these bounds.</span>
              </div>
            </div>
            <div className="row">
              <span className="k" />
              <div className="v">{svc.mock && <span className="note">Mock mode: these values are ignored until you run without VITE_MOCK_API.</span>}</div>
              <div className="a">
                <Button type="submit">{saved ? "Saved" : "Save"}</Button>
              </div>
            </div>
          </div>
        </Card>
      </form>

      <Card reveal={0.06}>
        <CardHeader title="Known payers" description="Payments announced by anyone else are flagged as unknown payer." />
        <div className="rows-grid">
          {st.settings.knownPayers.map((p) => (
            <div className="row" key={p.address}>
              <span className="k">{p.name}</span>
              <div className="v">
                <code className="break-all">{p.address}</code>
              </div>
              <div className="a">
                <button type="button" className="btn-text btn-inline btn-danger" onClick={() => void st.removePayer(p.address)} aria-label={`Remove ${p.name}`}>
                  Remove
                </button>
              </div>
            </div>
          ))}
          <form onSubmit={addPayer} className="row">
            <span className="k">Add a payer</span>
            <div className="v">
              <div className="grid gap-2 sm:grid-cols-[1fr_10rem]">
                <Field label="Payer address">
                  {({ id }) => <Input id={id} className="font-mono" placeholder="0x…" value={payer.address} onChange={(e) => setPayer({ ...payer, address: e.target.value })} />}
                </Field>
                <Field label="Name">{({ id }) => <Input id={id} value={payer.name} onChange={(e) => setPayer({ ...payer, name: e.target.value })} />}</Field>
              </div>
              {error && <Alert variant="destructive">{error}</Alert>}
            </div>
            <div className="a" style={{ alignSelf: "end" }}>
              <Button type="submit" variant="outline">
                Add
              </Button>
            </div>
          </form>
        </div>
      </Card>

      <Card reveal={0.12}>
        <CardHeader title="Receiving" />
        <div className="rows-grid">
          <div className="row">
            <span className="k">Meta-address</span>
            <div className="v">
              <code className="break-all">{st.keys.metaAddressURI}</code>
            </div>
            <div className="a">
              <Copy value={st.keys.metaAddressURI} />
            </div>
          </div>
          <Row k="Registrant" note="A throwaway address that stands in for you on-chain. Never send it funds from your own wallet.">
            <code className="break-all">{st.keys.registrantAddress}</code>
          </Row>
          {st.keySource.kind === "wallet-signature" ? (
            <Row k="Keys from" note="Recovery: sign the Soapay message again with this same wallet. Key rotation isn't available for these keys.">
              <span>
                Wallet signature by <Addr address={st.keySource.wallet} />
              </span>
            </Row>
          ) : (
            <Row k="Keys from" note="Your phrase recovers every key and every payment. It is never shown again.">
              Recovery phrase
            </Row>
          )}
        </div>
      </Card>

      <Card reveal={0.18}>
        <CardHeader title="This device" />
        <div className="rows-grid">
          <Row k="Lock">
            <LockSetting />
          </Row>
          {backup && (
            <Row k="Passkey backup">
              <BackupSetting />
            </Row>
          )}
          <div className="row">
            <span className="k">Backup</span>
            <div className="v">
              <span className="note">The encrypted vault as a file. Safe to store anywhere: useless without your passphrase or passkey.</span>
            </div>
            <div className="a">
              <Button variant="outline" onClick={() => void st.exportBackup()}>
                Download encrypted backup
              </Button>
            </div>
          </div>
          <div className="row">
            <span className="k">Session</span>
            <div className="v">
              <span className="note">Locks this browser now. Unlock again with your passkey or passphrase.</span>
            </div>
            <div className="a">
              <Button variant="outline" onClick={st.lock}>
                Lock now
              </Button>
            </div>
          </div>
          <div className="row">
            <span className="k">Danger</span>
            <div className="v">
              <span className="note">Removes the encrypted vault and everything it keeps from this browser.</span>
              <Collapse open={wipe}>
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
              </Collapse>
            </div>
            {!wipe && (
              <div className="a">
                <Button variant="ghost" className="btn-danger" onClick={() => setWipe(true)}>
                  Delete vault from this browser
                </Button>
              </div>
            )}
          </div>
        </div>
      </Card>

      <Card reveal={0.24}>
        <CardHeader title="Advanced recovery" />
        <div className="rows-grid">
          <div className="row">
            <span className="k">Private keys</span>
            <div className="v">
              <Alert variant="warning" title="Exports your private keys in plain text">
                Anyone with this file can spend every payment sent to you, now and later. You don't need it to use Soapay: Send and Exit spend
                in-app without exposing a key. Use it only to move to other software, then delete the file.
              </Alert>
              <div className={CHECK}>
                <Checkbox checked={keysAck} onChange={setKeysAck} tone="destructive" label="I understand this file can spend all my payments" />
              </div>
            </div>
            <div className="a">
              <Button variant="destructive" disabled={!keysAck} onClick={st.exportRawKeys}>
                Export private keys
              </Button>
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}

/** Label · value (+ note) row without an action. */
function Row({ k, note, children }: { k: string; note?: ReactNode; children: ReactNode }) {
  return (
    <div className="row">
      <span className="k">{k}</span>
      <div className="v">
        {children}
        {note && <span className="note">{note}</span>}
      </div>
    </div>
  );
}

/** Label · text input (+ note) row; the label is the input's accessible name. */
function InputRow({ label, note, value, onChange }: { label: string; note?: ReactNode; value: string; onChange: (value: string) => void }) {
  const id = useId();
  const noteId = note ? `${id}-note` : undefined;
  return (
    <div className="row">
      <label className="k" htmlFor={id}>
        {label}
      </label>
      <div className="v">
        <Input id={id} className="font-mono" value={value} onChange={(e) => onChange(e.target.value)} aria-describedby={noteId} />
        {note && (
          <span className="note" id={noteId}>
            {note}
          </span>
        )}
      </div>
    </div>
  );
}
