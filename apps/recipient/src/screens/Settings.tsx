import { useState, type FormEvent } from "react";
import { Trash2 } from "lucide-react";
import { useSettings } from "../hooks/useSettings.js";
import { useServices } from "../services/ServicesProvider.js";
import { Addr, Alert, Button, Card, CardHeader, Checkbox, CopyButton, Field, Input, PageHeader, errorMessage } from "../ui/kit.js";
import type { Settings as S } from "../vault/types.js";

export function Settings() {
  const st = useSettings();
  const svc = useServices();
  const [draft, setDraft] = useState<S>(st.settings);
  const [saved, setSaved] = useState(false);
  const [payer, setPayer] = useState({ address: "", name: "" });
  const [error, setError] = useState<string | null>(null);
  const [wipe, setWipe] = useState(false);

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
      swapViaApi: draft.swapViaApi,
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
    <>
      <PageHeader title="Settings" description="Stored inside your encrypted vault on this device." />
      <div className="space-y-4">
        <Card>
          <CardHeader title="Known payers" description="Payments announced by anyone else are flagged as unknown payer." />
          <div className="space-y-3 px-4 py-3">
            <ul className="space-y-1 text-sm">
              {st.settings.knownPayers.map((p) => (
                <li key={p.address} className="flex items-center justify-between gap-2">
                  <span>
                    {p.name} · <Addr address={p.address} />
                  </span>
                  <Button variant="ghost" size="sm" onClick={() => void st.removePayer(p.address)} aria-label={`Remove ${p.name}`}>
                    <Trash2 className="size-4" aria-hidden />
                  </Button>
                </li>
              ))}
            </ul>
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
        </Card>

        <Card>
          <CardHeader title="Network" description={svc.mock ? "Mock mode: these are ignored until you run without VITE_MOCK_API." : undefined} />
          <form onSubmit={saveNetwork} className="space-y-3 px-4 py-3">
            {text("apiUrl", "Soapay API URL")}
            {text("rpcUrl", "Base RPC URL", "Empty = the chain's public RPC.")}
            {text("bundlerUrl", "Bundler URL", "Needed to send and convert (e.g. a Pimlico URL).")}
            {text("l1RpcUrl", "Ethereum Sepolia RPC URL", "For the ENS record update when rotating keys.")}
            <Checkbox
              checked={draft.useRpcAnnouncements}
              onChange={(v) => setDraft({ ...draft, useRpcAnnouncements: v })}
              label="Read announcements over RPC instead of the Soapay API"
              description="Slower, but doesn't depend on our indexer."
            />
            <Checkbox
              checked={draft.swapViaApi}
              onChange={(v) => setDraft({ ...draft, swapViaApi: v })}
              label="Convert through the Soapay API's Uniswap proxy"
              description="Better routes via the Uniswap Trading API. Off = quote directly from the Universal Router."
            />
            <Button type="submit">{saved ? "Saved" : "Save"}</Button>
          </form>
        </Card>

        <Card>
          <CardHeader title="This device" />
          <div className="space-y-3 px-4 py-3 text-sm">
            <p className="text-muted-foreground">Your meta-address:</p>
            <p className="font-mono text-xs break-all">{st.keys.metaAddressURI}</p>
            <div className="flex flex-wrap gap-2">
              <CopyButton value={st.keys.metaAddressURI} label="Copy meta-address" />
              <Button variant="outline" size="sm" onClick={() => void st.exportBackup()}>
                Download encrypted backup
              </Button>
              <Button variant="outline" size="sm" onClick={st.lock}>
                Lock now
              </Button>
            </div>
            {wipe ? (
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
                Only your recovery phrase can bring it back.
              </Alert>
            ) : (
              <Button variant="ghost" size="sm" className="text-destructive" onClick={() => setWipe(true)}>
                Delete vault from this browser
              </Button>
            )}
          </div>
        </Card>
      </div>
    </>
  );
}
