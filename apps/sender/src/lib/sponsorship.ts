// Base Sepolia demo helpers (D-52): the welcome drop (mock USDC for a wallet that opens the company
// app) and gas sponsorship for smart-wallet employers (EIP-5792 `paymasterService` → the API's
// /paymaster proxy). Pure, apart from the injected fetch. Mainnet never takes these paths.
import { defaultPaymasterMode } from "@soapay/sdk";
import type { Address, Hash } from "viem";

/** The chain the mock token, the faucet and the sponsorship live on. */
export const SPONSORED_CHAIN_ID = 84532;

/** Absolute API base (the demo build uses a relative "/api"; wallets need a full URL). */
export function absoluteApiUrl(apiUrl: string | undefined, origin?: string): string | null {
  if (!apiUrl) return null;
  try {
    const base = origin ?? (typeof window !== "undefined" ? window.location.origin : undefined);
    return new URL(apiUrl.replace(/\/+$/, ""), base).toString().replace(/\/+$/, "");
  } catch {
    return null;
  }
}

/**
 * The ERC-7677 paymaster URL to hand the wallet with `wallet_sendCalls`, or null where gas isn't
 * sponsored (mainnet: the employer pays its own gas) or no API is configured.
 */
export function paymasterServiceUrl(app: { chainId: number; apiUrl: string | undefined }, origin?: string): string | null {
  if (defaultPaymasterMode(app.chainId) !== "sponsored") return null;
  const api = absoluteApiUrl(app.apiUrl, origin);
  return api ? `${api}/paymaster` : null;
}

/** Reads `paymasterService.supported` for `chainId` from a wallet_getCapabilities result (either shape). */
export function walletSupportsPaymaster(capabilities: unknown, chainId: number): boolean {
  if (!capabilities || typeof capabilities !== "object") return false;
  const caps = capabilities as Record<string, unknown>;
  const perChain =
    (caps[chainId] as Record<string, unknown> | undefined) ??
    (caps[`0x${chainId.toString(16)}`] as Record<string, unknown> | undefined) ??
    ("paymasterService" in caps ? caps : undefined);
  const pm = perChain?.paymasterService as { supported?: unknown } | undefined;
  return pm?.supported === true;
}

/** The capabilities to pass with `wallet_sendCalls`: an optional paymaster where gas is sponsored. */
export function sendCallsCapabilities(app: { chainId: number; apiUrl: string | undefined }, origin?: string) {
  const url = paymasterServiceUrl(app, origin);
  // optional: a wallet without the capability still sends the batch (and pays its own gas).
  return url ? { paymasterService: { url, optional: true } } : undefined;
}

export type WelcomeDrop =
  | { status: "sent"; address: Address; usdc: { amount: string; txHash: Hash }; eth: { amount: string; txHash: Hash } | null }
  | { status: "already_claimed"; address: Address };

/** Whether this build asks the API for the welcome drop (Base Sepolia, a real API, not dev mock mode). */
export function welcomeDropEnabled(app: { chainId: number; apiUrl: string | undefined; mockEns: boolean }): boolean {
  return app.chainId === SPONSORED_CHAIN_ID && !!app.apiUrl && !app.mockEns;
}

/**
 * POST /faucet once for `address`. Resolves null when the drop is off or failed: the app shows
 * nothing then (it's a convenience, never a blocker).
 */
export async function requestWelcomeDrop(apiUrl: string, address: Address, fetchFn: typeof fetch = (u, i) => fetch(u, i)): Promise<WelcomeDrop | null> {
  try {
    const res = await fetchFn(`${apiUrl.replace(/\/+$/, "")}/faucet`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ address }),
      credentials: "omit",
    });
    if (!res.ok) return null;
    const body = (await res.json()) as WelcomeDrop;
    return body?.status === "sent" || body?.status === "already_claimed" ? body : null;
  } catch {
    return null;
  }
}

/** "Welcome: 1,000,000 test USDC sent to your wallet". */
export function welcomeMessage(drop: Extract<WelcomeDrop, { status: "sent" }>): string {
  const whole = BigInt(drop.usdc.amount) / 1_000_000n;
  return `Welcome: ${whole.toLocaleString("en-US")} test USDC sent to your wallet`;
}
