import { describe, expect, it } from "vitest";
import { DEFAULT_CHUNK_USDC, TESTNET_CHUNK_USDC, defaultChunkUsdc, envDefaults, getChunkSize, getOrgName, recipientAppUrls, setChunkSize, setOrgName } from "../src/config.js";

describe("company chunk size (D-31, D-47)", () => {
  it("defaults to 5 USDC on a testnet and 500 on mainnet", () => {
    setChunkSize("", 84532);
    expect(DEFAULT_CHUNK_USDC).toBe("500");
    expect(TESTNET_CHUNK_USDC).toBe("5");
    expect(defaultChunkUsdc(84532)).toBe("5");
    expect(defaultChunkUsdc(8453)).toBe("500");
    expect(getChunkSize(84532)).toBe("5");
    expect(getChunkSize(8453)).toBe("500");
  });

  it("persists a change and never overrides a saved value", () => {
    setChunkSize(" 250 ", 84532);
    expect(getChunkSize(84532)).toBe("250");
    expect(getChunkSize(8453)).toBe("250");
    // 500 saved on testnet is a real choice (it differs from the testnet default), so it sticks.
    setChunkSize("500", 84532);
    expect(getChunkSize(84532)).toBe("500");
    // Saving the chain's own default follows the default.
    setChunkSize("5", 84532);
    expect(getChunkSize(84532)).toBe("5");
    expect(getChunkSize(8453)).toBe("500");
    setChunkSize("", 84532);
  });
});

const A = "0x1111111111111111111111111111111111111111";
const B = "0x2222222222222222222222222222222222222222";
const env = (e: Record<string, string>) => e as unknown as ImportMetaEnv;

describe("env names (ours + CK's aliases)", () => {
  it("accepts VITE_STEALTH_DISPERSE_ADDRESS as an alias", () => {
    const s = envDefaults(env({ VITE_CHAIN_ID: "84532", VITE_STEALTH_DISPERSE_ADDRESS: A }));
    expect(s.stealthDisperse[84532]).toBe(A);
  });

  it("prefers VITE_STEALTH_DISPERSE when both are set", () => {
    const s = envDefaults(env({ VITE_CHAIN_ID: "84532", VITE_STEALTH_DISPERSE: B, VITE_STEALTH_DISPERSE_ADDRESS: A }));
    expect(s.stealthDisperse[84532]).toBe(B);
  });

  it("ignores an invalid alias", () => {
    expect(envDefaults(env({ VITE_CHAIN_ID: "84532", VITE_STEALTH_DISPERSE_ADDRESS: "nope" })).stealthDisperse).toEqual({});
  });

  it("links the recipient app via VITE_OTHER_APP_URL, else VITE_RECIPIENT_URL", () => {
    expect(recipientAppUrls(env({ VITE_RECIPIENT_URL: "https://r.example" }))).toEqual({
      recipientUrl: "https://r.example",
      otherAppUrl: "https://r.example",
    });
    expect(recipientAppUrls(env({ VITE_RECIPIENT_URL: "https://r.example", VITE_OTHER_APP_URL: "/" })).otherAppUrl).toBe("/");
    expect(recipientAppUrls(env({})).recipientUrl).toBe("http://localhost:5173");
  });

  it("stores the company name", () => {
    setOrgName("  Meridian Labs ");
    expect(getOrgName()).toBe("Meridian Labs");
    setOrgName("");
    expect(getOrgName()).toBe("");
  });
});
