import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // @scopelift/stealth-address-sdk ships ESM with extensionless imports that
    // plain Node cannot resolve; inline it so Vite's resolver handles it.
    server: { deps: { inline: ["@scopelift/stealth-address-sdk"] } },
    // Key derivation and the exit state machine are CPU-bound; under `turbo run test` every package
    // runs at once and these exceeded the 5 s default (they take under 1 s alone).
    testTimeout: 30_000,
  },
});
