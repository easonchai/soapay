import { useState, type ReactNode } from "react";
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
  /** Test-USDC affordance (pages/Faucet.tsx); nothing on mainnet. */
  faucet?: ReactNode;
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
      <PageHead eyebrow="Settings" title="Where this app points, and what it keeps" line="Network overrides are per browser. Roster and history stay encrypted here." />

      <h2>Company</h2>
      <div className="panel panel-pad">
        <label className="field" style={{ maxWidth: 420 }}>
          <span>Company name (top bar, invites)</span>
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
          <span>Chunk size (denominated payouts, company-wide)</span>
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
          <span className="hint">Every full line is this amount; each remainder is one smaller line. Default {defaultChunk} USDC
            {testnet
              ? " on this testnet (faucet USDC is scarce). An exit needs about 16.4 USDC on one address: use a larger chunk or denominations off for that line."
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
            <span className="note">Name resolution only ({app.ensChain.name}).</span>
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
            {app.demo ? "mock attester (demo)" : app.mockEns ? "mock attester (dev)" : app.attester ?? <span className="ink2">None: every key rotation needs your approval.</span>}
            <span className="note">Changed records auto-accept only with a World ID re-verification signed here.</span>
          </dd>
          <dt>Soapay API</dt>
          <dd className="mono">{app.demo ? <span className="ink2">demo: in-memory invites</span> : app.apiUrl ?? <span className="ink2">not set (no invites)</span>}</dd>
          <dt>Invite links</dt>
          <dd className="mono">{app.recipientUrl}/#/join?…</dd>
        </dl>
        {app.mockEns && (
          <div style={{ marginTop: 12 }}>
            <Notice tone="warn">Dev mock mode: names resolve to demo keys.</Notice>
          </div>
        )}
      </div>

      {p.faucet && (
        <>
          <h2>Test funds</h2>
          {p.faucet}
        </>
      )}

      <h2>Stored in this browser</h2>
      <p className="ink2 pretty">
        Encrypted vault ({p.vaultMode ?? "none"}): {p.counts.employees} pinned {p.counts.employees === 1 ? "employee" : "employees"}, {p.counts.invites} invite
        {p.counts.invites === 1 ? "" : "s"} and {p.counts.runs} run record{p.counts.runs === 1 ? "" : "s"}. Stored addresses are never reused as payment targets.
      </p>
      <div className="actions">
        <button onClick={p.onLock}>Lock vault</button>
        <button
          className="btn-danger"
          onClick={() => confirm("Delete roster, invites and run history from this browser? This can't be undone.") && p.onDestroyVault()}
        >
          Delete vault
        </button>
      </div>
    </div>
  );
}
