// The only file that knows both the hooks and the pages: each container calls our hooks and
// hands their results to CK's Ledger screens (props-only). See README "How to plug in another UI".
import { useEffect, useState, type ReactNode } from "react";
import { Fade, Presence, TopBar } from "@soapay/ui";
import { CHAINS, PARENT_NAME, isTestnetChain } from "@soapay/sdk";
import { getChunkSize, getOrgName, setChunkSize, setDemoFlag, setOrgName, txUrl } from "./config.js";
import { useStore } from "./hooks/store.js";
import { usePayPath, useWallet } from "./hooks/usePayPath.js";
import { usePayRun } from "./hooks/usePayRun.js";
import { useRoster } from "./hooks/useRoster.js";
import { replaceRoute, useRoute, type Route } from "./hooks/useRoute.js";
import { useInvitePolling, useInvites } from "./hooks/useInvites.js";
import { useHistory, useRunActions } from "./hooks/useRunActions.js";
import { useRunOnChain } from "./hooks/useRunOnChain.js";
import { useSettings } from "./hooks/useSettings.js";
import { useWalletBalances } from "./hooks/useWalletBalances.js";
import { useWelcomeDrop } from "./hooks/useWelcomeDrop.js";
import { welcomeMessage, type WelcomeDrop } from "./lib/sponsorship.js";
import { formatUsdc } from "./lib/amount.js";
import { demoLedger } from "./lib/demoChain.js";
import { MIN_PASSPHRASE_LENGTH, type VaultMode } from "./lib/vault.js";
import { employeeWallets, historyCsv } from "./lib/wallets.js";
import type { Denomination } from "./lib/run.js";
import { HistoryPage } from "./pages/HistoryPage.js";
import { InvitesPanel } from "./pages/InvitesPanel.js";
import { Faucet } from "./pages/Faucet.js";
import { Landing } from "./pages/Landing.js";
import { PayRunPage } from "./pages/PayRunPage.js";
import { RecipientsPage } from "./pages/RecipientsPage.js";
import { ReviewPage } from "./pages/ReviewPage.js";
import { RunDetailPage } from "./pages/RunDetailPage.js";
import { SafeExportPage } from "./pages/SafeExportPage.js";
import { SettingsPage } from "./pages/SettingsPage.js";
import { VaultGate } from "./pages/VaultGate.js";
import { Notice, short } from "./ui/kit.js";

function chainName(id: number): string {
  return (CHAINS as Record<number, { chain: { name: string } } | undefined>)[id]?.chain.name ?? `Chain ${id}`;
}

const LOGGED_OUT = "soapay:loggedOut";
const session = {
  get: () => {
    try {
      return sessionStorage.getItem(LOGGED_OUT) === "1";
    } catch {
      return false;
    }
  },
  set: (v: boolean) => {
    try {
      if (v) sessionStorage.setItem(LOGGED_OUT, "1");
      else sessionStorage.removeItem(LOGGED_OUT);
    } catch {
      /* ignore */
    }
  },
};

/** Testnet-sized copy and confirmations (D-47) apply to a real testnet, not to demo mode's mainnet-sized sample data. */
function realTestnet(app: { chainId: number; demo: boolean }): boolean {
  return isTestnetChain(app.chainId) && !app.demo;
}

/** Test-USDC affordance for the current chain (demo button, testnet faucet links, nothing on mainnet). */
function FaucetSlot({ usdcBalance, compact = false }: { usdcBalance: bigint | null; compact?: boolean }) {
  const { app } = useStore();
  return <Faucet chainId={app.chainId} demo={app.demo} usdcBalance={usdcBalance} onFaucet={() => demoLedger.faucet()} compact={compact} />;
}

function RecipientsContainer({ go, org }: { go(r: Route): void; org: string }) {
  const { runs, app, updateEmployees } = useStore();
  const roster = useRoster();
  const invites = useInvites();
  const [openId, setOpenId] = useState<string>();
  const landed = openId ? employeeWallets(runs, openId).map((w) => w.stealthAddress) : [];
  const { balances } = useWalletBalances(landed);
  return (
    <RecipientsPage
      roster={roster}
      runs={runs}
      chainId={app.chainId}
      openId={openId}
      onOpen={setOpenId}
      balances={balances}
      onRename={(id, label) =>
        updateEmployees((l) =>
          l.map((e) => {
            if (e.id !== id) return e;
            const { label: _old, ...rest } = e;
            return label.trim() ? { ...rest, label: label.trim() } : rest;
          }),
        )
      }
      onPay={() => go({ page: "pay" })}
      invitesPanel={<InvitesPanel {...invites} parentName={PARENT_NAME} defaultOrg={org} testnet={realTestnet(app)} />}
    />
  );
}

/** Polls pending invites on every page and auto-enrolls claimed ones (resolve-and-pin). */
function InvitePoller() {
  useInvitePolling();
  return null;
}

function PayRunContainer({ go, chunk, review }: { go(r: Route): void; chunk: string; review: boolean }) {
  const { app } = useStore();
  const run = usePayRun();
  const roster = useRoster();
  const wallet = useWallet();
  const payPath = usePayPath();
  const planned = Boolean(run.plan) && run.stage === "planned";

  // #/pay/review is only meaningful with a plan in memory (a reload or deep link has none): fall back to the editor.
  useEffect(() => {
    if (review && !planned && !run.safeChunks) replaceRoute({ page: "pay" });
  }, [review, planned, run.safeChunks]);

  // A real pay run executes step by step: follow it on the run page (it persists every step).
  useEffect(() => {
    if (run.stage === "executing" && run.runId) go({ page: "run", id: run.runId });
  }, [run.stage, run.runId, go]);

  if (run.safeChunks && run.runId) {
    const id = run.runId;
    return <SafeExportPage chunks={run.safeChunks} onDownload={run.downloadSafeChunk} onOpenRun={() => go({ page: "run", id })} onNewRun={run.reset} />;
  }
  if (review && run.plan && planned) {
    return <ReviewPage run={run} plan={run.plan} wallet={wallet} payPath={payPath} chainName={app.chain.name} testnet={realTestnet(app)} onBack={() => go({ page: "pay" })} />;
  }
  return (
    <PayRunPage
      run={run}
      roster={roster}
      wallet={wallet}
      payPath={payPath}
      chainName={app.chain.name}
      onOpenRecipients={() => go({ page: "roster" })}
      chunk={chunk}
      testnet={realTestnet(app)}
      onOpenSettings={() => go({ page: "settings" })}
      faucet={<FaucetSlot usdcBalance={payPath.funding?.usdcBalance ?? null} compact />}
      onReview={(d: Denomination | null) => {
        // Re-plans with fresh addresses every time; a plan is never reused. Review is its own
        // history entry, so browser Back returns to this editor with the roster intact.
        if (run.preview(d)) go({ page: "pay", view: "review" });
      }}
    />
  );
}

function HistoryContainer({ go }: { go(r: Route): void }) {
  const views = useHistory();
  const { runs } = useStore();
  return (
    <HistoryPage
      runs={views}
      onOpenRun={(id) => go({ page: "run", id })}
      onStartRun={() => go({ page: "pay" })}
      onExportCsv={() => {
        const blob = new Blob([historyCsv(runs, formatUsdc)], { type: "text/csv" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = `soapay-history-${new Date().toISOString().slice(0, 10)}.csv`;
        a.click();
        URL.revokeObjectURL(a.href);
      }}
    />
  );
}

function RunContainer({ id, go }: { id: string; go(r: Route): void }) {
  const actions = useRunActions(id);
  const chainId = actions.view?.run.chainId ?? 0;
  const onChain = useRunOnChain(actions.view?.run);
  return <RunDetailPage {...actions} onChain={onChain} txUrl={(h) => txUrl(chainId, h)} onBack={() => go({ page: "history" })} />;
}

function SettingsContainer({
  org,
  onOrgChange,
  chunk,
  onChunkChange,
}: {
  org: string;
  onOrgChange(v: string): void;
  chunk: string;
  onChunkChange(v: string): void;
}) {
  const s = useSettings();
  const { app, vaultMode, lock, destroyVault, employees, invites, runs } = useStore();
  const payPath = usePayPath();
  return (
    <SettingsPage
      faucet={<FaucetSlot usdcBalance={payPath.funding?.usdcBalance ?? null} />}
      {...s}
      app={app}
      chainName={chainName}
      org={org}
      onOrgChange={onOrgChange}
      chunk={chunk}
      onChunkChange={onChunkChange}
      vaultMode={vaultMode}
      counts={{ employees: employees.length, invites: invites.length, runs: runs.length }}
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

/** Clears the session flag and reloads at `/` without `?demo` (wagmi, services and the store are built once per page load). */
function exitDemo() {
  setDemoFlag(false);
  demoLedger.reset();
  location.assign(location.pathname);
}

type Welcome = { drop: Extract<WelcomeDrop, { status: "sent" }> | null; dismiss(): void };

function Banners({ welcome }: { welcome: Welcome }) {
  const { app } = useStore();
  const wallet = useWallet();
  const items: ReactNode[] = [];
  if (welcome.drop) {
    const d = welcome.drop;
    items.push(
      <Notice key="welcome" tone="ok" role="status">
        <b>{welcomeMessage(d)}.</b>{" "}
        <a href={txUrl(app.chainId, d.usdc.txHash)} target="_blank" rel="noreferrer">
          View on Basescan
        </a>
        {d.eth && (
          <>
            {" "}
            (plus a little ETH for gas:{" "}
            <a href={txUrl(app.chainId, d.eth.txHash)} target="_blank" rel="noreferrer">
              tx
            </a>
            )
          </>
        )}{" "}
        <button type="button" className="btn-text btn-inline" onClick={welcome.dismiss}>
          Dismiss
        </button>
      </Notice>,
    );
  }
  if (!app.stealthDisperse) {
    items.push(
      <Notice key="5792" tone="warn">
        <b>EIP-5792 path only.</b> No StealthDisperse on {app.chain.name} (Settings or VITE_STEALTH_DISPERSE). EOAs can&apos;t pay: use a
        batching smart wallet or a Safe export.
      </Notice>,
    );
  }
  if (app.demo) {
    items.push(
      <Notice key="demo" tone="info">
        <b>Demo mode</b> · sample data, nothing on-chain. Balances reset when the tab closes.{" "}
        <button className="btn-text" onClick={exitDemo}>
          Exit demo
        </button>
      </Notice>,
    );
  }
  if (app.mockEns && !app.demo) {
    items.push(
      <Notice key="mock" tone="info">
        Dev mock: names resolve to demo keys; the demo wallet can&apos;t sign. Invites use a throwaway key and flip to claimed in seconds.
      </Notice>,
    );
  }
  if (wallet.wrongChain) {
    items.push(
      <Notice key="chain" tone="warn">
        Wallet on another chain; payments target {app.chain.name}.
      </Notice>,
    );
  }
  return items.length ? <div className="banners">{items}</div> : null;
}

export function App() {
  const { app, phase, lock } = useStore();
  const wallet = useWallet();
  const [route, go] = useRoute();
  const [loggedOut, setLoggedOut] = useState(session.get);
  const [org, setOrg] = useState(getOrgName);
  const [chunk, setChunk] = useState(() => getChunkSize(app.chainId));
  // Base Sepolia demo (D-52): a wallet that connects gets test USDC once; nothing shows if it already did.
  // Demo mode is off-chain sample data, so it never claims the welcome drop.
  const welcome = useWelcomeDrop(wallet.isConnected && !app.demo ? wallet.address : undefined);
  // The default follows the chain (5 USDC on a testnet, 500 elsewhere); a saved value never changes.
  useEffect(() => setChunk(getChunkSize(app.chainId)), [app.chainId]);

  if (!wallet.isConnected || loggedOut) {
    return (
      <Landing
        wallet={wallet}
        employeeUrl={app.otherAppUrl}
        onLogin={() => {
          session.set(false);
          setLoggedOut(false);
        }}
      />
    );
  }

  function logout() {
    session.set(true);
    setLoggedOut(true);
    lock();
    wallet.disconnect();
  }

  let body: ReactNode;
  if (phase !== "ready") body = <VaultContainer />;
  else if (route.page === "pay") body = <PayRunContainer go={go} chunk={chunk} review={route.view === "review"} />;
  else if (route.page === "history") body = <HistoryContainer go={go} />;
  else if (route.page === "run") body = <RunContainer id={route.id} go={go} />;
  else if (route.page === "settings")
    body = (
      <SettingsContainer
        org={org}
        onOrgChange={(v) => {
          setOrgName(v);
          setOrg(v.trim());
        }}
        chunk={chunk}
        onChunkChange={(v) => {
          setChunkSize(v, app.chainId);
          setChunk(getChunkSize(app.chainId));
        }}
      />
    );
  else body = <RecipientsContainer go={go} org={org} />;

  const active = route.page === "run" ? "history" : route.page;
  const tab = (label: string, r: Route) => ({ label, active: phase === "ready" && active === r.page, onSelect: () => go(r) });
  return (
    <div className="page">
      <TopBar
        org={org || undefined}
        tabs={
          phase === "ready"
            ? [tab("Pay run", { page: "pay" }), tab("History", { page: "history" }), tab("Recipients", { page: "roster" }), tab("Settings", { page: "settings" })]
            : []
        }
        right={
          <>
            <a className="btn-text" href={app.otherAppUrl} title="The employee app">
              Receive
            </a>
            <span className="chip">
              {wallet.address ? short(wallet.address, 4) : ""} · {app.chain.name}
            </span>
            <button className="btn-text" onClick={logout}>
              Log out
            </button>
          </>
        }
      />
      <main className="app-main">
        {phase === "ready" && <InvitePoller />}
        <Banners welcome={welcome} />
        <Presence mode="wait" initial={false}>
          <Fade key={phase !== "ready" ? "vault" : route.page === "run" ? `run-${route.id}` : route.page} y={8}>
            {body}
          </Fade>
        </Presence>
      </main>
    </div>
  );
}
