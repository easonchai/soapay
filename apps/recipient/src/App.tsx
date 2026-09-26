import { HashRouter, Navigate, Route, Routes } from "react-router";
import { Loader2 } from "lucide-react";
import { ScannerProvider } from "./hooks/scanner.js";
import { InviteProvider, useInvite } from "./hooks/useInvite.js";
import { Onboarding } from "./onboarding/Onboarding.js";
import { Connect } from "./screens/Connect.js";
import { Exit } from "./screens/Exit.js";
import { WalletConnectProvider } from "./hooks/useWalletConnect.js";
import { ExitProvider } from "./hooks/useExit.js";
import { QueueProvider } from "./hooks/useQueue.js";
import { Home } from "./screens/Home.js";
import { Labels } from "./screens/Labels.js";
import { Layout } from "./screens/Layout.js";
import { NameSettings } from "./screens/NameSettings.js";
import { Settings } from "./screens/Settings.js";
import { Spend } from "./screens/Spend.js";
import { Unlock } from "./screens/Unlock.js";
import { ServicesProvider, useServices } from "./services/ServicesProvider.js";
import { exitOffered } from "./config.js";
import { Alert } from "./ui/kit.js";
import { VaultProvider, useVault } from "./vault/VaultProvider.js";
import { BackupSync } from "./vault/BackupSync.js";

/**
 * Vault gate: loading → onboarding (no vault / unfinished) → unlock (locked) → the app.
 * An invite link (`#/join?code=…`) is read once by InviteProvider and followed through any of these.
 */
function Gate() {
  const vault = useVault();
  const invite = useInvite().state;
  // The exit is hidden on the Base Sepolia demo (mock pay token, D-52): no tab, no route.
  const exitOn = exitOffered(useServices().settings.chainId);
  switch (vault.status) {
    case "loading":
      return (
        <div className="grid min-h-dvh place-items-center" aria-busy>
          <Loader2 className="size-6 animate-spin text-muted-foreground" aria-label="Loading" />
        </div>
      );
    case "error":
      return (
        <div className="mx-auto max-w-md p-6">
          <Alert variant="destructive" title="Can't open this browser's storage">
            {vault.error}
          </Alert>
        </div>
      );
    case "empty":
      return <Onboarding />;
    case "locked":
      return <Unlock />;
    case "unlocked":
      if (!vault.data?.profile.onboardedAt) return <Onboarding />;
      // An existing account opened an invite link: unlock (above), then claim the reserved name.
      if (invite.kind === "pending" && !vault.data.profile.name) return <Onboarding claimInvite />;
      return (
        <ScannerProvider>
          <QueueProvider>
          <ExitProvider>
          <WalletConnectProvider>
            <HashRouter>
              <Routes>
                <Route element={<Layout />}>
                  <Route index element={<Home />} />
                  <Route path="spend" element={<Spend />} />
                  <Route path="connect" element={<Connect />} />
                  {exitOn && <Route path="exit" element={<Exit />} />}
                  <Route path="labels" element={<Labels />} />
                  <Route path="name" element={<NameSettings />} />
                  <Route path="settings" element={<Settings />} />
                  <Route path="*" element={<Navigate to="/" replace />} />
                </Route>
              </Routes>
            </HashRouter>
          </WalletConnectProvider>
          </ExitProvider>
          </QueueProvider>
        </ScannerProvider>
      );
  }
}

export function App() {
  return (
    <VaultProvider>
      <ServicesProvider>
        <BackupSync>
          <InviteProvider>
            <Gate />
          </InviteProvider>
        </BackupSync>
      </ServicesProvider>
    </VaultProvider>
  );
}
