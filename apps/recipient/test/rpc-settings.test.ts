import { describe, expect, it } from "vitest";
import { defaultSettings, settingsOf } from "../src/vault/types.js";

describe("saved RPC settings", () => {
  it("a public RPC saved as a default yields to the configured RPC; a custom one is kept", () => {
    const d = defaultSettings();
    const legacy = settingsOf({ settings: { ...d, rpcUrl: "https://sepolia.base.org", l1RpcUrl: "https://ethereum-sepolia-rpc.publicnode.com" } });
    expect(legacy.rpcUrl).toBe(d.rpcUrl);
    expect(legacy.l1RpcUrl).toBe(d.l1RpcUrl);
    const custom = settingsOf({ settings: { ...d, rpcUrl: "https://my-node.example/rpc" } });
    expect(custom.rpcUrl).toBe("https://my-node.example/rpc");
  });
});
