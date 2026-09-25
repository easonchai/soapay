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

  it("defaults World ID to Soapay's public app and RP ids on staging, and the Uniswap proxy to off", () => {
    const c = loadConfig({ RPC_URL: "https://sepolia.base.org" });
    expect(c.worldId).toMatchObject({
      disabled: false,
      appId: "app_0cc7167efe114ac2e0ef7d9827098353",
      rpId: "rp_3ede5fe1cab9af48",
      signingKey: undefined,
      environment: "staging",
      attachCooldownSeconds: 72 * 3600,
    });
    expect(c.attesterPrivateKey).toBeUndefined();
    expect(c.uniswap).toEqual({
      apiKey: undefined,
      baseUrl: "https://trade-api.gateway.uniswap.org/v1",
      perIpPerMinute: 30,
      bodyLimitBytes: 8192,
    });
    const s = loadConfig({ RPC_URL: "https://x.y", WORLD_ENV: "sandbox", WORLD_ID_DISABLED: "true", UNISWAP_API_KEY: "k" });
    expect(s.worldId.environment).toBe("sandbox");
    expect(s.worldId.disabled).toBe(true);
    expect(s.uniswap.apiKey).toBe("k");
  });

  it("validates World ID settings without echoing secrets", () => {
    expect(() => loadConfig({ RPC_URL: "https://x.y", WORLD_ENV: "prod" })).toThrow(/WORLD_ENV must be production, staging or sandbox/);
    expect(() => loadConfig({ RPC_URL: "https://x.y", WORLD_RP_ID: "nope" })).toThrow(/WORLD_RP_ID/);
    expect(() => loadConfig({ RPC_URL: "https://x.y", WORLD_RP_SIGNING_KEY: "0xfeedface" })).toThrow(/WORLD_RP_SIGNING_KEY must be/);
    try {
      loadConfig({ RPC_URL: "https://x.y", ATTESTER_PRIVATE_KEY: "0xfeedface" });
    } catch (e) {
      expect((e as Error).message).not.toContain("feedface");
    }
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
