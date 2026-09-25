import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    setupFiles: ["./test/setup.ts"],
    include: ["test/**/*.test.{ts,tsx}"],
    // @scopelift/stealth-address-sdk ships ESM with extensionless imports that plain
    // Node can't resolve; inline it (and the SDK that imports it) so Vite resolves them.
    server: { deps: { inline: ["@scopelift/stealth-address-sdk", "@soapay/sdk"] } },
  },
});
