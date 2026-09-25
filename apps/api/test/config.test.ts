import { describe, expect, it } from "vitest";
import { CHAINS } from "@soapay/sdk";
import { loadConfig } from "../src/config.js";

describe("loadConfig", () => {
  it("applies defaults", () => {
    const c = loadConfig({ RPC_URL: "https://sepolia.base.org" });
    expect(c.chainId).toBe(84532);
    expect(c.port).toBe(8787);
    expect(c.relayerPrivateKey).toBeUndefined();
    expect(c.indexer.startBlock).toBe(CHAINS[84532].announcerStartBlock);
    expect(c.rateLimit.registerPerIp).toBe(3);
  });

  it("gives clear errors", () => {
    expect(() => loadConfig({})).toThrow(/RPC_URL is required/);
    expect(() => loadConfig({ RPC_URL: "https://x.y", CHAIN_ID: "1" })).toThrow(/CHAIN_ID 1 is not supported/);
    expect(() => loadConfig({ RPC_URL: "https://x.y", RELAYER_PRIVATE_KEY: "0xabc" })).toThrow(/RELAYER_PRIVATE_KEY must be/);
    expect(() => loadConfig({ RPC_URL: "https://x.y", PORT: "abc" })).toThrow(/PORT/);
  });

  it("never echoes a private key in errors", () => {
    const secret = "0xdeadbeefdeadbeef";
    try {
      loadConfig({ RPC_URL: "https://x.y", RELAYER_PRIVATE_KEY: secret });
    } catch (e) {
      expect((e as Error).message).not.toContain("deadbeef");
    }
  });
});
