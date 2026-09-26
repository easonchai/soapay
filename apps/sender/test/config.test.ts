import { describe, expect, it } from "vitest";
import { DEFAULT_CHUNK_USDC, envDefaults, getChunkSize, getOrgName, recipientAppUrls, setChunkSize, setOrgName } from "../src/config.js";

describe("company chunk size (D-31)", () => {
  it("defaults to 500 USDC and persists a change", () => {
    setChunkSize("");
    expect(getChunkSize()).toBe(DEFAULT_CHUNK_USDC);
    expect(DEFAULT_CHUNK_USDC).toBe("500");
    setChunkSize(" 250 ");
    expect(getChunkSize()).toBe("250");
    setChunkSize("500");
    expect(getChunkSize()).toBe("500");
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
