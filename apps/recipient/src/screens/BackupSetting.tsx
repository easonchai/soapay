import { Button } from "../ui/kit.js";
import { useBackupSync, type BackupStatus } from "../vault/BackupSync.js";

function when(at: number): string {
  const d = new Date(at);
  return d.toDateString() === new Date().toDateString() ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : d.toLocaleString();
}

function line(s: BackupStatus): string {
  switch (s.kind) {
    case "idle":
      return "Checking backup…";
    case "pending":
      return "Backing up changes…";
    case "syncing":
      return "Backing up…";
    case "synced":
      return `Backed up ${when(s.at)}`;
    case "error":
      return `Backup failed: ${s.message}`;
    case "off":
      if (s.reason === "passphrase") return "Backup off: this vault is locked with a passphrase. Switch to a passkey to back it up.";
      if (s.reason === "no-api") return "Backup off: no Soapay API is set (Network settings).";
      return "Backup off: this passkey doesn't support it";
  }
}

/**
 * Settings → This device (D-63): the passkey-synced backup and whether the browser keeps our storage.
 * With a backup, "Unlock with passkey" on a new device (or after clearing site data) brings the vault back.
 */
export function BackupSetting() {
  const b = useBackupSync();
  if (!b) return null;
  const { status, persisted } = b;
  return (
    <div className="stack-sm" data-testid="backup-setting">
      <p className="muted" data-testid="backup-status">
        {line(status)}
      </p>
      {status.kind === "off" && status.reason === "unsupported" && (
        <p className="text-xs text-muted-foreground">
          Sync is off on this device. Keep your recovery kit: it's the only way back if this browser's data is cleared.
        </p>
      )}
      {status.kind === "error" && (
        <div className="actions">
          <Button size="sm" variant="outline" onClick={() => void b.syncNow()}>
            Retry backup
          </Button>
        </div>
      )}
      <p className="text-xs text-muted-foreground" data-testid="storage-persisted">
        {persisted === true
          ? "This browser keeps Soapay's storage (persistent)."
          : persisted === false
            ? "This browser may clear Soapay's storage when space runs low (not persistent)."
            : "Storage persistence: unknown in this browser."}
      </p>
      <p className="text-xs text-muted-foreground">
        The backup is encrypted on this device with your passkey before it's sent; the Soapay API can't read it.
      </p>
    </div>
  );
}
