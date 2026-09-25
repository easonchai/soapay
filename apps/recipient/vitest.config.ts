import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    setupFiles: ["./test/setup.ts"],
    include: ["test/**/*.test.{ts,tsx}"],
    testTimeout: 30_000,
    // @scopelift/stealth-address-sdk ships ESM with extensionless imports that plain Node cannot
    // resolve; inline it so Vite's resolver handles it (same as packages/sdk/vitest.config.ts).
    server: { deps: { inline: ["@scopelift/stealth-address-sdk", "@soapay/sdk"] } },
  },
});
