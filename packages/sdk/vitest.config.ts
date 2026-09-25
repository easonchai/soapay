import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // @scopelift/stealth-address-sdk ships ESM with extensionless imports that
    // plain Node cannot resolve; inline it so Vite's resolver handles it.
    server: { deps: { inline: ["@scopelift/stealth-address-sdk"] } },
  },
});
