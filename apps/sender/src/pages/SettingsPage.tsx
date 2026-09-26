import { useState } from "react";
import { ErrorLine, PageHead, toast } from "@soapay/ui";
import type { SettingsState } from "../hooks/useSettings.js";
import { isTestnetChain } from "@soapay/sdk";
import { defaultChunkUsdc, type AppConfig } from "../config.js";
import { tryParseUsdc } from "../lib/amount.js";
import type { VaultMode } from "../lib/vault.js";
import { Notice } from "../ui/kit.js";

export type SettingsPageProps = SettingsState & {
  app: AppConfig;
  chainName(id: number): string;
  org: string;
  onOrgChange(v: string): void;
  /** Company-wide denomination chunk size (D-31), USDC as typed. */
  chunk?: string;
  onChunkChange(v: string): void;
  vaultMode: VaultMode | null;
  counts: { employees: number; invites: number; runs: number };
  onLock(): void;
  onDestroyVault(): void;
};

/** CK's Settings (company name, network facts) plus ours: per-browser chain, StealthDisperse and RPCs, attester, vault. */
export function SettingsPage(p: SettingsPageProps) {
  const [name, setName] = useState(p.org);
  const { app } = p;
  const testnet = isTestnetChain(app.chainId);
  const defaultChunk = defaultChunkUsdc(app.chainId);
  const [chunk, setChunk] = useState(p.chunk ?? defaultChunk);
  return (
    <div className="stack-lg" style={{ maxWidth: 760, margin: "0 auto" }}>
      <PageHead eyebrow="Settings" title="Where this app points, and what it keeps" line="Network values can be overridden per browser. The roster and history stay encrypted here." />

      <h2>Company</h2>
      <div className="panel panel-pad">
        <label className="field" style={{ maxWidth: 420 }}>
          <span>Company name, shown in the top bar and prefilled on invites</span>
          <div className="actions">
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Meridian Labs" style={{ flex: 1 }} />
            <button
              className="btn-primary"
              onClick={() => {
                p.onOrgChange(name);
                toast.success("Company name saved");
              }}
            >
              Save
            </button>
          </div>
        </label>
        <label className="field" style={{ maxWidth: 420, marginTop: 16 }}>
          <span>Chunk size for denominated payouts, the same for every employee</span>
          <div className="actions">
            <div className="addon" style={{ flex: 1 }}>
              <input className="mono-in" aria-label="Chunk size" value={chunk} inputMode="decimal" onChange={(e) => setChunk(e.target.value.replace(/[^\d.]/g, ""))} />
              <span className="suffix">USDC</span>
            </div>
            <button
              className="btn-primary"
              onClick={() => {
                const c = tryParseUsdc(chunk || defaultChunk);
                if (!c.ok || c.value <= 0n) return toast.error("Chunk size must be a positive USDC amount");
                p.onChunkChange(chunk || defaultChunk);
                toast.success("Chunk size saved");
              }}
            >
              Save
            </button>
          </div>
          <span className="hint">Every full line in a run is this amount; each salary&apos;s remainder is one smaller line. Default {defaultChunk} USDC
            {testnet
              ? " on this testnet, where faucet USDC is scarce. A recipient's exit needs about 16.4 USDC on one address, so pay that line with denominations off or a larger chunk."
              : "."}</span>
        </label>
      </div>

      <h2>Network</h2>
      <div className="panel panel-pad stack">
        <dl className="facts" style={{ alignItems: "center" }}>
          <dt>Chain</dt>
          <dd>
            <select value={p.form.chainId} onChange={(e) => p.set("chainId", Number(e.target.value) as typeof p.form.chainId)} aria-label="Chain">
              {p.chainIds.map((id) => (
                <option key={id} value={id}>
                  {p.chainName(id)} ({id})
                </option>
              ))}
            </select>
          </dd>
          <dt>StealthDisperse</dt>
          <dd>
            <input className="mono" style={{ width: "100%" }} placeholder="0x… (empty = EIP-5792 path only)" value={p.form.stealthDisperse} onChange={(e) => p.set("stealthDisperse", e.target.value)} />
          </dd>
          <dt>Payroll RPC</dt>
          <dd>
            <input style={{ width: "100%" }} placeholder="Public default" value={p.form.rpcUrl} onChange={(e) => p.set("rpcUrl", e.target.value)} />
          </dd>
          <dt>ENS RPC</dt>
          <dd>
            <input style={{ width: "100%" }} placeholder="Public default" value={p.form.ensRpcUrl} onChange={(e) => p.set("ensRpcUrl", e.target.value)} />
            <span className="note">Used only to resolve names ({app.ensChain.name}).</span>
          </dd>
        </dl>
        <ErrorLine error={p.error} />
        <div className="actions">
          <button className="btn-primary" onClick={p.save}>
            Save and reload
          </button>
          <button onClick={p.reset}>Reset to defaults</button>
        </div>
      </div>

      <h2>This build</h2>
      <div className="panel panel-pad">
        <dl className="facts">
          <dt>USDC</dt>
          <dd className="mono">{app.usdc}</dd>
          <dt>StealthDisperse in use</dt>
          <dd>{app.stealthDisperse ? <span className="mono">{app.stealthDisperse}</span> : <span className="ink2">Not configured: EIP-5792 batches and Safe exports only.</span>}</dd>
          <dt>Pinned attester</dt>
          <dd className="mono">
            {app.mockEns ? "mock attester (dev)" : app.attester ?? <span className="ink2">None: every key rotation needs your manual approval.</span>}
            <span className="note">A changed record is auto-accepted only with a World ID re-verification signed by this address.</span>
          </dd>
          <dt>Soapay API</dt>
          <dd className="mono">{app.apiUrl ?? <span className="ink2">not set (no invites)</span>}</dd>
          <dt>Invite links</dt>
          <dd className="mono">{app.recipientUrl}/#/join?…</dd>
        </dl>
        {app.mockEns && (
          <div style={{ marginTop: 12 }}>
            <Notice tone="warn">Dev mock mode: names resolve to demo keys.</Notice>
          </div>
        )}
      </div>

      <h2>Stored in this browser</h2>
      <p className="ink2 pretty">
        Encrypted vault ({p.vaultMode ?? "none"}): {p.counts.employees} pinned {p.counts.employees === 1 ? "employee" : "employees"}, {p.counts.invites} invite
        {p.counts.invites === 1 ? "" : "s"} and {p.counts.runs} run record{p.counts.runs === 1 ? "" : "s"} (which fresh address each person was paid into).
        Records are never reused as payment targets.
      </p>
      <div className="actions">
        <button onClick={p.onLock}>Lock vault</button>
        <button
          className="btn-danger"
          onClick={() => confirm("Delete the roster, invites and all run history from this browser? This can't be undone.") && p.onDestroyVault()}
        >
          Delete vault
        </button>
      </div>
    </div>
  );
}
