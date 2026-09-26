// Moved from apps/sender (was lib/paypath.ts). Order: Safe export for Safes, else EIP-5792 atomic
// batch > StealthDisperse. There is deliberately no non-atomic "sequential" mode: CK's M1 fallback
// (announce, then transfer, one tx each) is dropped per PRD invariant 3 and decision-ck-integration.
// Picks how this employer's wallet pays a run (CLAUDE.md design decisions):
// - atomic batching on a smart account (or an EIP-7702 upgrade when StealthDisperse isn't deployed)
//   → one EIP-5792 `wallet_sendCalls` per chunk: [USDC.transfer, Announcer.announce] × N;
// - a plain EOA → StealthDisperse: approve the exact total, then `pay` per chunk (even when the wallet
//   offers a 7702 upgrade: wallets cap batch size far below a payroll run);
// - a Safe → Transaction Builder export through MultiSendCallOnly.
import type { Address, Hex } from "viem";

export type AccountKind = "eoa" | "delegated-eoa" | "safe" | "contract" | "unknown";

export type PayPathKind = "batch" | "disperse" | "safe" | "none";

export type PayPath = {
  kind: PayPathKind;
  /** One-line headline for the UI. */
  title: string;
  /** Why this path was chosen, in the employer's terms. */
  reason: string;
};

export type AtomicSupport = "supported" | "ready" | "unsupported" | "unknown";

/**
 * Reads the atomic-batch capability for `chainId` from a `wallet_getCapabilities` result.
 * Accepts the per-chain object (viem with chainId), a map keyed by number or hex chain id,
 * and the pre-2025 `atomicBatch: { supported }` shape.
 */
export function atomicSupport(capabilities: unknown, chainId: number): AtomicSupport {
  if (!capabilities || typeof capabilities !== "object") return "unknown";
  const caps = capabilities as Record<string, unknown>;
  const perChain =
    (caps[chainId] as Record<string, unknown> | undefined) ??
    (caps[`0x${chainId.toString(16)}`] as Record<string, unknown> | undefined) ??
    ("atomic" in caps || "atomicBatch" in caps ? caps : undefined);
  if (!perChain) return "unsupported";
  const atomic = perChain.atomic as { status?: unknown } | undefined;
  if (atomic && typeof atomic.status === "string") {
    return atomic.status === "supported" || atomic.status === "ready" ? atomic.status : "unsupported";
  }
  const legacy = perChain.atomicBatch as { supported?: unknown } | undefined;
  if (legacy && typeof legacy.supported === "boolean") return legacy.supported ? "supported" : "unsupported";
  return "unsupported";
}

/** Classifies the connected account from its code (and a Safe probe). */
export function classifyAccountCode(code: Hex | undefined, looksLikeSafe: boolean): AccountKind {
  if (!code || code === "0x") return "eoa";
  if (code.toLowerCase().startsWith("0xef0100") && code.length === 2 + 46) return "delegated-eoa";
  return looksLikeSafe ? "safe" : "contract";
}

export type PayPathInput = {
  chainId: number;
  /** Result of wallet_getCapabilities, or undefined when the wallet doesn't implement it. */
  capabilities: unknown;
  accountKind: AccountKind;
  stealthDisperse: Address | null;
  /** Whether StealthDisperse has code on this chain (checked with eth_getCode). */
  disperseDeployed: boolean;
};

export function selectPayPath(i: PayPathInput): PayPath {
  if (i.accountKind === "safe") {
    return {
      kind: "safe",
      title: "Safe: export for the Transaction Builder",
      reason:
        "This account is a Safe. Soapay builds the run as Safe transactions that DELEGATECALL MultiSendCallOnly; you propose and sign them in Safe{Wallet}.",
    };
  }

  const atomic = atomicSupport(i.capabilities, i.chainId);
  // An EOA (plain, or already delegated with EIP-7702, e.g. a MetaMask smart account) pays through
  // StealthDisperse when it's deployed, whatever batching the wallet reports: MetaMask caps EIP-5792
  // batches at 10 calls ("Batch size cannot exceed 10"), i.e. 5 lines of [transfer, announce], while
  // StealthDisperse pays up to 350 lines per tx.
  const eoaLike = i.accountKind === "eoa" || i.accountKind === "delegated-eoa";
  if (eoaLike && (atomic === "ready" || atomic === "supported") && i.stealthDisperse && i.disperseDeployed) {
    return {
      kind: "disperse",
      title: "StealthDisperse (plain account)",
      reason:
        "Your wallet can batch, but it caps a batch at a handful of calls. You approve the exact run total once, then sign one StealthDisperse payment per chunk of up to 350 lines; each pays and announces its lines in the same transaction.",
    };
  }
  if (atomic === "supported" || atomic === "ready") {
    return {
      kind: "batch",
      title: "Atomic batch (EIP-5792)",
      reason:
        atomic === "ready"
          ? "Your wallet can upgrade this account with EIP-7702 and run each chunk as one atomic batch of USDC transfers and announcements. No approval and no custom contract."
          : "Your wallet runs each chunk as one atomic batch of USDC transfers and announcements. No approval and no custom contract.",
    };
  }

  const noBatch =
    atomic === "unknown"
      ? "Your wallet doesn't report EIP-5792 capabilities, so it's treated as a plain account."
      : "Your wallet reports no atomic batching on this chain.";

  if (i.stealthDisperse && i.disperseDeployed) {
    return {
      kind: "disperse",
      title: "StealthDisperse (plain account)",
      reason: `${noBatch} You approve the exact run total once, then sign one StealthDisperse payment per chunk; each pays and announces its lines in the same transaction.`,
    };
  }

  return {
    kind: "none",
    title: "No payment path on this chain",
    reason: `${noBatch} StealthDisperse ${
      i.stealthDisperse ? "has no code at the configured address" : "isn't deployed"
    } on this chain, so only a smart wallet (atomic batching) or a Safe export can pay. Connect a smart wallet or use the Safe export.`,
  };
}
