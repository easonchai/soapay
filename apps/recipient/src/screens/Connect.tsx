import { useEffect, useState, type FormEvent } from "react";
import { useLocation } from "react-router";
import { defaultPaymasterMode } from "@soapay/sdk";
import { isAddressEqual, type Address } from "viem";
import { chainName } from "../config.js";
import { useWalletConnect } from "../hooks/useWalletConnect.js";
import { useWallet } from "../hooks/useWallet.js";
import { useServices } from "../services/ServicesProvider.js";
import { Addr, Alert, Button, Card, CardHeader, EmptyState, Field, Input, PageHeader, errorMessage } from "../ui/kit.js";
import { formatUsdc } from "../ui/format.js";
import { VerifyBadge } from "./DappRequestSheet.js";

/**
 * "Connect to a dApp" (D-61): pair with a `wc:` link, expose exactly ONE payment address per
 * session, approve or reject the connection, and manage connected dApps. Requests from connected
 * dApps open the approval sheet (DappRequestSheet) over any screen.
 */
export function Connect() {
  const wc = useWalletConnect();
  const wallet = useWallet();
  const svc = useServices();
  const location = useLocation();
  const chainId = svc.settings.chainId;
  const preset = (location.state as { address?: Address } | null)?.address;
  const [address, setAddress] = useState<Address | null>(preset ?? null);
  const [uri, setUri] = useState("");
  const [busy, setBusy] = useState<"pair" | "approve" | "reject" | string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { state } = wc;

  useEffect(() => {
    if (!address && wc.addresses.length === 1) setAddress(wc.addresses[0]!);
  }, [address, wc.addresses]);

  const run = async (tag: string, fn: () => Promise<void>) => {
    setBusy(tag);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const onPair = (e: FormEvent) => {
    e.preventDefault();
    void run("pair", async () => {
      await wc.pair(uri);
      setUri("");
    });
  };

  const gas = defaultPaymasterMode(chainId) === "sponsored" ? "gas is sponsored on this testnet" : "gas is paid in USDC from that address";
  const exposedTo = (a: Address) => state.sessions.filter((s) => s.address && isAddressEqual(s.address, a)).map((s) => s.dapp.name);
  const reused = address ? exposedTo(address) : [];

  return (
    <>
      <PageHeader
        eyebrow="dApps"
        title="Connect to a dApp"
        description={`Use one payment address with a dApp such as Aave or Morpho through WalletConnect. The dApp sees only the address you pick, and ${gas}.`}
      />

      {!wc.configured && (
        <Alert variant="warning" title="WalletConnect isn't configured">
          This build has no WalletConnect project id (VITE_WALLETCONNECT_PROJECT_ID), so it can't connect to dApps.
        </Alert>
      )}

      {wc.configured && (
        <div className="space-y-4">
          {!svc.dapp.ready && <Alert variant="warning">{svc.dapp.unavailableReason} Until then, connected dApps can only ask for signatures.</Alert>}
          {state.status === "error" && (
            <Alert variant="destructive" title="Couldn't reach WalletConnect">
              {state.error}
            </Alert>
          )}
          {error && <Alert variant="destructive">{error}</Alert>}

          <Card>
            <CardHeader title="1. Pick the address to use" description="One address per dApp. A dApp that sees two of your addresses can link them." />
            <div className="px-5 py-3">
              {wc.addresses.length === 0 ? (
                <p className="text-sm text-muted-foreground">No payment addresses yet. They appear here once a payment arrives.</p>
              ) : (
                <fieldset className="space-y-2" aria-label="Payment address">
                  {wc.addresses.map((a) => {
                    const used = exposedTo(a);
                    return (
                      <label key={a} className="flex cursor-pointer flex-wrap items-center gap-3 text-sm">
                        <input type="radio" name="wc-address" checked={!!address && isAddressEqual(address, a)} onChange={() => setAddress(a)} />
                        <Addr address={a} chars={6} />
                        <span className="tabular-nums text-muted-foreground">{formatUsdc(wallet.balances.get(a) ?? 0n)} USDC</span>
                        {used.length > 0 && <span className="text-xs text-muted-foreground">connected to {used.join(", ")}</span>}
                      </label>
                    );
                  })}
                </fieldset>
              )}
              {reused.length > 0 && (
                <p className="mt-2 text-xs text-muted-foreground">
                  This address is already connected to {reused.join(", ")}. dApps can compare what they see; pick another address to keep them apart.
                </p>
              )}
            </div>
          </Card>

          <Card>
            <CardHeader title="2. Paste the WalletConnect link" description="In the dApp choose WalletConnect, copy the link (starts with wc:) and paste it here." />
            <form onSubmit={onPair} className="flex flex-col gap-3 px-5 py-3 sm:flex-row sm:items-end" noValidate>
              <Field label="WalletConnect link" className="flex-1">
                {({ id, describedBy }) => (
                  <Input id={id} aria-describedby={describedBy} placeholder="wc:…" className="font-mono" value={uri} onChange={(e) => setUri(e.target.value)} autoComplete="off" spellCheck={false} />
                )}
              </Field>
              <Button type="submit" loading={busy === "pair" || state.status === "starting"} disabled={!uri.trim()}>
                Connect
              </Button>
            </form>
          </Card>

          {state.proposal && (
            <Card aria-labelledby="wc-proposal">
              <CardHeader id="wc-proposal" title={`${state.proposal.dapp.name} wants to connect`} description={state.proposal.dapp.url} action={<VerifyBadge validation={state.proposal.validation} isScam={state.proposal.isScam} />} />
              <div className="space-y-3 px-5 py-3 text-sm" data-testid="wc-proposal">
                {state.proposal.dapp.description && <p className="text-muted-foreground">{state.proposal.dapp.description}</p>}
                {state.proposal.error ? (
                  <Alert variant="warning" title="Can't connect">
                    {state.proposal.error}
                  </Alert>
                ) : (
                  <p>
                    It will see {address ? <Addr address={address} chars={6} /> : "the address you pick above"} on {chainName(chainId)}, and nothing else. Each transaction
                    or signature it asks for opens an approval sheet here.
                  </p>
                )}
                {state.proposal.isScam && <Alert variant="destructive">WalletConnect flags this site as a scam.</Alert>}
                <div className="flex flex-wrap justify-end gap-2">
                  <Button variant="outline" loading={busy === "reject"} onClick={() => void run("reject", () => wc.rejectProposal())}>
                    Reject
                  </Button>
                  <Button
                    loading={busy === "approve"}
                    disabled={!address || !!state.proposal.error || state.proposal.isScam}
                    onClick={() => address && void run("approve", () => wc.approveProposal(address))}
                    data-testid="wc-approve"
                  >
                    Connect this address
                  </Button>
                </div>
              </div>
            </Card>
          )}

          <Card>
            <CardHeader title="Connected dApps" />
            {state.sessions.length === 0 ? (
              <div className="p-5">
                <EmptyState title="No dApps connected">{state.status === "idle" ? "Connections from an earlier visit show up once you connect." : null}</EmptyState>
              </div>
            ) : (
              <ul className="divide-y" data-testid="wc-sessions">
                {state.sessions.map((s) => (
                  <li key={s.topic} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-sm">
                    <span className="min-w-0 space-y-0.5">
                      <span className="block font-medium">{s.dapp.name}</span>
                      <span className="block break-all text-xs text-muted-foreground">{s.dapp.url}</span>
                    </span>
                    <span className="flex items-center gap-3">
                      {s.address ? <Addr address={s.address} /> : <span className="text-xs text-destructive">invalid session</span>}
                      {s.chainId !== null && s.chainId !== chainId && <span className="text-xs text-muted-foreground">other network</span>}
                      <Button size="sm" variant="outline" loading={busy === s.topic} onClick={() => void run(s.topic, () => wc.disconnect(s.topic))}>
                        Disconnect
                      </Button>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <p className="text-xs text-muted-foreground">
            Addresses hold no ETH, so requests that send ETH are refused. On Base Sepolia the gas sponsor only covers contracts the Soapay API allows.
          </p>
        </div>
      )}
    </>
  );
}
