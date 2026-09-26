import { Fragment, useState } from "react";
import { Link, useNavigate } from "react-router";
import { Copy, CountUp } from "@soapay/ui";
import { chainName, explorerTxUrl } from "../config.js";
import { describePhase, useScanner } from "../hooks/scanner.js";
import { useChain } from "../hooks/useChain.js";
import { useWallet } from "../hooks/useWallet.js";
import { useServices } from "../services/ServicesProvider.js";
import { Addr, Alert, Badge, Button } from "../ui/kit.js";
import { formatUsdc, relativeTime, USDC_DECIMALS } from "../ui/format.js";
import { useUnlocked } from "../vault/VaultProvider.js";

const FLAG_TEXT: Record<string, string> = {
  "unknown-payer": "Unknown payer",
  "duplicate-announcement": "Duplicate announcement",
  "no-metadata": "No metadata",
  "hint-token-mismatch": "Token mismatch",
  "hint-amount-mismatch": "Amount mismatch",
  "balance-unavailable": "Balance unavailable",
};

/**
 * CK's dashboard layout (headline figure, "Receiving as", Rescan, ledger table with expandable rows) over
 * our scanner and ledger. Amounts are live balances only; the announced amount is shown as an untrusted
 * hint. CK's "reveal private key" is gone: each row sends through our guarded gasless Send instead
 * (key export lives only under Settings → Advanced recovery).
 */
export function Home() {
  const wallet = useWallet();
  const scanner = useScanner();
  const svc = useServices();
  const v = useUnlocked();
  const navigate = useNavigate();
  const { state } = useChain();
  const [open, setOpen] = useState<string | null>(null);
  const profile = v.data.profile;
  const share = profile.name?.name ?? v.keys.metaAddressURI;
  const n = wallet.ledger.length;

  return (
    <div className="stack-lg">
      <div className="between" style={{ alignItems: "flex-end", flexWrap: "wrap" }}>
        <div className="stack-sm">
          <p className="muted">
            {profile.name ? <strong style={{ color: "var(--ink)" }}>{profile.name.name}</strong> : "Receiving as"}{" "}
            <Addr address={v.keys.registrantAddress} />
          </p>
          <div className="figure" data-testid="total">
            {n === 0 ? (
              "No payments yet"
            ) : (
              <>
                <CountUp value={Number(wallet.total) / 10 ** USDC_DECIMALS} format={(x) => x.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} />
                <span className="unit">
                  USDC across {n} {n === 1 ? "address" : "addresses"}
                </span>
              </>
            )}
          </div>
          <p className="muted">
            Live balances on {chainName(svc.settings.chainId)}. Last scan:{" "}
            {state.lastScannedBlock ? `block ${state.lastScannedBlock}` : "never"}
            {state.balancesAt ? `, balances ${relativeTime(state.balancesAt)}` : ""}.
          </p>
        </div>
        <div className="actions">
          <Button onClick={() => void scanner.scan()} loading={scanner.running}>
            {scanner.running ? "Scanning…" : "Rescan"}
          </Button>
          <Button variant="outline" onClick={() => void scanner.scan({ full: true })} disabled={scanner.running}>
            Rescan from start
          </Button>
          <Button variant="ghost" onClick={() => void navigate("/spend")} disabled={n === 0}>
            Send
          </Button>
          <Button variant="ghost" onClick={() => void navigate("/exit")} disabled={n === 0}>
            Exit
          </Button>
        </div>
      </div>

      {scanner.running && <Alert variant="info">{describePhase(scanner.phase) || "Scanning…"}</Alert>}
      {scanner.error && <Alert variant="warning">{scanner.error}</Alert>}
      {scanner.last && !scanner.running && (
        <p className="hint" data-testid="scan-summary">
          Checked {scanner.last.stats.scanned.toLocaleString()} announcements in {Math.round(scanner.last.scanMs)} ms on {scanner.last.workers}{" "}
          worker{scanner.last.workers === 1 ? "" : "s"}; {scanner.last.newMatches} new payment{scanner.last.newMatches === 1 ? "" : "s"}.
        </p>
      )}

      {n === 0 ? (
        <div className="share">
          <div className="label">{scanner.running ? "Looking for your payments… meanwhile, share this to get paid" : "Share this to get paid"}</div>
          <div className="value">{share}</div>
          <Copy value={share} />
        </div>
      ) : (
        <div className="table-wrap">
          <table data-testid="ledger">
            <thead>
              <tr>
                <th>Block</th>
                <th>From</th>
                <th className="num">Announced</th>
                <th className="num">Live balance</th>
                <th>Address</th>
                <th>Tx</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {wallet.ledger.map((e) => {
                const key = `${e.stealthAddress}:${e.token}`;
                const first = e.announcements[0];
                const isOpen = open === key;
                const url = first && !svc.mock ? explorerTxUrl(svc.settings.chainId, first.txHash) : undefined;
                const payerName = wallet.payerName(e.payer);
                return (
                  <Fragment key={key}>
                    <tr className={isOpen ? "expanded" : undefined}>
                      <td className="num">{first ? first.blockNumber.toString() : "—"}</td>
                      <td>
                        <span className="row" style={{ flexWrap: "wrap" }}>
                          {payerName ?? (e.payer ? <Addr address={e.payer} /> : <span className="muted">unknown</span>)}
                          {e.flags.includes("unknown-payer") && <Badge tone="warning">{FLAG_TEXT["unknown-payer"]}</Badge>}
                        </span>
                      </td>
                      <td className="num">{e.claimedAmount === null ? <span className="muted">unknown</span> : formatUsdc(e.claimedAmount)}</td>
                      <td className="num">{formatUsdc(e.balance)}</td>
                      <td>
                        <Addr address={e.stealthAddress} />
                        <Copy value={e.stealthAddress} />
                      </td>
                      <td>
                        {first &&
                          (url ? (
                            <a href={url} target="_blank" rel="noreferrer">
                              <Addr address={first.txHash} />
                            </a>
                          ) : (
                            <Addr address={first.txHash} />
                          ))}
                      </td>
                      <td>
                        <span className="row" style={{ justifyContent: "flex-end" }}>
                          <button
                            type="button"
                            className="btn-inline"
                            disabled={!e.balance}
                            onClick={() => void navigate("/spend", { state: { amount: formatUsdc(e.balance, { precise: true }).replace(/,/g, "") } })}
                          >
                            Send
                          </button>
                          <button type="button" className="btn-text btn-inline" onClick={() => setOpen(isOpen ? null : key)}>
                            {isOpen ? "Hide" : "Details"}
                          </button>
                        </span>
                      </td>
                    </tr>
                    {isOpen && (
                      <tr className="expanded">
                        <td colSpan={7}>
                          <div className="detail">
                            <div>
                              Address <code>{e.stealthAddress}</code>
                            </div>
                            {e.announcements.map((a) => (
                              <div key={`${a.txHash}:${a.logIndex}`}>
                                Announced by <code>{a.caller}</code> in block {a.blockNumber.toString()}, ephemeral key <code>{a.ephemeralPubKey}</code>
                              </div>
                            ))}
                            {e.flags.length > 0 && (
                              <div className="row" style={{ flexWrap: "wrap" }}>
                                {e.flags.map((f) => (
                                  <Badge key={f} tone={f === "unknown-payer" ? "warning" : "neutral"}>
                                    {FLAG_TEXT[f] ?? f}
                                  </Badge>
                                ))}
                              </div>
                            )}
                            <div className="muted">
                              The announced amount is a hint from whoever announced it; the live balance is what you can spend. Send uses the
                              guard, so this address isn't linked to others by accident.
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="grid gap-8 md:grid-cols-2">
        <section className="stack-sm">
          <div className="between">
            <h2>Privacy clusters</h2>
            <Link to="/labels">Labels</Link>
          </div>
          <p className="muted">Addresses you've spent together are linked. Send keeps clusters apart unless you override.</p>
          <div className="table-wrap">
            <table>
              <tbody>
                {wallet.view.clusters.map((c) => (
                  <tr key={c.id}>
                    <td>
                      <span className="row">
                        {c.addresses.length} address{c.addresses.length === 1 ? "" : "es"}
                        {c.identified && <Badge tone="destructive">Identified</Badge>}
                      </span>
                    </td>
                    <td className="num">{formatUsdc(c.total)}</td>
                  </tr>
                ))}
                {wallet.view.clusters.length === 0 && (
                  <tr>
                    <td className="muted">Nothing yet.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        {(wallet.spends.length > 0 || wallet.conversions.length > 0) && (
          <section className="stack-sm">
            <h2>History</h2>
            <p className="muted">Stored only in this browser's encrypted vault.</p>
            <div className="table-wrap">
              <table>
                <tbody>
                  {wallet.spends.map((s) => (
                    <tr key={`s${s.at}`}>
                      <td>
                        Sent to <Addr address={s.to} /> · {relativeTime(s.at)} {s.failed && <Badge tone="warning">Partial</Badge>}
                        {s.override && <Badge tone="destructive">Override</Badge>}
                      </td>
                      <td className="num">{formatUsdc(s.parts.reduce((a, p) => a + BigInt(p.amount), 0n))}</td>
                    </tr>
                  ))}
                  {wallet.conversions.map((c) => (
                    <tr key={`c${c.at}`}>
                      <td>
                        Converted in <Addr address={c.address} /> to {c.symbol} · {relativeTime(c.at)}
                      </td>
                      <td className="num">{formatUsdc(BigInt(c.amountIn))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
