import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { MotionConfig } from "framer-motion";
// Ledger design tokens, IBM Plex (self-hosted) and base styles; index.css adds layout utilities after it.
import "@soapay/ui";
import { App } from "./App.js";
import "./index.css";

/** `?motion=off` disables every animation (QA, screenshots, automation), as in CK's sender. */
const motionOff = typeof location !== "undefined" && new URLSearchParams(location.search).get("motion") === "off";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <MotionConfig reducedMotion={motionOff ? "always" : "user"}>
      <App />
    </MotionConfig>
  </StrictMode>,
);
