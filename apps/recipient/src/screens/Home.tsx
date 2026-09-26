import { Fragment, useMemo, useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router";
import type { LedgerEntry } from "@soapay/sdk";
import { Copy, CountUp, Dots, FreshMark, InView, Progress, Reveal, toast } from "@soapay/ui";
import type { Address } from "viem";
import { chainName, exitOffered, explorerTxUrl } from "../config.js";
import { describePhase, useScanner, type ScannerApi } from "../hooks/scanner.js";
import { useChain } from "../hooks/useChain.js";
import { lastSpendTx } from "../hooks/useChainViews.js";
import { useWallet } from "../hooks/useWallet.js";
import { useServices } from "../services/ServicesProvider.js";
import { Addr, Alert, Badge, Button, EmptyState } from "../ui/kit.js";
import { formatUsdc, relativeTime, USDC_DECIMALS } from "../ui/format.js";
import type { ConvertRecord, SpendRecord } from "../vault/types.js";
import { useUnlocked } from "../vault/VaultProvider.js";
import { GaslessProofPanel } from "./GaslessProof.js";
import { PayRuns } from "./PayRunViews.js";

const FLAG_TEXT: Record<string, string> = {
  "unknown-payer": "Unknown payer",
  "duplicate-announcement": "Duplicate announcement",
  "no-metadata": "No metadata",
  "hint-token-mismatch": "Token mismatch",
  "hint-amount-mismatch": "Amount mismatch",
  "balance-unavailable": "Balance unavailable",
};

const usd = (x: number) => x.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * CK's dashboard layout (headline figure, "Receiving as", Rescan, ledger table with expandable rows) over
 * our scanner and ledger. Amounts are live balances only; the announced amount is shown as an untrusted
 * hint. CK's "reveal private key" is gone: each row sends through our guarded gasless Send instead
 * (key export lives only under Settings → Advanced recovery).
 *
 * The screen is composed from prop-driven pieces (Hero, ScanProgress, NoPayments, ShareRow, LedgerTable)
 * so they can be rendered in tests without the vault and scanner providers.
 */
export function Home() {
  const wallet = useWallet();
  const scanner = useScanner();
  const svc = useServices();
  const v = useUnlocked();
  const navigate = useNavigate();
  const { state } = useChain();
  const profile = v.data.profile;
  const name = profile.name?.name ?? null;
  const share = name ?? v.keys.metaAddressURI;
  const n = wallet.ledger.length;
  const linked = linkedCount(wallet.view.clusters);

  return (
    <div className="stack-lg">
      <Hero
        name={name}
        address={v.keys.registrantAddress}
        total={wallet.total}
        addressCount={n}
        linked={linked}
        running={scanner.running}
        onSend={() => void navigate("/spend")}
        onScan={() => void scanner.scan()}
        onFullScan={() => void scanner.scan({ full: true })}
        onExit={exitOffered(svc.settings.chainId) ? () => void navigate("/exit") : undefined}
      >
        Live balances on {chainName(svc.settings.chainId)}. Last scan: {state.lastScannedBlock ? `block ${state.lastScannedBlock}` : "never"}
        {state.balancesAt ? `, balances ${relativeTime(state.balancesAt)}` : ""}.
      </Hero>

      {scanner.running && <ScanProgress phase={scanner.phase} />}

      {!profile.name && (
        <Alert
          variant="warning"
          title="No pay name yet"
          action={
            <Button size="sm" onClick={() => void navigate("/name")} data-testid="claim-name-banner">
              Claim a name
            </Button>
          }
        >
          You're sharing your raw meta-address. A name is easier for your employer to type, and lets you change keys later without re-sending
          anything.
        </Alert>
      )}

      {scanner.error && <Alert variant="warning">{scanner.error}</Alert>}
      {scanner.last && !scanner.running && (
        <p className="hint" data-testid="scan-summary">
          Checked {scanner.last.stats.scanned.toLocaleString()} announcements in {Math.round(scanner.last.scanMs)} ms on {scanner.last.workers}{" "}
          worker{scanner.last.workers === 1 ? "" : "s"}; {scanner.last.newMatches} new payment{scanner.last.newMatches === 1 ? "" : "s"}.
        </p>
      )}

      {n === 0 ? (
        <NoPayments name={name} share={share} searching={scanner.running && !scanner.last} />
      ) : (
        <>
          <ShareRow share={share} />
          <InView>
            <LedgerTable
              entries={wallet.ledger}
              spends={wallet.spends}
              conversions={wallet.conversions}
              payerName={wallet.payerName}
              chainId={svc.settings.chainId}
              mock={svc.mock}
              onSend={(amount) => void navigate("/spend", { state: { amount } })}
              onConnect={(address) => void navigate("/connect", { state: { address } })}
            />
          </InView>
        </>
      )}

      <PayRuns />

      <div className="grid gap-8 md:grid-cols-2">
        <InView as="section" className="stack-sm" delay={0.05}>
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
                    <td className="muted">No links yet. Send keeps addresses apart.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </InView>

        {(wallet.spends.length > 0 || wallet.conversions.length > 0) && (
          <InView as="section" className="stack-sm" delay={0.1}>
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
          </InView>
        )}
      </div>
    </div>
  );
}

/** Addresses that share a cluster with at least one other address. */
export function linkedCount(clusters: { addresses: unknown[] }[]): number {
  return clusters.reduce((acc, c) => acc + (c.addresses.length > 1 ? c.addresses.length : 0), 0);
}

/** Headline: who is receiving, the live total, the address count, and the actions. `children` is the status line. */
export function Hero({
  name,
  address,
  total,
  addressCount,
  linked,
  running,
  onSend,
  onScan,
  onFullScan,
  onExit,
  children,
}: {
  name: string | null;
  address: string;
  total: bigint;
  addressCount: number;
  linked: number;
  running: boolean;
  onSend: () => void;
  onScan: () => void;
  onFullScan: () => void;
  /** Omitted where the exit isn't offered (testnet mock USDC, D-52). */
  onExit?: () => void;
  children?: ReactNode;
}) {
  const zero = total === 0n;
  return (
    <div className="hero">
      <div className="text">
        <p className="eyebrow" style={{ fontFamily: "var(--mono)" }}>
          {name ? <strong style={{ color: "var(--ink)" }}>{name}</strong> : "Receiving as"} <Addr address={address} />
        </p>
        <div className={zero ? "figure zero" : "figure"} data-testid="total">
          {zero ? "0.00" : <CountUp value={Number(total) / 10 ** USDC_DECIMALS} format={usd} />}
          <span className="unit">USDC</span>
        </div>
        <p className="hint">
          {addressCount} {addressCount === 1 ? "address" : "addresses"} · {linked > 0 ? `${linked} linked` : "none linked"}
        </p>
        {children && <p className="muted">{children}</p>}
      </div>
      <Dots mode="right" animate className="hero-dots" />
      <div className="actions">
        <Button variant="primary" onClick={onSend} disabled={zero} {...(zero ? { title: "Nothing to send yet" } : {})}>
          Send
        </Button>
        <Button variant="secondary" onClick={onScan} loading={running}>
          {running ? "Scanning…" : "Rescan"}
        </Button>
        <Button variant="ghost" onClick={onFullScan} disabled={running}>
          Rescan from start
        </Button>
        {onExit && (
          <Button variant="ghost" onClick={onExit} disabled={addressCount === 0}>
            Exit
          </Button>
        )}
      </div>
    </div>
  );
}

/** Fraction done when the phase carries counts (checking announcements); otherwise indeterminate. */
export function scanFraction(phase: ScannerApi["phase"]): number | null {
  if (phase?.phase !== "scanning" || phase.progress.total <= 0) return null;
  return phase.progress.scanned / phase.progress.total;
}

export function ScanProgress({ phase }: { phase: ScannerApi["phase"] }) {
  return <Progress value={scanFraction(phase)} label={describePhase(phase) || "Scanning…"} />;
}

async function copyText(value: string) {
  try {
    await navigator.clipboard.writeText(value);
    toast.success("Copied");
  } catch {
    toast.error("Copy failed");
  }
}

/** Empty ledger: what to share to get paid. `searching` while the first scan of the session is still running. */
export function NoPayments({ name, share, searching }: { name: string | null; share: string; searching: boolean }) {
  const title = searching ? "Looking for your payments…" : name ? `Ask your payer to send to ${name} on Base.` : "Ask your payer to send to your meta-address.";
  return (
    <EmptyState
      eyebrow="Nothing received yet"
      title={title}
      action={<Button onClick={() => void copyText(share)}>{name ? `Copy ${name}` : "Copy meta-address"}</Button>}
    >
      Each payment lands on its own fresh address and shows here within a minute of confirmation.
    </EmptyState>
  );
}

export function ShareRow({ share }: { share: string }) {
  return (
    <div className="share-row">
      <span className="label">Share to get paid</span>
      <span className="value" title={share}>
        {share}
      </span>
      <Copy value={share} />
    </div>
  );
}

/** Stealth addresses that have already sent or converted; anything else with a balance is fresh. */
export function spentAddresses(spends: SpendRecord[], conversions: ConvertRecord[]): Set<string> {
  const out = new Set<string>();
  for (const s of spends) for (const p of s.parts) out.add(p.from.toLowerCase());
  for (const c of conversions) out.add(c.address.toLowerCase());
  return out;
}

export function LedgerTable({
  entries,
  spends,
  conversions,
  payerName,
  chainId,
  mock,
  onSend,
  onConnect,
}: {
  entries: LedgerEntry[];
  spends: SpendRecord[];
  conversions: ConvertRecord[];
  payerName: (address: Address | null) => string | null;
  chainId: number;
  mock: boolean;
  /** Open Send prefilled with this row's balance (a plain decimal string). */
  onSend: (amount: string) => void;
  /** Use this row's address with a dApp over WalletConnect (D-61). */
  onConnect: (address: Address) => void;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const spent = useMemo(() => spentAddresses(spends, conversions), [spends, conversions]);
  return (
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
          {entries.map((e) => {
            const key = `${e.stealthAddress}:${e.token}`;
            const first = e.announcements[0];
            const isOpen = open === key;
            const url = first && !mock ? explorerTxUrl(chainId, first.txHash) : undefined;
            const payer = payerName(e.payer);
            const fresh = e.balance !== null && e.balance > 0n && !spent.has(e.stealthAddress.toLowerCase());
            const lastSpend = isOpen ? lastSpendTx(e.stealthAddress, spends, conversions) : null;
            return (
              <Fragment key={key}>
                <tr className={isOpen ? "expanded" : undefined}>
                  <td className="num">{first ? first.blockNumber.toString() : "—"}</td>
                  <td>
                    <span className="row" style={{ flexWrap: "wrap" }}>
                      {payer ?? (e.payer ? <Addr address={e.payer} /> : <span className="muted">unknown</span>)}
                      {e.flags.includes("unknown-payer") && <Badge tone="warning">{FLAG_TEXT["unknown-payer"]}</Badge>}
                    </span>
                  </td>
                  <td className="num">{e.claimedAmount === null ? <span className="muted">unknown</span> : formatUsdc(e.claimedAmount)}</td>
                  <td className="num">{formatUsdc(e.balance)}</td>
                  <td>
                    <span className="row" style={{ gap: 6 }}>
                      {fresh && <FreshMark />}
                      <Addr address={e.stealthAddress} />
                      <Copy value={e.stealthAddress} />
                    </span>
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
                        onClick={() => onSend(formatUsdc(e.balance, { precise: true }).replace(/,/g, ""))}
                      >
                        Send
                      </button>
                      <button
                        type="button"
                        className="btn-inline"
                        title="Use this address with a dApp (WalletConnect)"
                        onClick={() => onConnect(e.stealthAddress)}
                      >
                        dApp
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
                      <Reveal className="detail">
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
                        {lastSpend && (
                          <div style={{ maxWidth: 560 }}>
                            <GaslessProofPanel address={e.stealthAddress} txHash={lastSpend.txHash} />
                          </div>
                        )}
                      </Reveal>
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
