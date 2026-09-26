import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // @scopelift/stealth-address-sdk ships ESM with extensionless imports that
    // plain Node cannot resolve; inline it (and the SDK that re-exports it).
    server: { deps: { inline: ["@scopelift/stealth-address-sdk", "@soapay/sdk"] } },
    testTimeout: 30_000,
  },
});
