import { describe, expect, it, vi } from "vitest";
import { SIGN_MESSAGE, SignatureKeysUnsupported, keysFromSignature } from "@soapay/sdk";
import { privateKeyToAccount } from "viem/accounts";
import { demoEoaWallet, demoSmartWallet, deriveWalletKeys, injectedKeyWallet, type Eip1193 } from "../src/onboarding/walletKeys.js";
import { reduce } from "../src/onboarding/machine.js";
import { newVaultData, vaultKeys, hasRecoveryPhrase } from "../src/vault/types.js";

const eoa = privateKeyToAccount("0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba");

/** A fake injected provider backed by a local EOA, with configurable code. */
function fakeProvider(code: `0x${string}` = "0x", sign = (m: string) => eoa.signMessage({ message: m })): Eip1193 & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async request({ method, params }) {
      calls.push(method);
      if (method === "eth_requestAccounts") return [eoa.address];
      if (method === "eth_getCode") return code;
      if (method === "personal_sign") {
        const hex = (params as string[])[0]!;
        const text = new TextDecoder().decode(Uint8Array.from(Buffer.from(hex.slice(2), "hex")));
        return sign(text);
      }
      throw new Error(`unexpected ${method}`);
    },
  };
}

describe("wallet-signature keys, recovery of older accounts (plain EOAs only)", () => {
  it("a plain EOA signs twice and gets the SDK's keys; the vault stores the signature, not a phrase", async () => {
    const p = fakeProvider();
    const { secret, keys } = await deriveWalletKeys(injectedKeyWallet(p));
    expect(p.calls).toEqual(["eth_requestAccounts", "eth_getCode", "personal_sign", "personal_sign"]);
    expect(secret).toEqual({ kind: "wallet-signature", signature: await eoa.signMessage({ message: SIGN_MESSAGE }), wallet: eoa.address });
    expect(keys).toEqual(keysFromSignature(secret.signature));

    const data = newVaultData(secret);
    expect(data.mnemonic).toBe("");
    expect(data.walletKeys).toEqual(secret);
    expect(vaultKeys(data)).toEqual(keys);
    expect(hasRecoveryPhrase(data)).toBe(false);
  });

  it("refuses an account with code BEFORE asking for any signature", async () => {
    const p = fakeProvider("0x6080604052");
    await expect(deriveWalletKeys(injectedKeyWallet(p))).rejects.toBeInstanceOf(SignatureKeysUnsupported);
    expect(p.calls).not.toContain("personal_sign");
  });

  it("refuses when the account has code on the payroll chain even if not on the wallet's chain", async () => {
    const p = fakeProvider("0x");
    const extra = vi.fn(async () => "0xef0100aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as const);
    await expect(deriveWalletKeys(injectedKeyWallet(p, extra))).rejects.toThrow(/smart account/);
    expect(extra).toHaveBeenCalledWith(eoa.address);
    expect(p.calls).not.toContain("personal_sign");
  });

  it("refuses a wallet whose second signature differs", async () => {
    let n = 0;
    const other = privateKeyToAccount("0x0dbbe8e4ae425a6d2687f1a7e3ba17bc98c673636790f1b8ad91193c05875ef1");
    const p = fakeProvider("0x", (m) => (n++ === 0 ? eoa.signMessage({ message: m }) : other.signMessage({ message: m })));
    await expect(deriveWalletKeys(injectedKeyWallet(p))).rejects.toMatchObject({ reason: "not-deterministic" });
  });

  it("mock demo wallets: the EOA works, the smart wallet is refused", async () => {
    await expect(deriveWalletKeys(demoEoaWallet())).resolves.toMatchObject({ secret: { kind: "wallet-signature" } });
    await expect(deriveWalletKeys(demoSmartWallet())).rejects.toMatchObject({ reason: "has-code" });
  });

  it("the machine routes restore → wallet → passphrase and back (D-45: recovery of older accounts only)", () => {
    const wallet = { kind: "wallet-signature" as const, signature: "0x01" as const, wallet: eoa.address };
    expect(reduce({ step: "welcome" }, { type: "USE_WALLET" })).toEqual({ step: "welcome" });
    let s = reduce({ step: "restore", error: null }, { type: "USE_WALLET" });
    expect(s).toEqual({ step: "wallet", error: null });
    s = reduce(s, { type: "WALLET_FAILED", error: "nope" });
    expect(s).toEqual({ step: "wallet", error: "nope" });
    s = reduce(s, { type: "WALLET_SIGNED", wallet });
    expect(s).toEqual({ step: "passphrase", mnemonic: "", origin: "wallet", wallet });
    expect(reduce(s, { type: "BACK" })).toEqual({ step: "wallet", error: null });
    expect(reduce(s, { type: "VAULT_CREATED" })).toEqual({ step: "register" });
    expect(reduce({ step: "wallet", error: null }, { type: "BACK" })).toEqual({ step: "restore", error: null });
  });
});
