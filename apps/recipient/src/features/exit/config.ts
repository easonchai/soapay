/**
 * Exit route config (docs/exit-research.md). The testnet demo route is Base Sepolia → Ethereum Sepolia,
 * into 0xbow's USDC pool. The production chain is undecided, so other source chains get no route.
 */
import { EXIT_CONFIGS } from "@soapay/sdk";
import type { ExitConfig } from "./types.js";

const BASE_SEPOLIA = 84532;
const ETH_SEPOLIA = 11155111;

/** The SDK's testnet route (addresses verified on-chain in docs/exit-research.md). */
export const TESTNET_EXIT_CONFIG: ExitConfig = EXIT_CONFIGS[`${BASE_SEPOLIA}:${ETH_SEPOLIA}`]!;

/** The exit route for a source chain, or null when none is configured. */
export function exitConfigFor(sourceChainId: number): ExitConfig | null {
  return Object.values(EXIT_CONFIGS).find((c) => c.source === sourceChainId) ?? null;
}

/**
 * Fee estimates for the planner, in USDC base units (6 dp). Sources: docs/exit-research.md §1, §3.
 * Paymaster gas is our estimate for one 7702 userOp paid in USDC through the Circle paymaster.
 */
export const EXIT_FEES = {
  /** Circle Forwarding Service, live quote low / high (1.54 / 2.21 USDC). */
  forwardLow: 1_540_000n,
  forwardHigh: 2_210_000n,
  /** CCTP fast-transfer protocol fee: 1.3 bps, as a fraction over 100_000. */
  cctpProtocolPer100k: 13n,
  /** 0xbow relayer fee, bps of the withdrawn amount. */
  relayerBps: 10n,
  /** Paymaster gas for the burn userOp on the source chain. */
  sourceGas: 50_000n,
  /** Paymaster gas for the approve + deposit userOp on the destination chain. */
  destGas: 400_000n,
} as const;

const EXPLORERS: Record<number, { name: string; url: string }> = {
  8453: { name: "Basescan", url: "https://basescan.org" },
  84532: { name: "Basescan Sepolia", url: "https://sepolia.basescan.org" },
  1: { name: "Etherscan", url: "https://etherscan.io" },
  11155111: { name: "Etherscan Sepolia", url: "https://sepolia.etherscan.io" },
  10: { name: "Optimism Etherscan", url: "https://optimistic.etherscan.io" },
};

export function exitTxLink(chainId: number, hash: string): { name: string; href: string } | null {
  const e = EXPLORERS[chainId];
  return e ? { name: e.name, href: `${e.url}/tx/${hash}` } : null;
}

export function exitChainName(chainId: number): string {
  return chainId === BASE_SEPOLIA ? "Base Sepolia" : chainId === ETH_SEPOLIA ? "Ethereum Sepolia" : `chain ${chainId}`;
}
