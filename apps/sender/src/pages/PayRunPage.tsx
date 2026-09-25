import { useState } from "react";
import { formatEther } from "viem";
import type { PayRunState } from "../hooks/usePayRun.js";
import type { PayPathState, WalletState } from "../hooks/usePayPath.js";
import { formatUsdc, tryParseUsdc } from "../lib/amount.js";
import { Badge, Banner, Button, Card, Input } from "../ui/kit.js";
import { SafeExportPage } from "./SafeExportPage.js";

export type PayRunPageProps = {
  run: PayRunState;
  wallet: WalletState;
  payPath: PayPathState;
  onOpenRun(id: string): void;
};

/** Props-only: verify → preview → pay (or export for a Safe). */
export function PayRunPage({ run, wallet, payPath, onOpenRun }: PayRunPageProps) {
  const [denom, setDenom] = useState<"none" | "exact" | "carry">("none");
  const [chunk, setChunk] = useState("1000");
  const [safe, setSafe] = useState("");
  const payable = run.rows.filter((r) => r.payability.payable);
  const blocked = run.rows.filter((r) => !r.payability.payable);
  const path = payPath.probe?.path;

  if (run.safeChunks && run.runId) {
    const id = run.runId;
    return <SafeExportPage chunks={run.safeChunks} onDownload={run.downloadSafeChunk} onOpenRun={() => onOpenRun(id)} />;
  }

  const onPreview = () => {
    if (denom === "none") return run.preview(null);
    const c = tryParseUsdc(chunk);
    run.preview(c.ok && c.value > 0n ? { chunkSize: c.value, mode: denom } : { chunkSize: 0n, mode: denom });
  };

  return (
    <div className="flex flex-col gap-4">
      {run.error && <Banner tone="error">{run.error}</Banner>}

      <Card
        title="1. Re-verify every name"
        actions={
          <Button onClick={() => void run.verify()} disabled={run.stage === "verifying" || run.stage === "executing"}>
            {run.progress ? `Verifying ${run.progress.done}/${run.progress.total}…` : run.stage === "idle" ? "Verify" : "Verify again"}
          </Button>
        }
      >
        <p className="text-sm text-slate-600">
          Every name is resolved again. A changed meta-address is only accepted with a valid World ID attestation; otherwise that line is
          blocked until you re-approve it on the Roster.
        </p>
        {run.rows.length > 0 && (
          <div className="mt-2 text-sm">
            <Badge tone="ok">{payable.length} payable</Badge> {blocked.length > 0 && <Badge tone="warn">{blocked.length} left out</Badge>}
            <ul className="mt-2">
              {blocked.map((r) => (
                <li key={r.employee.id}>
                  {r.employee.ensName}: <span className="text-slate-600">{r.payability.payable ? "" : r.payability.message}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Card>

      {(run.stage === "verified" || run.stage === "planned") && (
        <Card title="2. Preview" actions={<Button onClick={onPreview} disabled={payable.length === 0}>Build preview</Button>}>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span>Denominations:</span>
            <select className="rounded border border-slate-300 px-2 py-1" value={denom} onChange={(e) => setDenom(e.target.value as typeof denom)}>
              <option value="none">Off (one line per employee)</option>
              <option value="exact">Fixed chunks, exact remainder</option>
              <option value="carry">Fixed chunks, carry remainder</option>
            </select>
            {denom !== "none" && <Input className="w-28" value={chunk} onChange={(e) => setChunk(e.target.value)} placeholder="Chunk USDC" />}
          </div>
          {run.plan && (
            <div className="mt-3 flex flex-col gap-2 text-sm">
              <div>
                <b>{formatUsdc(run.plan.total)} USDC</b> to {run.plan.estimate.recipientCount} employees in {run.plan.lines.length} lines,{" "}
                {run.plan.estimate.txCount} transaction{run.plan.estimate.txCount === 1 ? "" : "s"} (sorted globally, ≤350 lines each).
              </div>
              <div className="text-slate-600">
                Gas ≈ {run.plan.estimate.totalGas.toString()}
                {run.funding?.feeWei != null && ` · fee ≈ ${formatEther(run.funding.feeWei)} ETH`}
              </div>
              {run.plan.smallTeam && <Banner tone="warn">{run.plan.smallTeam}</Banner>}
              {run.plan.denomStats && run.plan.denomStats.uniqueAmountCount > 0 && (
                <Banner tone="warn">{run.plan.denomStats.uniqueAmountCount} line amount(s) occur only once and can single someone out.</Banner>
              )}
              {run.funding?.problems.map((m) => <Banner key={m} tone="warn">{m}</Banner>)}
            </div>
          )}
        </Card>
      )}

      {run.stage === "planned" && run.plan && (
        <Card title="3. Pay">
          {!wallet.isConnected ? (
            <p className="text-sm">Connect a wallet (top right) to pay.</p>
          ) : payPath.loading ? (
            <p className="text-sm text-slate-500">Checking your wallet…</p>
          ) : path ? (
            <div className="flex flex-col gap-2 text-sm">
              <div>
                <b>{path.title}</b>
              </div>
              <p className="text-slate-600">{path.reason}</p>
              {(path.kind === "batch" || path.kind === "disperse") && (
                <div>
                  <Button onClick={() => void run.execute()}>Pay {formatUsdc(run.plan.total)} USDC</Button>
                </div>
              )}
            </div>
          ) : (
            payPath.error && <Banner tone="error">{payPath.error}</Banner>
          )}
          <div className="mt-4 border-t border-slate-100 pt-3 text-sm">
            <div className="mb-2">Or export this run for a Safe:</div>
            <div className="flex gap-2">
              <Input className="w-96 font-mono" placeholder="Safe address 0x…" value={safe} onChange={(e) => setSafe(e.target.value)} />
              <Button variant="ghost" onClick={() => void run.exportSafe(safe)} disabled={!safe}>Export for Safe</Button>
            </div>
          </div>
        </Card>
      )}

      {(run.stage === "executing" || run.stage === "done") && run.runId && (
        <Card title={run.stage === "executing" ? "Paying… confirm each step in your wallet" : "Run recorded"}>
          <Button variant="ghost" onClick={() => onOpenRun(run.runId!)}>Open run</Button>{" "}
          <Button variant="ghost" onClick={run.reset}>New run</Button>
        </Card>
      )}
    </div>
  );
}
