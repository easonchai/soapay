import { describe, expect, it } from "vitest";
import { apiFromRelayUrl, readEnv } from "../src/config.js";

const A = "0x00000000000000000000000000000000000000aA";
const B = "0x00000000000000000000000000000000000000bB";

describe("readEnv: CK's env names are accepted as aliases, ours win", () => {
  it("VITE_STEALTH_DISPERSE_ADDRESS is used only when VITE_STEALTH_DISPERSE is unset", () => {
    expect(readEnv({ VITE_STEALTH_DISPERSE_ADDRESS: A }).stealthDisperse.map((a) => a.toLowerCase())).toEqual([A.toLowerCase()]);
    expect(readEnv({ VITE_STEALTH_DISPERSE: B, VITE_STEALTH_DISPERSE_ADDRESS: A }).stealthDisperse.map((a) => a.toLowerCase())).toEqual([
      B.toLowerCase(),
    ]);
  });

  it("VITE_RELAY_URL's origin is the API only when VITE_API_URL is unset", () => {
    expect(readEnv({ VITE_RELAY_URL: "https://api.example/relay" }).apiUrl).toBe("https://api.example");
    expect(readEnv({ VITE_RELAY_URL: "https://host.example/api/relay/" }).apiUrl).toBe("https://host.example/api");
    expect(readEnv({ VITE_API_URL: "https://ours.example", VITE_RELAY_URL: "https://ck.example/relay" }).apiUrl).toBe("https://ours.example");
    expect(readEnv({}).apiUrl).toBe("http://localhost:8787");
  });

  it("VITE_OTHER_APP_URL, else the sender dev server in dev and /sender/ in a build", () => {
    expect(readEnv({ VITE_OTHER_APP_URL: "https://pay.example" }).otherAppUrl).toBe("https://pay.example");
    expect(readEnv({ DEV: true }).otherAppUrl).toBe("http://localhost:5174");
    expect(readEnv({ DEV: false }).otherAppUrl).toBe("/sender/");
  });

  it("apiFromRelayUrl ignores junk", () => {
    expect(apiFromRelayUrl("")).toBe("");
    expect(apiFromRelayUrl("not a url")).toBe("");
  });
});
