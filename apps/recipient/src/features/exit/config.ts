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

/** How long a live fee quote (Iris, relayer, Sepolia gas) is reused before the planner refreshes it. */
export const EXIT_QUOTE_TTL_MS = 5 * 60_000;

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
