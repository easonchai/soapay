// Pay-run batch reconstruction from public data (D-41): "same transaction, two views".
//
// Given one transaction, rebuild every line a coworker can see on-chain: each ERC-5564 Announcement
// (scheme 1, canonical Announcer) in that transaction and the token actually transferred to its
// stealth address by Transfer logs of the same transaction. Nothing here needs a key; "which lines
// are mine" is a separate step (`markOwnLines`) that takes the addresses the scanner already matched.
//
// Amounts come from Transfer logs only, never from announcement metadata (a hint anyone can forge).
import { decodeEventLog, getAddress, isAddressEqual, type Address, type Hex, type PublicClient } from "viem";
import { announcerAbi, erc20Abi } from "./abis.js";
import { ANNOUNCER_ADDRESS, SCHEME_ID, getChainConfig } from "./constants.js";

/** The subset of a log (viem `Log`) that reconstruction reads. */
export type ReceiptLog = {
  address: Address;
  topics: readonly Hex[];
  data: Hex;
  logIndex: number | bigint | null;
};

/** The subset of a transaction receipt that reconstruction reads. */
export type BatchReceipt = {
  transactionHash: Hex;
  blockNumber: bigint;
  /** The transaction's sender (the employer's EOA, a smart account, or a bundler for a userOp). */
  from: Address;
  /** The called contract (StealthDisperse, a smart account, MultiSendCallOnly, …). */
  to: Address | null;
  status?: "success" | "reverted";
  logs: readonly ReceiptLog[];
};

export type PayRunBatchLine = {
  /** Position in the batch, 0-based, in announcement log order (strictly ascending by address on StealthDisperse). */
  index: number;
  stealthAddress: Address;
  /**
   * Token units transferred to this stealth address by this transaction, summed over its Transfer
   * logs. null when the transaction announced the address but moved no `token` to it.
   */
  amount: bigint | null;
  /** Payer of the Transfer(s) to this address (the `from` of the first one), or null without one. */
  payer: Address | null;
  /** `Announcement.caller`: StealthDisperse, or the payer's smart account on the batch path. */
  caller: Address;
  ephemeralPubKey: Hex;
  metadata: Hex;
  logIndex: number;
};

export type PayRunBatch = {
  txHash: Hex;
  blockNumber: bigint;
  from: Address;
  to: Address | null;
  token: Address;
  lines: PayRunBatchLine[];
  /** Sum of the known line amounts. */
  total: bigint;
  /** Lines with no Transfer of `token` in this transaction (shown, never guessed). */
  unfunded: number;
};

function asIndex(i: number | bigint | null): number {
  return i === null ? -1 : Number(i);
}

/**
 * Rebuilds the batch from a receipt. Pure. Only scheme-1 Announcements emitted by `announcer` and
 * Transfer logs emitted by `token` count; everything else in the receipt is ignored.
 */
export function payRunBatchFromReceipt(
  receipt: BatchReceipt,
  opts: { token: Address; announcer?: Address },
): PayRunBatch {
  const announcer = opts.announcer ?? ANNOUNCER_ADDRESS;
  const received = new Map<string, { amount: bigint; payer: Address }>();
  const anns: Omit<PayRunBatchLine, "index" | "amount" | "payer">[] = [];

  for (const log of receipt.logs) {
    if (isAddressEqual(log.address, opts.token)) {
      try {
        const ev = decodeEventLog({ abi: erc20Abi, eventName: "Transfer", topics: log.topics as [Hex, ...Hex[]], data: log.data });
        const k = ev.args.to.toLowerCase();
        const prev = received.get(k);
        received.set(k, { amount: (prev?.amount ?? 0n) + ev.args.value, payer: prev?.payer ?? getAddress(ev.args.from) });
      } catch {
        // Approval or another event of the token contract.
      }
      continue;
    }
    if (!isAddressEqual(log.address, announcer)) continue;
    try {
      const ev = decodeEventLog({ abi: announcerAbi, eventName: "Announcement", topics: log.topics as [Hex, ...Hex[]], data: log.data });
      if (ev.args.schemeId !== BigInt(SCHEME_ID)) continue;
      anns.push({
        stealthAddress: getAddress(ev.args.stealthAddress),
        caller: getAddress(ev.args.caller),
        ephemeralPubKey: ev.args.ephemeralPubKey,
        metadata: ev.args.metadata,
        logIndex: asIndex(log.logIndex),
      });
    } catch {
      // Not an Announcement.
    }
  }

  anns.sort((a, b) => a.logIndex - b.logIndex);
  let total = 0n;
  let unfunded = 0;
  const lines = anns.map((a, index): PayRunBatchLine => {
    const r = received.get(a.stealthAddress.toLowerCase());
    if (r) total += r.amount;
    else unfunded++;
    return { index, ...a, amount: r?.amount ?? null, payer: r?.payer ?? null };
  });

  return {
    txHash: receipt.transactionHash,
    blockNumber: receipt.blockNumber,
    from: getAddress(receipt.from),
    to: receipt.to ? getAddress(receipt.to) : null,
    token: getAddress(opts.token),
    lines,
    total,
    unfunded,
  };
}

/** Reads one transaction's receipt and rebuilds its batch (USDC of `chainId` unless `token` is given). */
export async function fetchPayRunBatch(params: {
  client: Pick<PublicClient, "getTransactionReceipt">;
  txHash: Hex;
  chainId: number;
  token?: Address;
  announcer?: Address;
}): Promise<PayRunBatch> {
  const receipt = await params.client.getTransactionReceipt({ hash: params.txHash });
  return payRunBatchFromReceipt(receipt as unknown as BatchReceipt, {
    token: params.token ?? getChainConfig(params.chainId).usdc,
    ...(params.announcer ? { announcer: params.announcer } : {}),
  });
}

export type OwnedBatchLine = PayRunBatchLine & { mine: boolean };

export type OwnedBatch = Omit<PayRunBatch, "lines"> & {
  lines: OwnedBatchLine[];
  /** How many lines the viewer owns, and their summed transfer amounts. */
  mineCount: number;
  mineTotal: bigint;
};

/**
 * Marks the lines whose stealth address is in `mine` (addresses the viewer's scanner matched with
 * its viewing key). The rest stay anonymous; nothing about them is inferred.
 */
export function markOwnLines(batch: PayRunBatch, mine: Iterable<Address>): OwnedBatch {
  const own = new Set([...mine].map((a) => a.toLowerCase()));
  let mineCount = 0;
  let mineTotal = 0n;
  const lines = batch.lines.map((l) => {
    const isMine = own.has(l.stealthAddress.toLowerCase());
    if (isMine) {
      mineCount++;
      mineTotal += l.amount ?? 0n;
    }
    return { ...l, mine: isMine };
  });
  return { ...batch, lines, mineCount, mineTotal };
}
