import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MotionConfig } from "framer-motion";
import { WagmiProvider } from "wagmi";
import { Toaster } from "@soapay/ui";
import { App } from "./App.js";
import { resolveConfig } from "./config.js";
import { StoreProvider } from "./hooks/store.js";
import { createServices } from "./lib/services.js";
import { createWagmiConfig } from "./lib/wagmi.js";
import "./app.css";

// Built once per page load; Settings reloads the page after saving.
const app = resolveConfig();

// Invite links from before the employee app moved to /app/ pointed at /#/join?…: forward them.
if (typeof location !== "undefined" && location.hash.startsWith("#/join")) {
  location.replace(app.recipientUrl.replace(/\/?$/, "/") + location.hash);
}
const wagmiConfig = createWagmiConfig(app);
const services = createServices(app);
const queryClient = new QueryClient();

/** `?motion=off` disables every animation (QA, screenshots, automation). */
const motionOff = typeof location !== "undefined" && new URLSearchParams(location.search).get("motion") === "off";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <StoreProvider app={app} services={services}>
          <MotionConfig reducedMotion={motionOff ? "always" : "user"}>
            <App />
            <Toaster />
          </MotionConfig>
        </StoreProvider>
      </QueryClientProvider>
    </WagmiProvider>
  </StrictMode>,
);
