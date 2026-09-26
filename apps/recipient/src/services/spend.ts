/**
 * Spend service: a thin seam over the SDK's spend module so the UI can run against a real bundler or
 * the in-browser mock. The SDK does all signing; stealth keys exist only for the duration of a call.
 */
import {
  createSpendClient,
  defaultPaymasterMode,
  estimateSpend,
  spendMany,
  type SpendClient,
  type SpendParams,
  type SpendResult,
} from "@soapay/sdk";
import type { Chain, PublicClient, Transport } from "viem";

export type SpendQuote = {
  from: `0x${string}`;
  fee: bigint;
  balance: bigint;
  maxSendable: bigint;
  delegated: boolean;
};

export type SendProgress = (done: number, total: number) => void;

export interface SpendService {
  readonly ready: boolean;
  /** Why the service is unavailable (e.g. no bundler URL). */
  readonly unavailableReason?: string;
  /** Quote with `amount: "max"` to learn the fee and the most this address can send. */
  quote(stealthKey: `0x${string}`, to: `0x${string}`): Promise<SpendQuote>;
  /** One userOp per address, sequential, with random delays between them. */
  sendAll(spends: readonly SpendParams[], onProgress?: SendProgress): Promise<SpendResult[]>;
}

/** Pause between userOps: a fixed floor plus jitter so the sends don't share a block or a rhythm. */
export const SPEND_DELAY_MS = 4_000;
export const SPEND_JITTER_MS = 20_000;

/** Why sending from a stealth address can't work with these settings (null = it can). Shared by Send and dApps. */
export function spendUnavailableReason(opts: { chainId: number; bundlerUrl: string; paymasterUrl?: string | undefined }): string | null {
  if (!opts.bundlerUrl) return "Add a bundler URL in Settings to send.";
  if (defaultPaymasterMode(opts.chainId) === "sponsored" && !opts.paymasterUrl)
    return "Add the Soapay API URL in Settings: gas on this testnet is sponsored through it.";
  return null;
}

export function createSdkSpendService(opts: {
  chainId: number;
  bundlerUrl: string;
  publicClient: PublicClient<Transport, Chain>;
  /** The Soapay API's `/paymaster` (sponsored gas on Base Sepolia, D-52). Unused where gas is paid in USDC. */
  paymasterUrl?: string;
}): SpendService {
  const unavailable = spendUnavailableReason(opts);
  if (unavailable) {
    const fail = () => Promise.reject(new Error(unavailable));
    return { ready: false, unavailableReason: unavailable, quote: fail, sendAll: fail };
  }
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
    async quote(stealthKey, to) {
      const e = await estimateSpend(get(), { stealthKey, to, amount: "max" });
      return { from: e.from, fee: e.fee, balance: e.balance, maxSendable: e.maxSendable, delegated: e.delegated };
    },
    async sendAll(spends, onProgress) {
      let done = 0;
      onProgress?.(0, spends.length);
      const results = await spendMany(get(), spends, {
        wait: true,
        delayMs: SPEND_DELAY_MS,
        jitterMs: SPEND_JITTER_MS,
        // spendMany has no progress callback; it sleeps between sends, so each sleep marks one done.
        sleep: (ms) => {
          onProgress?.(++done, spends.length);
          return new Promise((r) => setTimeout(r, ms));
        },
      });
      onProgress?.(spends.length, spends.length);
      return results;
    },
  };
}
