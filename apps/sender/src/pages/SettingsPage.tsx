import type { SettingsState } from "../hooks/useSettings.js";
import type { VaultMode } from "../lib/vault.js";
import { Banner, Button, Card, Input } from "../ui/kit.js";

export type SettingsPageProps = SettingsState & {
  chainName(id: number): string;
  attester: string | undefined;
  apiUrl: string | undefined;
  mockEns: boolean;
  vaultMode: VaultMode | null;
  onLock(): void;
  onDestroyVault(): void;
};

/** Props-only: chain, StealthDisperse address and RPCs (per browser), plus vault controls. */
export function SettingsPage(p: SettingsPageProps) {
  return (
    <div className="flex flex-col gap-4">
      <Card title="Network">
        <div className="grid max-w-xl grid-cols-[10rem_1fr] items-center gap-2 text-sm">
          <label>Chain</label>
          <select
            className="rounded border border-slate-300 px-2 py-1.5"
            value={p.form.chainId}
            onChange={(e) => p.set("chainId", Number(e.target.value) as typeof p.form.chainId)}
          >
            {p.chainIds.map((id) => (
              <option key={id} value={id}>{p.chainName(id)}</option>
            ))}
          </select>
          <label>StealthDisperse</label>
          <Input className="font-mono" placeholder="0x… (empty = EIP-5792 path only)" value={p.form.stealthDisperse} onChange={(e) => p.set("stealthDisperse", e.target.value)} />
          <label>RPC URL</label>
          <Input placeholder="Public default" value={p.form.rpcUrl} onChange={(e) => p.set("rpcUrl", e.target.value)} />
          <label>ENS RPC URL</label>
          <Input placeholder="Public default" value={p.form.ensRpcUrl} onChange={(e) => p.set("ensRpcUrl", e.target.value)} />
        </div>
        {p.error && <div className="mt-3"><Banner tone="error">{p.error}</Banner></div>}
        <div className="mt-3 flex gap-2">
          <Button onClick={p.save}>Save and reload</Button>
          <Button variant="ghost" onClick={p.reset}>Reset to defaults</Button>
        </div>
      </Card>
      <Card title="Build-time">
        <div className="text-sm">
          <div>Pinned attester: <span className="font-mono">{p.mockEns ? "mock attester (dev)" : p.attester ?? "none: every key rotation needs your manual approval"}</span></div>
          <div>API: {p.apiUrl ?? "not set"}</div>
          {p.mockEns && <div className="mt-2"><Banner tone="warn">Dev mock mode: names resolve to demo keys.</Banner></div>}
        </div>
      </Card>
      <Card title="Vault">
        <div className="mb-2 text-sm">Mode: {p.vaultMode ?? "none"}</div>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={p.onLock}>Lock</Button>
          <Button
            variant="danger"
            onClick={() => confirm("Delete the roster and all run history from this browser? This can't be undone.") && p.onDestroyVault()}
          >
            Delete vault
          </Button>
        </div>
      </Card>
    </div>
  );
}
