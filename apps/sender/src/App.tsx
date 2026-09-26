// The only file that knows both the hooks and the pages: each container calls our hooks and
// hands their results to CK's Ledger screens (props-only). See README "How to plug in another UI".
import { useEffect, useState, type ReactNode } from "react";
import { Fade, Presence, TopBar } from "@soapay/ui";
import { CHAINS, PARENT_NAME } from "@soapay/sdk";
import { getChunkSize, getOrgName, setChunkSize, setOrgName, txUrl } from "./config.js";
import { useStore } from "./hooks/store.js";
import { usePayPath, useWallet } from "./hooks/usePayPath.js";
import { usePayRun } from "./hooks/usePayRun.js";
import { useRoster } from "./hooks/useRoster.js";
import { useRoute, type Route } from "./hooks/useRoute.js";
import { useInvitePolling, useInvites } from "./hooks/useInvites.js";
import { useHistory, useRunActions } from "./hooks/useRunActions.js";
import { useSettings } from "./hooks/useSettings.js";
import { useWalletBalances } from "./hooks/useWalletBalances.js";
import { formatUsdc } from "./lib/amount.js";
import { MIN_PASSPHRASE_LENGTH, type VaultMode } from "./lib/vault.js";
import { employeeWallets, historyCsv } from "./lib/wallets.js";
import type { Denomination } from "./lib/run.js";
import { HistoryPage } from "./pages/HistoryPage.js";
import { InvitesPanel } from "./pages/InvitesPanel.js";
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
      invitesPanel={<InvitesPanel {...invites} parentName={PARENT_NAME} defaultOrg={org} />}
    />
  );
}

/** Polls pending invites on every page and auto-enrolls claimed ones (resolve-and-pin). */
function InvitePoller() {
  useInvitePolling();
  return null;
}

function PayRunContainer({ go, chunk }: { go(r: Route): void; chunk: string }) {
  const { app } = useStore();
  const run = usePayRun();
  const roster = useRoster();
  const wallet = useWallet();
  const payPath = usePayPath();
  const [editing, setEditing] = useState(false);

  // A real pay run executes step by step: follow it on the run page (it persists every step).
  useEffect(() => {
    if (run.stage === "executing" && run.runId) go({ page: "run", id: run.runId });
  }, [run.stage, run.runId, go]);

  if (run.safeChunks && run.runId) {
    const id = run.runId;
    return <SafeExportPage chunks={run.safeChunks} onDownload={run.downloadSafeChunk} onOpenRun={() => go({ page: "run", id })} onNewRun={run.reset} />;
  }
  if (run.plan && run.stage === "planned" && !editing) {
    return <ReviewPage run={run} plan={run.plan} wallet={wallet} payPath={payPath} chainName={app.chain.name} onBack={() => setEditing(true)} />;
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
      onOpenSettings={() => go({ page: "settings" })}
      onReview={(d: Denomination | null) => {
        setEditing(false);
        // Re-plans with fresh addresses every time; a plan is never reused.
        run.preview(d);
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
  return <RunDetailPage {...actions} txUrl={(h) => txUrl(chainId, h)} onBack={() => go({ page: "history" })} />;
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
  return (
    <SettingsPage
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

function Banners() {
  const { app } = useStore();
  const wallet = useWallet();
  const items: ReactNode[] = [];
  if (!app.stealthDisperse) {
    items.push(
      <Notice key="5792" tone="warn">
        <b>EIP-5792 path only.</b> No StealthDisperse address is configured for {app.chain.name} (VITE_STEALTH_DISPERSE or Settings), so plain EOA
        wallets can&apos;t pay. Connect a smart wallet with atomic batching, or export the run for a Safe.
      </Notice>,
    );
  }
  if (app.mockEns) {
    items.push(
      <Notice key="mock" tone="info">
        Dev mock mode: names resolve to generated demo keys; the demo wallet can&apos;t sign. Invites are signed by a throwaway key and flip to
        claimed after a few seconds.
      </Notice>,
    );
  }
  if (wallet.wrongChain) {
    items.push(
      <Notice key="chain" tone="warn">
        Your wallet is on another chain. Payments target {app.chain.name}.
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
  const [chunk, setChunk] = useState(getChunkSize);

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
  else if (route.page === "pay") body = <PayRunContainer go={go} chunk={chunk} />;
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
          setChunkSize(v);
          setChunk(getChunkSize());
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
        <Banners />
        <Presence mode="wait" initial={false}>
          <Fade key={phase !== "ready" ? "vault" : route.page === "run" ? `run-${route.id}` : route.page} y={8}>
            {body}
          </Fade>
        </Presence>
      </main>
    </div>
  );
}
