import { getAddress, type Hex, type PublicClient } from 'viem';
import {
  computeStealthKey,
  getAnnouncements,
  getAnnouncementsForUser,
  VALID_SCHEME_ID,
  type AnnouncementLog,
} from '@scopelift/stealth-address-sdk';
import type { StealthKeys } from './keys.js';

export type LedgerEntry = {
  stealthAddress: Hex;
  ephemeralPublicKey: Hex;
  viewTag: Hex;
  /** msg.sender of announce(): the employer, or StealthDisperse. */
  caller: Hex;
  /** Best hint at who paid: metadata payer suffix when present, else caller. Untrusted. */
  payer: Hex;
  txHash: Hex;
  blockNumber: string;
  token?: Hex | undefined;
  amount?: string | undefined;
  metadata: Hex;
};

export type ScanDeps = {
  getLogs: (fromBlock: bigint, toBlock: bigint) => Promise<AnnouncementLog[]>;
  latestBlock: () => Promise<bigint>;
};

const STD_BYTES = 57; // viewTag(1) | selector(4) | token(20) | amount(32)
const PAYER_BYTES = 20; // StealthDisperse appends msg.sender

/**
 * Decodes ERC-5564 token metadata by offset. The SDK's parseMetadata insists on exactly
 * 57 bytes and throws on StealthDisperse's 77-byte layout, so we slice ourselves.
 * Token and amount are hints only; the UI reads the live balance.
 */
export function decodeErc20Metadata(metadata: Hex): { token: Hex; amount: bigint; payer?: Hex | undefined } | null {
  const hex = metadata.slice(2);
  if (hex.length < STD_BYTES * 2) return null;
  try {
    const token = getAddress(`0x${hex.slice(10, 50)}`).toLowerCase() as Hex;
    const amount = BigInt(`0x${hex.slice(50, 114)}`);
    const payer =
      hex.length >= (STD_BYTES + PAYER_BYTES) * 2
        ? (getAddress(`0x${hex.slice(114, 154)}`).toLowerCase() as Hex)
        : undefined;
    return { token, amount, payer };
  } catch {
    return null;
  }
}

export function makeGetLogs(publicClient: PublicClient, announcer: Hex): ScanDeps['getLogs'] {
  return (fromBlock, toBlock) =>
    getAnnouncements({
      clientParams: { publicClient },
      ERC5564Address: announcer,
      args: { schemeId: BigInt(VALID_SCHEME_ID.SCHEME_ID_1) },
      fromBlock,
      toBlock,
    });
}

export async function scanRange(opts: {
  keys: Pick<StealthKeys, 'spendingPublicKey' | 'viewingPrivateKey'>;
  fromBlock: bigint;
  toBlock?: bigint;
  chunkSize: bigint;
  deps: ScanDeps;
  onProgress?: (scannedTo: bigint, total: bigint) => void;
}): Promise<{ entries: LedgerEntry[]; scannedTo: bigint }> {
  const end = opts.toBlock ?? (await opts.deps.latestBlock());
  const entries: LedgerEntry[] = [];
  let from = opts.fromBlock;
  while (from <= end) {
    const to = from + opts.chunkSize - 1n < end ? from + opts.chunkSize - 1n : end;
    const logs = await opts.deps.getLogs(from, to);
    if (logs.length) {
      const mine = await getAnnouncementsForUser({
        announcements: logs,
        spendingPublicKey: opts.keys.spendingPublicKey,
        viewingPrivateKey: opts.keys.viewingPrivateKey,
      });
      for (const l of mine) {
        const erc20 = decodeErc20Metadata(l.metadata);
        const caller = l.caller.toLowerCase() as Hex;
        entries.push({
          stealthAddress: l.stealthAddress,
          ephemeralPublicKey: l.ephemeralPubKey,
          viewTag: l.metadata.slice(0, 4) as Hex,
          caller,
          payer: erc20?.payer ?? caller,
          txHash: l.transactionHash as Hex,
          blockNumber: String(l.blockNumber),
          token: erc20?.token,
          amount: erc20 ? String(erc20.amount) : undefined,
          metadata: l.metadata,
        });
      }
    }
    opts.onProgress?.(to, end);
    from = to + 1n;
  }
  return { entries, scannedTo: end };
}

export function mergeLedger(existing: LedgerEntry[], incoming: LedgerEntry[]): LedgerEntry[] {
  const map = new Map<string, LedgerEntry>();
  for (const e of [...existing, ...incoming]) map.set(`${e.txHash}:${e.stealthAddress.toLowerCase()}`, e);
  return [...map.values()].sort((a, b) => (BigInt(a.blockNumber) < BigInt(b.blockNumber) ? -1 : 1));
}

/** Private key that controls one stealth address. Computed on demand, never stored. */
export function spendingKeyFor(
  entry: Pick<LedgerEntry, 'ephemeralPublicKey'>,
  keys: Pick<StealthKeys, 'spendingPrivateKey' | 'viewingPrivateKey'>,
): Hex {
  return computeStealthKey({
    ephemeralPublicKey: entry.ephemeralPublicKey,
    schemeId: VALID_SCHEME_ID.SCHEME_ID_1,
    spendingPrivateKey: keys.spendingPrivateKey,
    viewingPrivateKey: keys.viewingPrivateKey,
  });
}

/** Headline total from live balances only. Metadata amounts are announcer-controlled and untrusted. */
export function sumLiveBalances(ledger: Pick<LedgerEntry, 'stealthAddress'>[], balances: Record<string, string>): bigint {
  let total = 0n;
  for (const e of ledger) {
    const b = balances[e.stealthAddress];
    if (b && /^\d+$/.test(b)) total += BigInt(b);
  }
  return total;
}
