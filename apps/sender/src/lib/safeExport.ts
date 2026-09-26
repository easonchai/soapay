// Safe (multisig) export. A Safe can't sign an EIP-5792 batch from here, so each chunk
// becomes one Safe transaction: the Safe DELEGATECALLs the canonical MultiSendCallOnly
// v1.4.1, which runs `[USDC.transfer, Announcer.announce] × N` as plain CALLs with the
// Safe as msg.sender. No approval, no custom contract, and never `MultiSend` (which
// would allow inner delegatecalls).
import type { Address } from "viem";
import {
  encodeBatchCalls,
  encodeSafeMultiSendCallOnly,
  toSafeTxBuilderJson,
  type SafeMultiSendTx,
  type SafeTxBuilderBatch,
} from "@soapay/sdk";
import type { RunPlan } from "./run.js";

export type SafeExportChunk = {
  index: number;
  lines: number;
  fileName: string;
  /** Safe Transaction Builder batch (drag-and-drop import). */
  builder: SafeTxBuilderBatch;
  /** The equivalent single Safe transaction, for signers who build it by hand. */
  multiSend: SafeMultiSendTx;
};

export function buildSafeExport(
  plan: RunPlan,
  opts: { token: Address; chainId: number; safeAddress: Address; createdAt: number; runLabel: string },
): SafeExportChunk[] {
  const batches = encodeBatchCalls({ token: opts.token, lines: plan.lines });
  const n = batches.length;
  return batches.map((b, i) => {
    const part = n > 1 ? ` (${i + 1} of ${n})` : "";
    return {
      index: i,
      lines: b.calls.length / 2,
      fileName: `soapay-${opts.runLabel}${n > 1 ? `-${i + 1}-of-${n}` : ""}.json`,
      builder: toSafeTxBuilderJson(b.calls, {
        chainId: opts.chainId,
        safeAddress: opts.safeAddress,
        name: `Soapay pay run ${opts.runLabel}${part}`,
        description: `${b.calls.length / 2} stealth payments: USDC transfer + ERC-5564 announcement each. Execute every part.`,
        createdAt: opts.createdAt,
      }),
      multiSend: encodeSafeMultiSendCallOnly(b.calls),
    };
  });
}

export function downloadJson(fileName: string, value: unknown): void {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
