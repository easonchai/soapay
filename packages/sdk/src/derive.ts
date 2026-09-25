import type { Hex } from 'viem';
import { generateStealthAddress, buildMetadataForERC20, VALID_SCHEME_ID } from '@scopelift/stealth-address-sdk';
import { metaAddressToURI } from './keys.js';

export type PlannedRow = {
  input: string;
  metaAddress: Hex;
  amount: bigint;
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

/**
 * Fresh stealth address per row with ERC-20 metadata. Output is sorted strictly ascending
 * by stealth address (StealthDisperse requires it); duplicates and repeated ephemeral keys throw.
 */
export function deriveRows(
  rows: { input: string; metaAddress: Hex; amount: bigint }[],
  token: Hex,
): PlannedRow[] {
  const planned: PlannedRow[] = rows.map((r) => {
    const g = generateStealthAddress({
      stealthMetaAddressURI: metaAddressToURI(r.metaAddress),
      schemeId: VALID_SCHEME_ID.SCHEME_ID_1,
    });
    // Lowercase so byte equality holds against ABI-decoded values.
    const metadata = buildMetadataForERC20({ viewTag: g.viewTag, tokenAddress: token, amount: r.amount }).toLowerCase() as Hex;
    return {
      ...r,
      stealthAddress: g.stealthAddress,
      ephemeralPublicKey: g.ephemeralPublicKey,
      viewTag: g.viewTag,
      metadata,
    };
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
