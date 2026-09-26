// Encrypted backups (docs/mvp-spec.md §4, D-62): the shared contract between the apps and
// `PUT/GET /backups/:address`. The API stores an opaque base64 ciphertext per wallet and never
// sees plaintext or keys; a write must be signed (EIP-191) by that wallet and carry a strictly
// higher version, so nobody else can overwrite a backup and nobody can roll one back.
import { getAddress, keccak256, toBytes, type Address, type Hex } from "viem";

/** Largest accepted ciphertext, in decoded bytes (512 KiB). */
export const BACKUP_MAX_BYTES = 512 * 1024;

const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

/** True for canonical (padded, standard-alphabet) base64. The empty string is not a backup. */
export function isBackupCiphertext(v: unknown): v is string {
  return typeof v === "string" && v.length > 0 && v.length % 4 === 0 && BASE64.test(v);
}

/** Decoded byte length of a canonical base64 string (no decoding needed). */
export function base64DecodedLength(b64: string): number {
  const pad = b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0;
  return (b64.length / 4) * 3 - pad;
}

/**
 * The exact string the wallet personal_signs (EIP-191) to write a backup:
 * `soapay-backup:v1:<checksummed address>:<version>:<keccak256(utf8 ciphertext)>`.
 */
export function backupMessage(args: { address: Address; version: number; ciphertext: string }): string {
  if (!Number.isSafeInteger(args.version) || args.version < 1) throw new Error("Soapay: backup version must be a positive integer");
  return `soapay-backup:v1:${getAddress(args.address)}:${args.version}:${keccak256(toBytes(args.ciphertext))}`;
}

export type StoredBackup = { address: Address; version: number; ciphertext: string; updatedAt: number };

export type PutBackupResult =
  | { ok: true; address: Address; version: number }
  | { ok: false; code: "stale_version"; currentVersion: number }
  | { ok: false; code: string; message: string };

export type BackupClient = {
  /** The stored backup, or null when the wallet has none (404). Throws on other errors. */
  get(address: Address): Promise<StoredBackup | null>;
  put(args: { address: Address; version: number; ciphertext: string; signature: Hex }): Promise<PutBackupResult>;
};

/** A small fetch client for the backup endpoint. `apiUrl` is the API base (no trailing slash needed). */
export function httpBackupClient(apiUrl: string, fetchFn: typeof fetch = (u, i) => fetch(u, i)): BackupClient {
  const base = apiUrl.replace(/\/+$/, "");
  const url = (a: Address) => `${base}/backups/${getAddress(a)}`;
  return {
    async get(address) {
      const r = await fetchFn(url(address), { headers: { accept: "application/json" } });
      if (r.status === 404) return null;
      const body = (await r.json().catch(() => null)) as (StoredBackup & { error?: { message?: string } }) | null;
      if (!r.ok || !body) throw new Error(body?.error?.message ?? `Backup lookup failed (${r.status})`);
      return { address: getAddress(body.address), version: body.version, ciphertext: body.ciphertext, updatedAt: body.updatedAt };
    },
    async put({ address, version, ciphertext, signature }) {
      const r = await fetchFn(url(address), {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ version, ciphertext, signature }),
      });
      const body = (await r.json().catch(() => null)) as
        | { address?: Address; version?: number; error?: { code?: string; message?: string } }
        | null;
      if (r.ok && body?.address) return { ok: true, address: getAddress(body.address), version: body.version ?? version };
      const code = body?.error?.code ?? `http_${r.status}`;
      if (code === "stale_version") return { ok: false, code, currentVersion: body?.version ?? 0 };
      return { ok: false, code, message: body?.error?.message ?? `Backup failed (${r.status})` };
    },
  };
}
