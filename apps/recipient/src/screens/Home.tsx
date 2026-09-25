import { Inbox, RefreshCw } from "lucide-react";
import { Link } from "react-router";
import { describePhase, useScanner } from "../hooks/scanner.js";
import { useWallet } from "../hooks/useWallet.js";
import { useChain } from "../hooks/useChain.js";
import { Addr, Alert, Badge, Button, Card, CardHeader, EmptyState, PageHeader } from "../ui/kit.js";
import { formatUsdc, relativeTime } from "../ui/format.js";

const FLAG_TEXT: Record<string, string> = {
  "unknown-payer": "Unknown payer",
  "duplicate-announcement": "Duplicate announcement",
  "no-metadata": "No metadata",
  "hint-token-mismatch": "Token mismatch",
  "hint-amount-mismatch": "Amount mismatch",
  "balance-unavailable": "Balance unavailable",
};

export function Home() {
  const wallet = useWallet();
  const scanner = useScanner();
  const { state } = useChain();
  return (
    <>
      <PageHeader
        title={`$${formatUsdc(wallet.total)}`}
        description="USDC across your stealth addresses. Amounts come from on-chain balances, never from what an announcement claims."
        action={
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => void scanner.scan()} loading={scanner.running}>
              {!scanner.running && <RefreshCw className="size-4" aria-hidden />} Scan
            </Button>
            <Button onClick={() => void scanner.scan({ full: true })} variant="ghost" disabled={scanner.running}>
              Rebuild
            </Button>
          </div>
        }
      />
      <div className="space-y-4">
        {scanner.running && <Alert variant="info">{describePhase(scanner.phase) || "Scanning…"}</Alert>}
        {scanner.error && <Alert variant="warning">{scanner.error}</Alert>}
        {scanner.last && !scanner.running && (
          <p className="text-xs text-muted-foreground" data-testid="scan-summary">
            Checked {scanner.last.stats.scanned.toLocaleString()} announcements in {Math.round(scanner.last.scanMs)} ms on {scanner.last.workers}{" "}
            worker{scanner.last.workers === 1 ? "" : "s"}; {scanner.last.newMatches} new payment{scanner.last.newMatches === 1 ? "" : "s"}.
            {state.balancesAt ? ` Balances ${relativeTime(state.balancesAt)}.` : ""}
          </p>
        )}

        <Card>
          <CardHeader title="Payments" description="One row per stealth address. Flagged rows may be spam; their amount is still the real balance." />
          {wallet.ledger.length === 0 ? (
            <EmptyState icon={Inbox} title={scanner.running ? "Looking for your payments…" : "No payments yet"}>
              Share your name or meta-address with your employer. Payments show up here after a scan.
            </EmptyState>
          ) : (
            <ul className="divide-y" data-testid="ledger">
              {wallet.ledger.map((e) => (
                <li key={`${e.stealthAddress}:${e.token}`} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                  <div className="min-w-0 space-y-1">
                    <Addr address={e.stealthAddress} />
                    <div className="flex flex-wrap gap-1 text-xs text-muted-foreground">
                      <span>from {wallet.payerName(e.payer) ?? (e.payer ? <Addr address={e.payer} /> : "unknown")}</span>
                      {e.flags.map((f) => (
                        <Badge key={f} tone={f === "unknown-payer" ? "warning" : "neutral"}>
                          {FLAG_TEXT[f] ?? f}
                        </Badge>
                      ))}
                    </div>
                  </div>
                  <span className="font-medium tabular-nums">{formatUsdc(e.balance)} USDC</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader
            title="Privacy clusters"
            description="Addresses you've spent together are linked. The Send screen keeps clusters apart unless you override."
            action={
              <Link to="/labels" className="text-sm underline underline-offset-2">
                Labels
              </Link>
            }
          />
          <ul className="divide-y text-sm">
            {wallet.view.clusters.map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-2 px-4 py-2">
                <span className="flex items-center gap-2">
                  {c.addresses.length} address{c.addresses.length === 1 ? "" : "es"}
                  {c.identified && <Badge tone="destructive">Identified</Badge>}
                </span>
                <span className="tabular-nums">{formatUsdc(c.total)}</span>
              </li>
            ))}
          </ul>
        </Card>

        {(wallet.spends.length > 0 || wallet.conversions.length > 0) && (
          <Card>
            <CardHeader title="History" description="Stored only in this browser's encrypted vault." />
            <ul className="divide-y text-sm">
              {wallet.spends.map((s) => (
                <li key={`s${s.at}`} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2">
                  <span>
                    Sent to <Addr address={s.to} /> · {relativeTime(s.at)} {s.failed && <Badge tone="warning">Partial</Badge>}
                    {s.override && <Badge tone="destructive">Override</Badge>}
                  </span>
                  <span className="tabular-nums">{formatUsdc(s.parts.reduce((a, p) => a + BigInt(p.amount), 0n))}</span>
                </li>
              ))}
              {wallet.conversions.map((c) => (
                <li key={`c${c.at}`} className="flex items-center justify-between gap-2 px-4 py-2">
                  <span>
                    Converted in <Addr address={c.address} /> to {c.symbol} · {relativeTime(c.at)}
                  </span>
                  <span className="tabular-nums">{formatUsdc(BigInt(c.amountIn))}</span>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>
    </>
  );
}
