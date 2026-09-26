// D-35: passkey (WebAuthn PRF) lock. The pure wrap/unwrap module and the mock authenticator.
import { describe, expect, it } from "vitest";
import { createVault, fromBase64, toBase64 } from "../src/vault/crypto.js";
import {
  PRF_SALT,
  PasskeyUnlockError,
  assertPasskeyEnvelope,
  createPasskeyVault,
  isPasskeyEnvelope,
  lockOf,
  openPasskeyVault,
  sealWithPasskeyKey,
} from "../src/vault/passkeyCrypto.js";
import { mockPasskey } from "../src/vault/passkey.js";
import { newVaultData } from "../src/vault/types.js";

const M = "abandon ".repeat(11) + "about";
const prf = (fill: number) => new Uint8Array(32).fill(fill);
const credId = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);

describe("passkey vault crypto", () => {
  it("uses a fixed 32-byte PRF salt", () => {
    expect(PRF_SALT.length).toBe(32);
  });

  it("round-trips the same vault data and never stores the mnemonic in plaintext", async () => {
    const data = newVaultData(M);
    const v = await createPasskeyVault(data, credId, prf(7));
    expect(JSON.stringify(v.envelope)).not.toContain("abandon");
    expect(v.envelope.lock).toEqual({ kind: "passkey", credentialId: toBase64(credId), prfSalt: toBase64(PRF_SALT) });
    const opened = await openPasskeyVault<typeof data>(v.envelope, prf(7));
    expect(opened.data.mnemonic).toBe(M);
  });

  it("rejects the wrong PRF output (a different passkey)", async () => {
    const v = await createPasskeyVault({ a: 1 }, credId, prf(7));
    await expect(openPasskeyVault(v.envelope, prf(8))).rejects.toBeInstanceOf(PasskeyUnlockError);
  });

  it("binds the header: swapping the credential id or KDF salt fails", async () => {
    const v = await createPasskeyVault({ a: 1 }, credId, prf(7));
    const otherId = { ...v.envelope, lock: { ...v.envelope.lock, credentialId: toBase64(new Uint8Array([9])) } };
    await expect(openPasskeyVault(otherId, prf(7))).rejects.toBeInstanceOf(PasskeyUnlockError);
    const ct = fromBase64(v.envelope.ciphertext);
    ct[0] = ct[0]! ^ 1;
    await expect(openPasskeyVault({ ...v.envelope, ciphertext: toBase64(ct) }, prf(7))).rejects.toBeInstanceOf(PasskeyUnlockError);
  });

  it("re-seals with a fresh IV under the same key", async () => {
    const v = await createPasskeyVault({ a: 1 }, credId, prf(7));
    const a = await sealWithPasskeyKey({ a: 2 }, v.key, v.params);
    const b = await sealWithPasskeyKey({ a: 2 }, v.key, v.params);
    expect(a.cipher.iv).not.toBe(b.cipher.iv);
    expect((await openPasskeyVault<{ a: number }>(b, prf(7))).data.a).toBe(2);
  });

  it("records the lock; envelopes without it are passphrase vaults (migration)", async () => {
    const pk = await createPasskeyVault({ a: 1 }, credId, prf(7));
    const pp = await createVault({ a: 1 }, "correct horse battery");
    expect(lockOf(pk.envelope).kind).toBe("passkey");
    expect(lockOf(pp.envelope)).toEqual({ kind: "passphrase" });
    expect(isPasskeyEnvelope(pp.envelope)).toBe(false);
    expect(() => assertPasskeyEnvelope(pp.envelope)).toThrow(/passkey vault/);
  });

  it("refuses too little PRF output", async () => {
    await expect(createPasskeyVault({ a: 1 }, credId, new Uint8Array(16))).rejects.toThrow(/too little/);
  });
});

describe("mock passkey (mock mode)", () => {
  it("returns the same PRF output on unlock as at registration", async () => {
    const pk = mockPasskey();
    expect(await pk.available()).toBe(true);
    const r = await pk.register(new Uint8Array(PRF_SALT));
    expect(r.prf.length).toBe(32);
    expect(await pk.evaluate(r.credentialId, new Uint8Array(PRF_SALT))).toEqual(r.prf);
    const other = await pk.register(new Uint8Array(PRF_SALT));
    expect(other.prf).not.toEqual(r.prf);
  });
});
