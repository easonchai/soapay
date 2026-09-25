// The only file that knows both the hooks and the pages: each container calls a hook
// and hands its result to a props-only page. Swap the pages (or this file) to plug in
// another UI; see README "How to plug in another UI".
import { useState, type ReactNode } from "react";
import { CHAINS } from "@soapay/sdk";
import { txUrl } from "./config.js";
import { useStore } from "./hooks/store.js";
import { usePayPath, useWallet } from "./hooks/usePayPath.js";
import { usePayRun } from "./hooks/usePayRun.js";
import { useRoster } from "./hooks/useRoster.js";
import { useRoute, type Route } from "./hooks/useRoute.js";
import { useHistory, useRunActions } from "./hooks/useRunActions.js";
import { useSettings } from "./hooks/useSettings.js";
import { MIN_PASSPHRASE_LENGTH, type VaultMode } from "./lib/vault.js";
import { HistoryPage } from "./pages/HistoryPage.js";
import { PayRunPage } from "./pages/PayRunPage.js";
import { RosterPage } from "./pages/RosterPage.js";
import { RunDetailPage } from "./pages/RunDetailPage.js";
import { SettingsPage } from "./pages/SettingsPage.js";
import { VaultGate } from "./pages/VaultGate.js";
import { Banner, Button, short } from "./ui/kit.js";

function chainName(id: number): string {
  return (CHAINS as Record<number, { chain: { name: string } } | undefined>)[id]?.chain.name ?? `Chain ${id}`;
}

function WalletButton() {
  const w = useWallet();
  const [open, setOpen] = useState(false);
  if (w.isConnected && w.address) {
    return (
      <div className="flex items-center gap-2 text-sm">
        {w.wrongChain && <span className="text-amber-700">wallet on another chain</span>}
        <span className="font-mono">{short(w.address, 4)}</span>
        <Button variant="ghost" onClick={w.disconnect}>Disconnect</Button>
      </div>
    );
  }
  return (
    <div className="relative">
      <Button onClick={() => setOpen((o) => !o)} disabled={w.connecting}>{w.connecting ? "Connecting…" : "Connect wallet"}</Button>
      {open && (
        <div className="absolute right-0 z-10 mt-1 flex w-56 flex-col gap-1 rounded border border-slate-200 bg-white p-2 shadow">
          {w.connectors.map((c) => (
            <Button key={c.id} variant="ghost" onClick={() => (c.connect(), setOpen(false))}>{c.name}</Button>
          ))}
        </div>
      )}
      {w.connectError && <div className="absolute right-0 mt-1 w-64 text-xs text-red-700">{w.connectError}</div>}
    </div>
  );
}

function Shell({ route, go, children }: { route: Route; go(r: Route): void; children: ReactNode }) {
  const { app, phase } = useStore();
  const tabs: { r: Route; label: string }[] = [
    { r: { page: "roster" }, label: "Roster" },
    { r: { page: "pay" }, label: "Pay run" },
    { r: { page: "history" }, label: "History" },
    { r: { page: "settings" }, label: "Settings" },
  ];
  const active = route.page === "run" ? "history" : route.page;
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-3">
          <div className="flex items-center gap-4">
            <span className="font-semibold">Soapay payroll</span>
            <span className="text-xs text-slate-500">{app.chain.name}</span>
            {phase === "ready" && (
              <nav className="flex gap-1 text-sm">
                {tabs.map((t) => (
                  <button
                    key={t.label}
                    onClick={() => go(t.r)}
                    className={`rounded px-2 py-1 ${active === t.r.page ? "bg-slate-900 text-white" : "hover:bg-slate-100"}`}
                  >
                    {t.label}
                  </button>
                ))}
              </nav>
            )}
          </div>
          <WalletButton />
        </div>
      </header>
      <main className="mx-auto flex max-w-5xl flex-col gap-4 px-4 py-6">
        {!app.stealthDisperse && (
          <Banner tone="warn">
            <b>EIP-5792 path only.</b> No StealthDisperse address is configured for {app.chain.name} (VITE_STEALTH_DISPERSE or Settings), so
            plain EOA wallets can't pay. Connect a smart wallet with atomic batching, or export the run for a Safe.
          </Banner>
        )}
        {app.mockEns && <Banner tone="info">Dev mock mode: names resolve to generated demo keys; the demo wallet can't sign.</Banner>}
        {children}
      </main>
    </div>
  );
}

function RosterContainer() {
  return <RosterPage {...useRoster()} />;
}

function PayRunContainer({ go }: { go(r: Route): void }) {
  const run = usePayRun();
  const wallet = useWallet();
  const payPath = usePayPath();
  return <PayRunPage run={run} wallet={wallet} payPath={payPath} onOpenRun={(id) => go({ page: "run", id })} />;
}

function HistoryContainer({ go }: { go(r: Route): void }) {
  return <HistoryPage runs={useHistory()} onOpen={(id) => go({ page: "run", id })} />;
}

function RunContainer({ id, go }: { id: string; go(r: Route): void }) {
  const actions = useRunActions(id);
  const chainId = actions.view?.run.chainId ?? 0;
  return <RunDetailPage {...actions} txUrl={(h) => txUrl(chainId, h)} onBack={() => go({ page: "history" })} />;
}

function SettingsContainer() {
  const s = useSettings();
  const { app, vaultMode, lock, destroyVault } = useStore();
  return (
    <SettingsPage
      {...s}
      chainName={chainName}
      attester={app.attester}
      apiUrl={app.apiUrl}
      mockEns={app.mockEns}
      vaultMode={vaultMode}
      onLock={lock}
      onDestroyVault={() => void destroyVault()}
    />
  );
}

function VaultContainer() {
  const { phase, vaultMode, createVault, unlock } = useStore();
  const [error, setError] = useState<string | null>(null);
  const wrap = (p: Promise<void>) => {
    setError(null);
    p.catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  };
  if (phase === "ready") return null;
  return (
    <VaultGate
      phase={phase}
      vaultMode={vaultMode}
      minPassphrase={MIN_PASSPHRASE_LENGTH}
      error={error}
      onCreate={(mode: VaultMode, pass?: string) => wrap(createVault(mode, pass))}
      onUnlock={(pass?: string) => wrap(unlock(pass))}
    />
  );
}

export function App() {
  const { phase } = useStore();
  const [route, go] = useRoute();
  let page: ReactNode;
  if (phase !== "ready") page = <VaultContainer />;
  else if (route.page === "pay") page = <PayRunContainer go={go} />;
  else if (route.page === "history") page = <HistoryContainer go={go} />;
  else if (route.page === "run") page = <RunContainer id={route.id} go={go} />;
  else if (route.page === "settings") page = <SettingsContainer />;
  else page = <RosterContainer />;
  return (
    <Shell route={route} go={go}>
      {page}
    </Shell>
  );
}
