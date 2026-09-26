import { encodeFunctionData, erc20Abi, getAddress, hexToBigInt, numberToHex, type Address, type Hex } from "viem";
import { formatUserOperationRequest } from "viem/account-abstraction";
import { getSpendChainConfig } from "../constants.js";
import { userOpMaxCost } from "./circle.js";
import type { PaymasterAdapter, PaymasterContext, PaymasterFields, PaymasterUserOperation } from "./types.js";

/**
 * Pimlico ERC-20 paymaster (EXPERIMENTAL, not live-verified). Talks to the bundler URL, which must
 * be a Pimlico endpoint:
 * - `pimlico_getTokenQuotes` → paymaster address, postOpGas and exchangeRate
 * - `pm_getPaymasterStubData` / `pm_getPaymasterData` with context `{ token }`
 * Docs: https://docs.pimlico.io/references/paymaster/erc20-paymaster/endpoints/
 *
 * Unlike Circle it has no permit path, so an `approve(paymaster, maxFee)` runs inside the same userOp
 * (executeBatch). That changes the calldata shape, a larger fingerprint than Circle's single execute.
 */
export function pimlicoErc20Paymaster(options: { token?: (chainId: number) => Address } = {}): PaymasterAdapter {
  const feeToken = (chainId: number) => options.token?.(chainId) ?? getSpendChainConfig(chainId).usdc;

  type Quote = { paymaster: Address; postOpGas: bigint; exchangeRate: bigint };
  async function quote(ctx: PaymasterContext): Promise<Quote> {
    const res = (await ctx.bundlerClient.request({
      method: "pimlico_getTokenQuotes" as never,
      params: [{ tokens: [feeToken(ctx.chainId)] }, ctx.entryPoint, numberToHex(ctx.chainId)] as never,
    })) as { quotes: { paymaster: Address; postOpGas: Hex; exchangeRate: Hex }[] };
    const q = res.quotes[0];
    if (!q) throw new Error("Pimlico: token not supported by the ERC-20 paymaster");
    return { paymaster: getAddress(q.paymaster), postOpGas: hexToBigInt(q.postOpGas), exchangeRate: hexToBigInt(q.exchangeRate) };
  }

  async function pm(method: "pm_getPaymasterStubData" | "pm_getPaymasterData", op: PaymasterUserOperation, ctx: PaymasterContext) {
    const res = (await ctx.bundlerClient.request({
      method: method as never,
      params: [
        formatUserOperationRequest(op),
        ctx.entryPoint,
        numberToHex(ctx.chainId),
        { token: feeToken(ctx.chainId) },
      ] as never,
    })) as { paymaster: Address; paymasterData: Hex; paymasterVerificationGasLimit?: Hex; paymasterPostOpGasLimit?: Hex; isFinal?: boolean };
    const out: PaymasterFields = { paymaster: res.paymaster, paymasterData: res.paymasterData };
    if (res.paymasterVerificationGasLimit) out.paymasterVerificationGasLimit = hexToBigInt(res.paymasterVerificationGasLimit);
    if (res.paymasterPostOpGasLimit) out.paymasterPostOpGasLimit = hexToBigInt(res.paymasterPostOpGasLimit);
    if (res.isFinal !== undefined) out.isFinal = res.isFinal;
    return out;
  }

  return {
    name: "pimlico-erc20",
    feeToken,
    async prepareCalls(ctx) {
      const { paymaster } = await quote(ctx);
      return [
        {
          to: feeToken(ctx.chainId),
          data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [paymaster, ctx.maxFee] }),
          value: 0n,
        },
      ];
    },
    getPaymasterStubData: (op, ctx) => pm("pm_getPaymasterStubData", op, ctx),
    getPaymasterData: (op, ctx) => pm("pm_getPaymasterData", op, ctx),
    async quoteMaxFee(op, ctx) {
      const q = await quote(ctx);
      return ((userOpMaxCost(op) + q.postOpGas * op.maxFeePerGas) * q.exchangeRate) / 10n ** 18n + 1n;
    },
  };
}
