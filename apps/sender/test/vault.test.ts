import { describe, expect, it } from "vitest";
import type { Address, Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  base64ToBytes,
  envelopeInfo,
  memoryKV,
  probeWalletKey,
  Vault,
  VaultError,
  walletVaultMessage,
  type WalletSigner,
} from "../src/lib/vault.js";

const FAST = { iterations: 1000 };

describe("Vault", () => {
  it("device mode: round-trips bigint data and stores only ciphertext", async () => {
    const kv = memoryKV();
    const v = await Vault.create(kv, "device");
    const roster = [{ ensName: "alice.soapay.eth", amount: 5_000_000_000n }];
    await v.write("roster", roster);
    const raw = await v.rawForTest("roster");
    expect(new TextDecoder().decode((raw as { ct: Uint8Array }).ct)).not.toContain("alice");
    const reopened = await Vault.unlock(kv);
    expect(await reopened.read("roster")).toEqual(roster);
    expect(reopened.mode).toBe("device");
  });

  it("passphrase mode: wrong passphrase is refused", async () => {
    const kv = memoryKV();
    const v = await Vault.create(kv, "passphrase", "correct horse battery", FAST);
    await v.write("history", { n: 1n });
    await expect(Vault.unlock(kv, "wrong passphrase!", FAST)).rejects.toMatchObject({ code: "WrongPassphrase" });
    expect(await (await Vault.unlock(kv, "correct horse battery", FAST)).read("history")).toEqual({ n: 1n });
  });

  it("rejects short passphrases and double creation", async () => {
    const kv = memoryKV();
    await expect(Vault.create(kv, "passphrase", "short", FAST)).rejects.toBeInstanceOf(VaultError);
    await Vault.create(kv, "device");
    await expect(Vault.create(kv, "device")).rejects.toMatchObject({ code: "Exists" });
  });

  it("binds records to their slot", async () => {
    const kv = memoryKV();
    const v = await Vault.create(kv, "device");
    await v.write("roster", [1]);
    await kv.set("rec:history", await kv.get("rec:roster"));
    await expect(v.read("history")).rejects.toMatchObject({ code: "Corrupt" });
  });
});

describe("Vault: wallet-signature lock and backup envelope (D-62)", () => {
  // RFC 6979: a local-key signer signs the same message identically every time (like an EOA or a 7702 account).
  const account = privateKeyToAccount("0x9999999999999999999999999999999999999999999999999999999999999999");
  const signer: WalletSigner = { address: account.address, signMessage: (message) => account.signMessage({ message }) };
  const otherAccount = privateKeyToAccount("0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
  const otherSigner: WalletSigner = { address: otherAccount.address, signMessage: (message) => otherAccount.signMessage({ message }) };
  /** A passkey smart wallet: a fresh signature every time. */
  const randomSigner: WalletSigner = {
    address: account.address,
    signMessage: async () => `0x${Buffer.from(crypto.getRandomValues(new Uint8Array(65))).toString("hex")}` as Hex,
  };
  const CHAIN = 84532;

  async function walletVault(kv = memoryKV()) {
    const probe = await probeWalletKey(signer, CHAIN);
    expect(probe.deterministic).toBe(true);
    const v = await Vault.create(kv, "wallet", undefined, { wallet: { address: signer.address, chainId: CHAIN, signature: probe.signature } });
    return { kv, v };
  }

  it("detects deterministic vs non-deterministic wallets by signing twice", async () => {
    expect((await probeWalletKey(signer, CHAIN)).deterministic).toBe(true);
    expect((await probeWalletKey(randomSigner, CHAIN)).deterministic).toBe(false);
    expect(walletVaultMessage(account.address.toLowerCase() as Address, CHAIN)).toBe(
      `Soapay company vault\n\nSign to unlock your payroll data on this device. This signature never leaves your browser.\n\nWallet: ${account.address}\nChain: ${CHAIN}`,
    );
  });

  it("wallet mode: the same wallet unlocks it; another wallet can't", async () => {
    const { kv, v } = await walletVault();
    await v.write("roster", [{ n: 1n }]);
    expect(await Vault.status(kv)).toEqual({ exists: true, mode: "wallet", wallet: account.address });
    const reopened = await Vault.unlock(kv, signer);
    expect(await reopened.read("roster")).toEqual([{ n: 1n }]);
    await expect(Vault.unlock(kv, otherSigner)).rejects.toMatchObject({ code: "WrongWallet" });
    await expect(Vault.unlock(kv)).rejects.toMatchObject({ code: "NoWallet" });
    // Same address, different signature (a passkey wallet): the check fails.
    await expect(Vault.unlock(kv, randomSigner)).rejects.toMatchObject({ code: "WrongWallet" });
  });

  it("exports an envelope without the key and restores it into an empty browser", async () => {
    const { v } = await walletVault();
    await v.write("roster", [{ ensName: "alice.soapay.eth", amount: 5_000_000_000n }]);
    await v.write("runs", [{ id: "r1" }]);
    const env = await v.exportEnvelope();
    const text = new TextDecoder().decode(base64ToBytes(env));
    expect(text).not.toContain("alice");
    expect(envelopeInfo(env)).toEqual({ mode: "wallet", wallet: account.address, chainId: CHAIN });

    const fresh = memoryKV();
    await expect(Vault.restore(fresh, env, otherSigner)).rejects.toMatchObject({ code: "WrongWallet" });
    expect(await fresh.keys()).toEqual([]); // nothing written on failure
    const restored = await Vault.restore(fresh, env, signer);
    expect(await restored.read("roster")).toEqual([{ ensName: "alice.soapay.eth", amount: 5_000_000_000n }]);
    expect(await (await Vault.unlock(fresh, signer)).read("runs")).toEqual([{ id: "r1" }]);
  });

  it("passphrase vaults back up too; restoring asks for the passphrase", async () => {
    const v = await Vault.create(memoryKV(), "passphrase", "correct horse battery", FAST);
    await v.write("invites", [{ code: "0x01" }]);
    const env = await v.exportEnvelope();
    expect(envelopeInfo(env).mode).toBe("passphrase");
    const fresh = memoryKV();
    await expect(Vault.restore(fresh, env, "wrong passphrase!", FAST)).rejects.toMatchObject({ code: "WrongPassphrase" });
    expect(await Vault.status(fresh)).toEqual({ exists: false });
    expect(await (await Vault.restore(fresh, env, "correct horse battery", FAST)).read("invites")).toEqual([{ code: "0x01" }]);
  });

  it("a device-key vault can't be exported, but can be re-locked with the wallet", async () => {
    const kv = memoryKV();
    const v = await Vault.create(kv, "device");
    await v.write("roster", ["bob"]);
    await expect(v.exportEnvelope()).rejects.toBeInstanceOf(VaultError);
    const probe = await probeWalletKey(signer, CHAIN);
    const w = await v.rekey("wallet", undefined, { wallet: { address: signer.address, chainId: CHAIN, signature: probe.signature } });
    expect(w.mode).toBe("wallet");
    expect(await kv.get("deviceKey")).toBeUndefined();
    expect(await (await Vault.unlock(kv, signer)).read("roster")).toEqual(["bob"]);
    await expect(w.exportEnvelope()).resolves.toMatch(/^[A-Za-z0-9+/=]+$/);
  });
});
