import type { ReactNode } from "react";
import { NavyPanel } from "@soapay/ui";
import { SIMPLE_7702_ACCOUNT, type GaslessProof } from "@soapay/sdk";
import { formatEther, isAddressEqual, type Address, type Hex } from "viem";
import { explorerAddressUrl, explorerTxUrl } from "../config.js";
import { useGaslessProof } from "../hooks/useChainViews.js";
import { useServices } from "../services/ServicesProvider.js";
import { formatUsdc, shortAddr } from "../ui/format.js";

type Links = { tx(hash: string): string | undefined; address(a: string): string | undefined };

function Ext({ href, children }: { href: string | undefined; children: ReactNode }) {
  if (!href) return <>{children}</>;
  return (
    <a href={href} target="_blank" rel="noreferrer" style={{ color: "inherit", textDecoration: "underline", textUnderlineOffset: 2 }}>
      {children}
    </a>
  );
}

/** One label → value line of the proof. Pure data, so it's testable without a chain. */
export type ProofRow = { key: string; label: string; value: string; href?: string };

/**
 * Maps the SDK's proof facts to the rows the panel shows. Only facts the reads establish: no row says
 * "never received ETH" (that needs a full trace); the ETH row is the balance now.
 */
export function proofRows(p: GaslessProof, links: Links): ProofRow[] {
  const rows: ProofRow[] = [];
  const addrHref = links.address(p.address);
  rows.push({ key: "eth", label: "ETH balance now", value: `${formatEther(p.ethBalance)} ETH`, ...(addrHref ? { href: addrHref } : {}) });
  if (p.account.kind === "delegated" && p.account.delegate) {
    const name = isAddressEqual(p.account.delegate, SIMPLE_7702_ACCOUNT) ? "Simple7702Account" : "delegate";
    const href = links.address(p.account.delegate);
    rows.push({
      key: "code",
      label: "Account",
      value: `Upgraded to a smart account via EIP-7702, delegate = ${name} (${shortAddr(p.account.delegate)})`,
      ...(href ? { href } : {}),
    });
  } else {
    rows.push({ key: "code", label: "Account", value: p.account.kind === "eoa" ? "Plain address, no code" : "Contract code (not a 7702 delegation)" });
  }
  rows.push({
    key: "nonce",
    label: "Nonce",
    value: p.neverSentTx ? `${p.nonce}: used by the 7702 authorization; no transaction of its own` : String(p.nonce),
  });
  const s = p.spend;
  if (s) {
    const txHref = links.tx(s.txHash);
    rows.push({ key: "tx", label: "Spend tx", value: `${shortAddr(s.txHash, 6)}${s.success ? "" : " (userOp failed)"}`, ...(txHref ? { href: txHref } : {}) });
    rows.push({ key: "op", label: "UserOp", value: shortAddr(s.userOpHash, 6) });
    const subHref = links.address(s.submitter);
    rows.push({ key: "submitter", label: "Submitted by", value: `Bundler ${shortAddr(s.submitter)}, which fronted the ETH gas`, ...(subHref ? { href: subHref } : {}) });
    if (s.paymaster) {
      const pmHref = links.address(s.paymaster);
      rows.push({
        key: "paymaster",
        label: "Gas paid by",
        value: `${s.paymasterKind === "circle" ? "Circle Paymaster" : "Paymaster"} ${shortAddr(s.paymaster)}`,
        ...(pmHref ? { href: pmHref } : {}),
      });
      if (s.usdcFee !== null) rows.push({ key: "fee", label: "Gas fee", value: `${formatUsdc(s.usdcFee, { precise: true })} USDC (from this address, net of refund)` });
    } else {
      rows.push({ key: "paymaster", label: "Gas paid by", value: "No paymaster: the account paid its own gas" });
    }
  }
  return rows;
}

/** The one-line claim at the top: only as strong as the reads allow. */
export function proofHeadline(p: GaslessProof): string {
  const paid = !!p.spend?.paymaster && p.spend.usdcFee !== null && p.spend.usdcFee > 0n;
  if (p.ethBalance === 0n && paid) return "0 ETH here. Gas was paid in USDC by the paymaster.";
  if (p.ethBalance === 0n) return "0 ETH here.";
  return `This address holds ${formatEther(p.ethBalance)} ETH.`;
}

/** Props-only rendering of a proof. */
export function GaslessProofView({ proof, links, mock }: { proof: GaslessProof; links: Links; mock?: boolean }) {
  return (
    <NavyPanel className="gasless-proof">
      <div className="label">Gas proof · {shortAddr(proof.address)} · read live{mock ? " (mock chain)" : ""}</div>
      <div style={{ fontWeight: 500 }} data-testid="proof-headline">
        {proofHeadline(proof)}
      </div>
      <div className="rows" data-testid="proof-rows">
        {proofRows(proof, links).map((r) => (
          <div key={r.key} data-row={r.key}>
            <span className="k">{r.label}</span>
            <span style={{ textAlign: "right" }}>
              <Ext href={r.href}>{r.value}</Ext>
            </span>
          </div>
        ))}
      </div>
      <div className="body rule">
        Not claimed: that this address never received ETH, which would need a full trace of its history. What the reads show is its balance
        now, its account code and nonce, and who paid this spend's gas.
      </div>
    </NavyPanel>
  );
}

/** Reads the proof live over RPC (mock chain in mock mode) and renders it. */
export function GaslessProofPanel({ address, txHash }: { address: Address; txHash?: Hex | undefined }) {
  const svc = useServices();
  const proof = useGaslessProof(address, txHash);
  const chainId = svc.settings.chainId;
  const links: Links = svc.mock
    ? { tx: () => undefined, address: () => undefined }
    : { tx: (h) => explorerTxUrl(chainId, h), address: (a) => explorerAddressUrl(chainId, a) };
  if (proof.status === "loading") return <p className="muted">Reading {shortAddr(address)} on-chain…</p>;
  if (proof.status === "error") {
    return (
      <p className="muted">
        Couldn't read the gas proof: {proof.error}{" "}
        <button type="button" className="btn-text btn-inline" onClick={proof.refresh}>
          Retry
        </button>
      </p>
    );
  }
  return <GaslessProofView proof={proof.value} links={links} mock={svc.mock} />;
}
