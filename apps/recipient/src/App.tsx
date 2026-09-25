import { HashRouter, Navigate, Route, Routes } from "react-router";
import { Loader2 } from "lucide-react";
import { ScannerProvider } from "./hooks/scanner.js";
import { Onboarding } from "./onboarding/Onboarding.js";
import { Convert } from "./screens/Convert.js";
import { Home } from "./screens/Home.js";
import { Labels } from "./screens/Labels.js";
import { Layout } from "./screens/Layout.js";
import { NameSettings } from "./screens/NameSettings.js";
import { Settings } from "./screens/Settings.js";
import { Spend } from "./screens/Spend.js";
import { Unlock } from "./screens/Unlock.js";
import { ServicesProvider } from "./services/ServicesProvider.js";
import { Alert } from "./ui/kit.js";
import { VaultProvider, useVault } from "./vault/VaultProvider.js";

/** Vault gate: loading → onboarding (no vault / unfinished) → unlock (locked) → the app. */
function Gate() {
  const vault = useVault();
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
      return (
        <ScannerProvider>
          <HashRouter>
            <Routes>
              <Route element={<Layout />}>
                <Route index element={<Home />} />
                <Route path="spend" element={<Spend />} />
                <Route path="convert" element={<Convert />} />
                <Route path="labels" element={<Labels />} />
                <Route path="name" element={<NameSettings />} />
                <Route path="settings" element={<Settings />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Route>
            </Routes>
          </HashRouter>
        </ScannerProvider>
      );
  }
}

export function App() {
  return (
    <VaultProvider>
      <ServicesProvider>
        <Gate />
      </ServicesProvider>
    </VaultProvider>
  );
}
