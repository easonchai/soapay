import { describe, expect, it } from "vitest";
import { memoryKV, Vault, VaultError } from "../src/lib/vault.js";

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
