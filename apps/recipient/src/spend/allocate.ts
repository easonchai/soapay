import { roundAllocate } from "@soapay/sdk";
import type { Address } from "viem";

export type SourceQuote = { address: Address; fee: bigint; maxSendable: bigint };

export type Allocation = {
  parts: { address: Address; amount: bigint; fee: bigint }[];
  /** What the destination receives. */
  receive: bigint;
  /** Sum of fee quotes (upper bounds; the paymaster refunds the unused part). */
  fees: bigint;
  /** What leaves the stealth addresses: receive + fees. */
  debit: bigint;
  sufficient: boolean;
  /** The most the given sources can deliver after fees. */
  maxReceivable: bigint;
};

/**
 * Splits `amount` across sources in the given order (suggestSources' order). Each source pays its own
 * fee from its own balance, so it can deliver at most `maxSendable`. Parts are round amounts where
 * possible (SDK `roundAllocate`, D-28), so a coworker can't sum odd spends back to a known salary.
 * Sources that end up unused are dropped: they don't send, so they don't merge.
 */
export function allocate(sources: readonly SourceQuote[], amount: bigint): Allocation {
  if (amount <= 0n) throw new Error("Amount must be positive");
  const { amounts, remaining } = roundAllocate(
    sources.map((s) => s.maxSendable),
    amount,
  );
  const parts: Allocation["parts"] = [];
  let maxReceivable = 0n;
  sources.forEach((s, i) => {
    maxReceivable += s.maxSendable > 0n ? s.maxSendable : 0n;
    if (amounts[i]! > 0n) parts.push({ address: s.address, amount: amounts[i]!, fee: s.fee });
  });
  const receive = amount - remaining;
  const fees = parts.reduce((acc, p) => acc + p.fee, 0n);
  return { parts, receive, fees, debit: receive + fees, sufficient: remaining === 0n, maxReceivable };
}
