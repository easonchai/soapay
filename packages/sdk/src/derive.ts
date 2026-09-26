import type { Hex } from 'viem';
import { generateStealthAddress, buildMetadataForERC20, VALID_SCHEME_ID } from '@scopelift/stealth-address-sdk';
import { metaAddressToURI } from './keys.js';

/** contracts/PLAN.md: ~42k gas per line; 350 keeps margin under the per-tx cap. */
export const MAX_LINES_PER_RUN = 350;

export type RecipientAmount = { input: string; metaAddress: Hex; amount: bigint };

/** One line to pay: a recipient, possibly one chunk of their amount. */
export type PayLine = RecipientAmount & {
  /** 0-based position among this recipient's lines. */
  chunkIndex: number;
  /** Total lines this recipient has in the run. */
  chunkCount: number;
  /** True for the single smaller final line when the amount is not a multiple of the chunk. */
  isRemainder: boolean;
};

export type PlannedRow = PayLine & {
  stealthAddress: Hex;
  ephemeralPublicKey: Hex;
  viewTag: Hex;
  metadata: Hex;
};

export class DuplicateStealthAddressError extends Error {
  constructor(addr: string) {
    super(`Duplicate stealth address in batch: ${addr}. Regenerate and retry.`);
  }
}

export class DuplicateEphemeralKeyError extends Error {
  constructor(key: string) {
    super(`Ephemeral key repeated across lines: ${key}. Randomness failure, regenerate and retry.`);
  }
}

export class TooManyLinesError extends Error {
  constructor(public readonly lines: number) {
    super(`This run has ${lines} lines; the cap is ${MAX_LINES_PER_RUN} per transaction. Raise the chunk size or split the run.`);
  }
}

/**
 * Denominated payouts: each amount becomes floor(amount / chunk) lines of `chunk`, plus one
 * smaller final line for the remainder. On chain the batch then reads as many identical
 * transfers to unrelated addresses. With no chunk, each recipient is one line.
 */
export function expandDenominated(rows: RecipientAmount[], chunk?: bigint): PayLine[] {
  if (chunk !== undefined && chunk <= 0n) throw new Error('Chunk size must be greater than zero');
  const out: PayLine[] = [];
  for (const r of rows) {
    if (chunk === undefined || r.amount <= chunk) {
      out.push({ ...r, chunkIndex: 0, chunkCount: 1, isRemainder: chunk !== undefined && r.amount < chunk });
      continue;
    }
    const full = Number(r.amount / chunk);
    const rem = r.amount % chunk;
    const count = full + (rem > 0n ? 1 : 0);
    for (let i = 0; i < full; i++) out.push({ ...r, amount: chunk, chunkIndex: i, chunkCount: count, isRemainder: false });
    if (rem > 0n) out.push({ ...r, amount: rem, chunkIndex: full, chunkCount: count, isRemainder: true });
  }
  return out;
}

/**
 * Fresh stealth address per line with ERC-20 metadata. Output is sorted strictly ascending
 * by stealth address (StealthDisperse requires it); duplicates and repeated ephemeral keys throw.
 */
export function deriveRows(rows: RecipientAmount[], token: Hex, opts: { chunk?: bigint | undefined } = {}): PlannedRow[] {
  const lines = expandDenominated(rows, opts.chunk);
  if (lines.length > MAX_LINES_PER_RUN) throw new TooManyLinesError(lines.length);
  const planned: PlannedRow[] = lines.map((l) => {
    const g = generateStealthAddress({
      stealthMetaAddressURI: metaAddressToURI(l.metaAddress),
      schemeId: VALID_SCHEME_ID.SCHEME_ID_1,
    });
    // Lowercase so byte equality holds against ABI-decoded values.
    const metadata = buildMetadataForERC20({ viewTag: g.viewTag, tokenAddress: token, amount: l.amount }).toLowerCase() as Hex;
    return { ...l, stealthAddress: g.stealthAddress, ephemeralPublicKey: g.ephemeralPublicKey, viewTag: g.viewTag, metadata };
  });
  planned.sort((a, b) => (BigInt(a.stealthAddress) < BigInt(b.stealthAddress) ? -1 : 1));
  const seenKeys = new Set<string>();
  let prev: PlannedRow | undefined;
  for (const row of planned) {
    if (prev && row.stealthAddress.toLowerCase() === prev.stealthAddress.toLowerCase()) {
      throw new DuplicateStealthAddressError(row.stealthAddress);
    }
    const k = row.ephemeralPublicKey.toLowerCase();
    if (seenKeys.has(k)) throw new DuplicateEphemeralKeyError(k);
    seenKeys.add(k);
    prev = row;
  }
  return planned;
}
