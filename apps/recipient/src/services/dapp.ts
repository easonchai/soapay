/**
 * dApp execution service (WalletConnect, D-61): a thin seam over the SDK so the router can run
 * against a real bundler or the in-browser mock. Same path as Send: ONE userOp from ONE stealth
 * address, 7702 delegation on first use, gas through the chain's paymaster.
 */
import { createSpendClient, executeFromStealth, waitForStealthExecution, type SpendClient, type StealthCall, type StealthInclusion } from "@soapay/sdk";
import type { Chain, Hex, PublicClient, Transport } from "viem";
import { spendUnavailableReason } from "./spend.js";

export type DappExecution = { userOpHash: Hex; included: Promise<StealthInclusion> };

export interface DappService {
  readonly ready: boolean;
  readonly unavailableReason?: string;
  /** Submits the calls as one userOp; resolves once the bundler accepted it, `included` once it landed. */
  execute(stealthKey: Hex, calls: readonly StealthCall[]): Promise<DappExecution>;
}

/** How long to wait for a userOp to land before telling the dApp it failed. */
export const DAPP_INCLUSION_TIMEOUT_MS = 120_000;

export function createSdkDappService(opts: {
  chainId: number;
  bundlerUrl: string;
  publicClient: PublicClient<Transport, Chain>;
  paymasterUrl?: string;
}): DappService {
  const unavailable = spendUnavailableReason(opts);
  if (unavailable) return { ready: false, unavailableReason: unavailable, execute: () => Promise.reject(new Error(unavailable)) };
  let client: SpendClient | null = null;
  const get = () =>
    (client ??= createSpendClient({
      chainId: opts.chainId,
      bundlerUrl: opts.bundlerUrl,
      publicClient: opts.publicClient,
      ...(opts.paymasterUrl ? { paymasterUrl: opts.paymasterUrl } : {}),
    }));
  return {
    ready: true,
    async execute(stealthKey, calls) {
      const c = get();
      const sent = await executeFromStealth(c, { stealthKey, calls }, { wait: false });
      return { userOpHash: sent.userOpHash, included: waitForStealthExecution(c, sent.userOpHash, { timeout: DAPP_INCLUSION_TIMEOUT_MS }) };
    },
  };
}
