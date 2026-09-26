import { useEffect, useRef, useState } from "react";
import { defaultPaymasterMode, type DecodedCall } from "@soapay/sdk";
import { chainName, explorerAddressUrl } from "../config.js";
import type { PendingApproval, Validation } from "../features/walletconnect/controller.js";
import type { ApprovalDecision, ApprovalKind } from "../features/walletconnect/router.js";
import { useServices } from "../services/ServicesProvider.js";
import { Addr, Alert, Badge, Button, Checkbox } from "../ui/kit.js";
import { linkTxHashes } from "./GuardDecision.js";

const ASKS: Record<ApprovalKind, string> = {
  transaction: "wants to send a transaction",
  calls: "wants to send a batch of calls",
  message: "wants you to sign a message",
  "typed-data": "wants you to sign typed data",
};

export function VerifyBadge({ validation, isScam }: { validation: Validation; isScam: boolean }) {
  if (isScam) return <Badge tone="destructive">Known scam</Badge>;
  if (validation === "VALID") return <Badge tone="success">Verified domain</Badge>;
  if (validation === "INVALID") return <Badge tone="destructive">Domain mismatch</Badge>;
  return <Badge tone="warning">Unverified domain</Badge>;
}

function CallRow({ call, index, chainId, mock }: { call: DecodedCall; index: number; chainId: number; mock: boolean }) {
  const url = mock ? undefined : explorerAddressUrl(chainId, call.to);
  return (
    <li className="space-y-1 py-2" data-testid="dapp-call">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted-foreground">#{index + 1}</span>
        <span className="font-medium">{call.functionName ?? (call.selector ? `Unknown function ${call.selector}` : "Plain call, no data")}</span>
        <span className="text-xs text-muted-foreground">
          on{" "}
          {url ? (
            <a href={url} target="_blank" rel="noreferrer">
              <Addr address={call.to} />
            </a>
          ) : (
            <Addr address={call.to} />
          )}
        </span>
      </div>
      {call.args && call.args.length > 0 && (
        <dl className="facts text-xs">
          {call.args.map((a, i) => (
            <div key={i} style={{ display: "contents" }}>
              <dt>{a.name}</dt>
              <dd className="font-mono">{a.value}</dd>
            </div>
          ))}
        </dl>
      )}
      {!call.functionName && call.data.length > 10 && (
        <details className="text-xs">
          <summary className="cursor-pointer text-muted-foreground">Raw data ({(call.data.length - 2) / 2} bytes)</summary>
          <code className="block max-h-32 overflow-auto break-all">{call.data}</code>
        </details>
      )}
    </li>
  );
}

/**
 * Approval sheet for one dApp request (D-61): who asks, from which ONE address, what runs (decoded
 * where possible), how gas is paid, and the privacy guard's verdict. A request the guard blocks
 * needs an explicit override before Approve is enabled.
 */
export function DappRequestSheet({ approval, onDecide }: { approval: PendingApproval; onDecide: (d: ApprovalDecision) => void }) {
  const svc = useServices();
  const { request: r } = approval;
  const [override, setOverride] = useState(false);
  const dialog = useRef<HTMLDivElement>(null);
  useEffect(() => {
    setOverride(false);
    dialog.current?.focus();
  }, [approval.requestId]);

  const executes = r.kind === "transaction" || r.kind === "calls";
  const cantSend = executes && !svc.dapp.ready ? (svc.dapp.unavailableReason ?? "Sending isn't available.") : null;
  const blocked = r.privacy.blocked;
  const guardPlans = r.privacy.transfers.map((t) => t.plan).filter((p) => p && p.decision !== "allow");
  const canApprove = !cantSend && (!blocked || override) && !approval.isScam;
  const gas = defaultPaymasterMode(r.chainId) === "sponsored" ? "Gas is sponsored (testnet)." : "Gas is paid in USDC from this address.";

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-2 sm:items-center sm:p-6">
      <div
        ref={dialog}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="dapp-sheet-title"
        className="panel max-h-[92dvh] w-full max-w-xl space-y-4 overflow-y-auto p-4 outline-none sm:p-5"
        data-testid="dapp-request-sheet"
        data-kind={r.kind}
      >
        <div className="space-y-1">
          <h2 id="dapp-sheet-title">
            {r.dapp.name} {ASKS[r.kind]}
          </h2>
          <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <span className="break-all">{r.dapp.url}</span>
            <VerifyBadge validation={approval.validation} isScam={approval.isScam} />
          </div>
        </div>

        <dl className="facts text-sm">
          <dt>From</dt>
          <dd>
            <Addr address={r.address} /> <span className="text-muted-foreground">(the one address this dApp sees)</span>
          </dd>
          <dt>Network</dt>
          <dd>{chainName(r.chainId)}</dd>
          {executes && (
            <>
              <dt>ETH sent</dt>
              <dd>0</dd>
              <dt>Gas</dt>
              <dd>{gas}</dd>
            </>
          )}
        </dl>

        {r.calls && (
          <ul className="divide-y border-y" aria-label="Calls">
            {r.calls.map((c, i) => (
              <CallRow key={i} call={c} index={i} chainId={r.chainId} mock={svc.mock} />
            ))}
          </ul>
        )}

        {r.message && (
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">Message</p>
            <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all border p-2 text-sm">{r.message.text}</pre>
          </div>
        )}

        {r.typedData && (
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">
              {r.typedData.primaryType}
              {typeof r.typedData.domain.name === "string" ? ` · ${r.typedData.domain.name}` : ""}
            </p>
            <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all border p-2 text-xs">{JSON.stringify(r.typedData.message, null, 2)}</pre>
          </div>
        )}

        {approval.isScam && (
          <Alert variant="destructive" title="WalletConnect flags this site as a scam">
            Soapay won't approve requests from it.
          </Alert>
        )}
        {approval.validation === "INVALID" && !approval.isScam && (
          <Alert variant="destructive" title="The site doesn't match the dApp it claims to be">
            Only approve if you opened {r.dapp.url} yourself.
          </Alert>
        )}
        {r.notes.map((n) => (
          <Alert key={n} variant="warning">
            {n}
          </Alert>
        ))}
        {cantSend && <Alert variant="warning" title="Can't send from here yet">{cantSend}</Alert>}

        <div className="space-y-2" data-testid="dapp-privacy" data-blocked={blocked ? "true" : "false"}>
          {!blocked && r.privacy.warnings.length === 0 && guardPlans.length === 0 && (
            <Alert variant="success" title="No new links">
              Nothing in this request names your other payment addresses or a wallet you've labelled.
            </Alert>
          )}
          {(blocked || r.privacy.warnings.length > 0 || guardPlans.length > 0) && (
            <Alert variant={blocked ? "destructive" : "warning"} title={blocked ? "Privacy guard: this links you" : "Privacy warning"}>
              <ul className="list-disc space-y-1 pl-5">
                {r.privacy.warnings.map((w) => (
                  <li key={`${w.code}:${w.address}`}>{w.message}</li>
                ))}
                {guardPlans.map((p, i) => (
                  <li key={`plan:${i}`}>{linkTxHashes(p!.reason)}</li>
                ))}
              </ul>
            </Alert>
          )}
          {blocked && (
            <Checkbox
              checked={override}
              onChange={setOverride}
              tone="destructive"
              label="Approve anyway"
              description="I understand a coworker who knows the other address can tie this payment address to me."
            />
          )}
        </div>

        <div className="flex flex-wrap justify-end gap-2 border-t pt-3">
          <Button variant="outline" onClick={() => onDecide({ approved: false })} data-testid="dapp-reject">
            Reject
          </Button>
          <Button onClick={() => onDecide({ approved: true, override: blocked && override })} disabled={!canApprove} data-testid="dapp-approve">
            {r.kind === "message" || r.kind === "typed-data" ? "Sign" : "Approve"}
          </Button>
        </div>
      </div>
    </div>
  );
}
