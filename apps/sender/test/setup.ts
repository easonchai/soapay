import "@testing-library/jest-dom/vitest";
import { webcrypto } from "node:crypto";

// jsdom's crypto lacks SubtleCrypto; use Node's WebCrypto.
if (!globalThis.crypto?.subtle) {
  Object.defineProperty(globalThis, "crypto", { value: webcrypto, configurable: true });
}
