// Encrypted backup of the company vault to the Soapay API (D-62, docs/mvp-spec.md §4).
//
// The API gets only the vault's encrypted envelope (sealed records + KDF metadata, no key),
// stored under the employer's wallet address. Every write is personal_signed by that wallet and
// carries a strictly higher version, so nobody else can overwrite it and it can't be rolled back.
//
// When to sync: the API verifies the wallet's own signature on every write, so each backup costs
// one wallet prompt (a session key can't stand in for the wallet). So the app backs up at the
// moments that matter, not on every save: after recipients are enrolled or re-pinned, after
// invites change, after a pay run is recorded, and on "Back up now" in Settings. Bursts collapse
// into one prompt (2 s debounce), nothing is prompted while a pay run is executing, and demo and
// dev-mock modes never touch the network.
import { BACKUP_MAX_BYTES, backupMessage, type BackupClient, type StoredBackup } from "@soapay/sdk";
import { getAddress, type Address } from "viem";
import { envelopeInfo, type EnvelopeInfo, type KV, type Vault, type WalletSigner } from "./vault.js";

/** Plain (not secret) bookkeeping kept next to the vault in the same KV. */
export type SyncState = {
  /** The wallet whose backup slot this vault syncs to. */
  owner?: Address;
  /** Version of the last backup this browser wrote or restored (0 = none). */
  version: number;
  /** Unix ms of the last successful backup or restore. */
  lastBackupAt?: number;
  /** Local changes not backed up yet. */
  dirty: boolean;
};

const SYNC = "sync";

export async function readSync(kv: KV): Promise<SyncState> {
  const s = (await kv.get(SYNC)) as Partial<SyncState> | undefined;
  return { version: 0, dirty: false, ...s };
}

export async function writeSync(kv: KV, patch: Partial<SyncState>): Promise<SyncState> {
  const next = { ...(await readSync(kv)), ...patch };
  await kv.set(SYNC, next);
  return next;
}

export type BackupOutcome =
  | { status: "saved"; version: number; at: number }
  | { status: "unsupported" }
  | { status: "no-wallet" }
  | { status: "wrong-wallet"; owner: Address }
  | { status: "too-large"; bytes: number }
  /** A newer backup (from another browser) exists; nothing was signed. Retry with `replace`. */
  | { status: "conflict"; remoteVersion: number }
  | { status: "declined" }
  | { status: "error"; message: string };

export function isUserRejection(e: unknown): boolean {
  const err = e as { code?: number; name?: string; shortMessage?: string; message?: string; cause?: unknown } | null;
  if (!err) return false;
  if (err.code === 4001 || err.name === "UserRejectedRequestError") return true;
  const text = `${err.shortMessage ?? ""} ${err.message ?? ""}`.toLowerCase();
  if (/user (rejected|denied|cancel)|rejected the request|request rejected/.test(text)) return true;
  return err.cause ? isUserRejection(err.cause) : false;
}

/** Decoded size of the base64 envelope. */
const decodedBytes = (b64: string) => Math.floor((b64.length * 3) / 4) - (b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0);

/**
 * Backs the vault up once (one wallet prompt). Checks the stored version first, so a newer backup
 * from another browser is never overwritten silently and no prompt is wasted: pass `replace` to
 * overwrite it on purpose.
 */
export async function backupNow(args: {
  vault: Vault;
  kv: KV;
  client: BackupClient;
  signer: WalletSigner | null;
  now?: () => number;
  replace?: boolean;
}): Promise<BackupOutcome> {
  const { vault, kv, client, signer } = args;
  const now = args.now ?? Date.now;
  if (!vault.syncable) return { status: "unsupported" };
  if (!signer) return { status: "no-wallet" };
  const sync = await readSync(kv);
  const owner = getAddress(sync.owner ?? vault.wallet ?? signer.address);
  if (owner !== getAddress(signer.address)) return { status: "wrong-wallet", owner };
  try {
    const ciphertext = await vault.exportEnvelope();
    const bytes = decodedBytes(ciphertext);
    if (bytes > BACKUP_MAX_BYTES) return { status: "too-large", bytes };
    const remote = await client.get(owner);
    if (remote && remote.version > sync.version && !args.replace) return { status: "conflict", remoteVersion: remote.version };
    const version = Math.max(sync.version, remote?.version ?? 0) + 1;
    let signature;
    try {
      signature = await signer.signMessage(backupMessage({ address: owner, version, ciphertext }));
    } catch (e) {
      if (isUserRejection(e)) return { status: "declined" };
      throw e;
    }
    const res = await client.put({ address: owner, version, ciphertext, signature });
    if (!res.ok) {
      if (res.code === "stale_version" && "currentVersion" in res) return { status: "conflict", remoteVersion: res.currentVersion };
      return { status: "error", message: "message" in res ? res.message : res.code };
    }
    const at = now();
    await writeSync(kv, { owner, version: res.version, lastBackupAt: at, dirty: false });
    return { status: "saved", version: res.version, at };
  } catch (e) {
    return { status: "error", message: (e as { shortMessage?: string }).shortMessage ?? (e as Error).message ?? String(e) };
  }
}

/** A backup found for the connected wallet on a browser with no vault. */
export type FoundBackup = StoredBackup & { info: EnvelopeInfo };

export async function findBackup(client: BackupClient, address: Address): Promise<FoundBackup | null> {
  const b = await client.get(address);
  if (!b) return null;
  return { ...b, info: envelopeInfo(b.ciphertext) };
}

/** Human line for Settings: what the last backup attempt did. */
export function describeOutcome(o: BackupOutcome): string {
  switch (o.status) {
    case "saved":
      return `Backed up (version ${o.version})`;
    case "unsupported":
      return "A device-key vault can't be backed up. Lock it with your wallet to turn backups on.";
    case "no-wallet":
      return "Connect your wallet to back up";
    case "wrong-wallet":
      return `This vault backs up to ${o.owner}; connect that wallet`;
    case "too-large":
      return `The vault is too large to back up (${Math.round(o.bytes / 1024)} KiB, limit ${BACKUP_MAX_BYTES / 1024} KiB)`;
    case "conflict":
      return `A newer backup (version ${o.remoteVersion}) exists from another browser. Back up now to replace it with this browser's data.`;
    case "declined":
      return "Backup skipped: the signature was declined";
    case "error":
      return `Backup failed: ${o.message}`;
  }
}
