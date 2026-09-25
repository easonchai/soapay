import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WagmiProvider } from "wagmi";
import { App } from "./App.js";
import { resolveConfig } from "./config.js";
import { StoreProvider } from "./hooks/store.js";
import { createServices } from "./lib/services.js";
import { createWagmiConfig } from "./lib/wagmi.js";
import "./index.css";

// Built once per page load; Settings reloads the page after saving.
const app = resolveConfig();
const wagmiConfig = createWagmiConfig(app);
const services = createServices(app);
const queryClient = new QueryClient();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <StoreProvider app={app} services={services}>
          <App />
        </StoreProvider>
      </QueryClientProvider>
    </WagmiProvider>
  </StrictMode>,
);
