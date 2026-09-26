import { describe, expect, it, vi } from "vitest";
import { keccak256, toBytes } from "viem";
import { backupMessage, base64DecodedLength, httpBackupClient, isBackupCiphertext } from "../src/backup.js";

const ADDR = "0x19e7e376e7c213b7e7e7e46cc70a5dd086daff2a";

describe("backup contract", () => {
  it("builds the exact signed string with a checksummed address", () => {
    const ct = "aGVsbG8=";
    expect(backupMessage({ address: ADDR, version: 3, ciphertext: ct })).toBe(
      `soapay-backup:v1:0x19E7E376E7C213B7E7e7e46cc70A5dD086DAff2A:3:${keccak256(toBytes(ct))}`,
    );
    expect(() => backupMessage({ address: ADDR, version: 0, ciphertext: ct })).toThrow();
  });

  it("validates base64 and measures decoded size", () => {
    expect(isBackupCiphertext("aGVsbG8=")).toBe(true);
    expect(isBackupCiphertext("aGVsbG8")).toBe(false);
    expect(isBackupCiphertext("")).toBe(false);
    expect(isBackupCiphertext("a-b_")).toBe(false);
    expect(base64DecodedLength("aGVsbG8=")).toBe(5);
    expect(base64DecodedLength("A".repeat(1334) + "==")).toBe(1000);
    expect(base64DecodedLength("AAAA".repeat(250))).toBe(750);
  });

  it("http client maps 404 to null and 409 to the current version", async () => {
    const fetchFn = vi.fn(async (_u: string | URL | Request, init?: RequestInit) =>
      init?.method === "PUT"
        ? new Response(JSON.stringify({ error: { code: "stale_version", message: "stale" }, version: 7 }), { status: 409 })
        : new Response(JSON.stringify({ error: { code: "not_found", message: "none" } }), { status: 404 }),
    );
    const c = httpBackupClient("https://api.example/", fetchFn as typeof fetch);
    expect(await c.get(ADDR)).toBeNull();
    expect(fetchFn.mock.calls[0]![0]).toBe("https://api.example/backups/0x19E7E376E7C213B7E7e7e46cc70A5dD086DAff2A");
    expect(await c.put({ address: ADDR, version: 2, ciphertext: "aGVsbG8=", signature: "0x01" })).toEqual({
      ok: false,
      code: "stale_version",
      currentVersion: 7,
    });
  });
});
