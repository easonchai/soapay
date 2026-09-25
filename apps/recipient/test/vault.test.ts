import { describe, expect, it } from "vitest";
import {
  MIN_PASSPHRASE_LENGTH,
  VaultFormatError,
  WrongPassphraseError,
  createVault,
  fromBase64,
  openVault,
  sealWithKey,
  toBase64,
} from "../src/vault/crypto.js";
import { newVaultData, settingsOf, swapProxyUrl } from "../src/vault/types.js";

const PASS = "correct horse battery";

describe("vault crypto", () => {
  it("round-trips and never stores the mnemonic in plaintext", async () => {
    const data = newVaultData("abandon ".repeat(11) + "about");
    const v = await createVault(data, PASS);
    expect(JSON.stringify(v.envelope)).not.toContain("abandon");
    const opened = await openVault<typeof data>(v.envelope, PASS);
    expect(opened.data.mnemonic).toBe(data.mnemonic);
  });

  it("rejects a wrong passphrase", async () => {
    const v = await createVault({ a: 1 }, PASS);
    await expect(openVault(v.envelope, "wrong passphrase!")).rejects.toBeInstanceOf(WrongPassphraseError);
  });

  it("rejects a tampered ciphertext and a tampered header (AAD)", async () => {
    const v = await createVault({ a: 1 }, PASS);
    const ct = fromBase64(v.envelope.ciphertext);
    ct[0] = ct[0]! ^ 1;
    await expect(openVault({ ...v.envelope, ciphertext: toBase64(ct) }, PASS)).rejects.toBeInstanceOf(WrongPassphraseError);
    // Same key, but the header claims a different iteration count: the AAD no longer matches.
    await expect(openVault({ ...v.envelope, kdf: { ...v.envelope.kdf, iterations: 600_001 } }, PASS)).rejects.toBeInstanceOf(WrongPassphraseError);
  });

  it("re-seals with a fresh IV each time", async () => {
    const v = await createVault({ a: 1 }, PASS);
    const a = await sealWithKey({ a: 2 }, v.key, v.kdf);
    const b = await sealWithKey({ a: 2 }, v.key, v.kdf);
    expect(a.cipher.iv).not.toBe(b.cipher.iv);
    expect((await openVault<{ a: number }>(b, PASS)).data.a).toBe(2);
  });

  it("refuses an envelope that downgrades the KDF", async () => {
    const v = await createVault({ a: 1 }, PASS);
    await expect(openVault({ ...v.envelope, kdf: { ...v.envelope.kdf, iterations: 1_000 } }, PASS)).rejects.toBeInstanceOf(VaultFormatError);
  });

  it("refuses short passphrases and foreign files", async () => {
    await expect(createVault({}, "x".repeat(MIN_PASSPHRASE_LENGTH - 1))).rejects.toThrow(/at least/);
    await expect(openVault({ format: "nope" } as never, PASS)).rejects.toBeInstanceOf(VaultFormatError);
  });
});

describe("settings", () => {
  it("fills defaults for old vaults and drops the legacy client-side Uniswap key", () => {
    const s = settingsOf({ settings: { chainId: 84532, apiUrl: "https://api.x", uniswapApiKey: "secret" } as never });
    expect("uniswapApiKey" in s).toBe(false);
    expect(s.knownPayers).toEqual([]);
    expect(typeof s.swapViaApi).toBe("boolean");
  });

  it("routes Convert through the API proxy only when enabled", () => {
    expect(swapProxyUrl({ apiUrl: "https://api.x/", swapViaApi: true })).toBe("https://api.x/uniswap");
    expect(swapProxyUrl({ apiUrl: "https://api.x", swapViaApi: false })).toBe("");
  });
});
