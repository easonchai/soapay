import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

/**
 * Strict Content-Security-Policy, injected into the built index.html only: Vite's dev server needs
 * inline scripts for HMR, the production bundle does not.
 *
 * connect-src allows any https/wss origin because the API, RPC and bundler URLs are user-configurable
 * (Settings). localhost is allowed so a self-hosted API works in development builds.
 * `frame-ancestors` cannot be set from a meta tag; set it as a header where the SPA is hosted.
 *
 * style-src allows 'unsafe-inline': framer-motion (in @soapay/ui) writes runtime styles, and a static
 * SPA can't carry per-load nonces. Scripts stay strict ('self' only), which is what guards the vault.
 */
export const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "worker-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self' https: wss: http://localhost:* http://127.0.0.1:*",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join("; ");

function cspPlugin(): Plugin {
  return {
    name: "soapay-csp",
    apply: "build",
    transformIndexHtml(html) {
      return html.replace(
        "<!-- CSP -->",
        `<meta http-equiv="Content-Security-Policy" content="${CSP}" />`,
      );
    },
  };
}

// Static SPA only: keys and requests never touch a server we run.
export default defineConfig({
  plugins: [react(), tailwindcss(), cspPlugin()],
  worker: { format: "es" },
  build: { target: "es2022", sourcemap: true },
});
