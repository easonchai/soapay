import { createClient, hexToBigInt, http, HttpRequestError, numberToHex, type Address, type Hex, type Transport } from "viem";
import { formatUserOperationRequest } from "viem/account-abstraction";
import { getSpendChainConfig } from "../constants.js";
import type { PaymasterAdapter, PaymasterContext, PaymasterFields, PaymasterUserOperation } from "./types.js";

/**
 * Gas sponsorship (ERC-7677 `pm_getPaymasterStubData` / `pm_getPaymasterData`), TESTNET ONLY (D-52).
 *
 * The stealth address pays nothing: no fee token, no permit, no approve. The paymaster endpoint is
 * the Soapay API's `POST /paymaster`, a proxy that holds the Pimlico key server-side and only
 * sponsors userOps whose calls target an allow-list (the pay token, Permit2, the Universal Router).
 * The key never reaches a browser. Mainnet keeps the Circle USDC paymaster.
 */
export type SponsoredPaymasterOptions = {
  /** ERC-7677 paymaster endpoint, e.g. `${API_URL}/paymaster`. Either this or `transport`. */
  url?: string;
  /** Custom transport (tests). Overrides `url`. */
  transport?: Transport;
  /** Optional ERC-7677 context (e.g. `{ sponsorshipPolicyId }`); the proxy may set its own. */
  context?: Record<string, unknown>;
};

/** Thrown when the paymaster proxy has no sponsorship configured (503 `sponsorship_disabled`). */
export class SponsorshipUnavailableError extends Error {
  override name = "SponsorshipUnavailableError";
  constructor(message = "Gas sponsorship is off on this server (no paymaster key). Spends on this testnet can't be sent until it's configured.") {
    super(message);
  }
}

type RpcPaymasterFields = {
  paymaster: Address;
  paymasterData: Hex;
  paymasterVerificationGasLimit?: Hex;
  paymasterPostOpGasLimit?: Hex;
  isFinal?: boolean;
};

function isSponsorshipDisabled(err: unknown): boolean {
  let e: unknown = err;
  for (let i = 0; i < 5 && e; i++) {
    if (e instanceof HttpRequestError && e.status === 503) return true;
    const msg = (e as { message?: string; details?: string }).details ?? (e as { message?: string }).message ?? "";
    if (/sponsorship_disabled/.test(msg)) return true;
    e = (e as { cause?: unknown }).cause;
  }
  return false;
}

export function sponsoredPaymaster(options: SponsoredPaymasterOptions): PaymasterAdapter {
  const transport = options.transport ?? (options.url ? http(options.url, { retryCount: 0 }) : undefined);
  if (!transport) throw new Error("Soapay sponsored paymaster: url is required");
  const client = createClient({ transport });

  async function pm(method: "pm_getPaymasterStubData" | "pm_getPaymasterData", op: PaymasterUserOperation, ctx: PaymasterContext) {
    let res: RpcPaymasterFields;
    // At stub time viem has not estimated gas yet; Pimlico's schema wants the fields present, so
    // send zeros (the stub is only used to estimate, as ERC-7677 intends).
    const filled = {
      ...op,
      callGasLimit: op.callGasLimit ?? 0n,
      verificationGasLimit: op.verificationGasLimit ?? 0n,
      preVerificationGas: op.preVerificationGas ?? 0n,
    } as PaymasterUserOperation;
    try {
      res = (await client.request({
        method: method as never,
        params: [formatUserOperationRequest(filled), ctx.entryPoint, numberToHex(ctx.chainId), options.context ?? {}] as never,
      })) as RpcPaymasterFields;
    } catch (err) {
      if (isSponsorshipDisabled(err)) throw new SponsorshipUnavailableError();
      throw err;
    }
    const out: PaymasterFields = { paymaster: res.paymaster, paymasterData: res.paymasterData };
    if (res.paymasterVerificationGasLimit) out.paymasterVerificationGasLimit = hexToBigInt(res.paymasterVerificationGasLimit);
    if (res.paymasterPostOpGasLimit) out.paymasterPostOpGasLimit = hexToBigInt(res.paymasterPostOpGasLimit);
    if (res.isFinal !== undefined) out.isFinal = res.isFinal;
    return out;
  }

  return {
    name: "sponsored",
    // Nothing is charged; the pay token keeps the spend planner's "same token" arithmetic trivial.
    feeToken: (chainId) => getSpendChainConfig(chainId).usdc,
    getPaymasterStubData: (op, ctx) => pm("pm_getPaymasterStubData", op, ctx),
    getPaymasterData: (op, ctx) => pm("pm_getPaymasterData", op, ctx),
    quoteMaxFee: async () => 0n,
  };
}
