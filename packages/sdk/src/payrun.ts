// Pay-run derivation and calldata (docs/mvp-spec.md §1, §3).
//
// Sender-app invariants enforced here (CLAUDE.md), since the contract can't:
// - every line of a run is derived first, then sorted GLOBALLY by stealth address;
// - multi-tx runs are cut into roughly equal consecutive chunks, never by recipient;
// - no ephemeral key is reused, no stealth address repeats;
// - approvals are for the exact total, never max.
import {
  concatHex,
  encodeFunctionData,
  getAddress,
  isAddress,
  numberToHex,
  pad,
  toHex,
  type Address,
  type Hex,
} from "viem";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { generateStealthAddress } from "@scopelift/stealth-address-sdk";
import { announcerAbi, erc20Abi, stealthDisperseAbi } from "./abis.js";
import { ANNOUNCER_ADDRESS, MAX_LINE_AMOUNT, MAX_LINES_PER_TX, SCHEME_ID } from "./constants.js";

/** Planning constant: gas per pay-run line, all-in (transferFrom + announce + calldata). */
export const PAYRUN_GAS_PER_LINE = 42_000n;
/** `transfer(address,uint256)`, the selector StealthDisperse writes into metadata bytes 1-4. */
export const METADATA_TRANSFER_SELECTOR = "0xa9059cbb" as const;

export type PayRunRecipient = {
  /** Pinned ERC-6538 meta-address, `st:eth:0x…` or bare `0x…` (66 bytes). */
  metaAddressURI: string;
  /** Total for this recipient, in token base units. */
  amount: bigint;
  /** Caller-side label, carried to every line (defaults to the recipient's index). */
  id?: string;
};

export type PayRunLine = {
  stealthAddress: Address;
  amount: bigint;
  /** 33-byte compressed secp256k1 point. */
  ephemeralPublicKey: Hex;
  keyPrefix: 2 | 3;
  /** The x coordinate of the ephemeral key (bytes32). */
  keyX: Hex;
  /** 0..255 */
  viewTag: number;
  recipientId: string;
};

export type DerivePayRunParams = {
  recipients: readonly PayRunRecipient[];
  /**
   * Splits one recipient's amount into several line amounts (see denominations.ts).
   * Each returned amount becomes its own line with a fresh stealth address. Defaults to one line.
   */
  denominate?: (amount: bigint, recipient: PayRunRecipient) => readonly bigint[];
  /** Test hook only. Must return a fresh 32-byte secp256k1 secret key per call. */
  randomEphemeralKey?: () => Uint8Array;
};

function assertLineAmount(amount: bigint, what: string): void {
  if (amount <= 0n) throw new Error(`Soapay: ${what}: amount must be > 0`);
  if (amount > MAX_LINE_AMOUNT) throw new Error(`Soapay: ${what}: amount must be < 2^80`);
}

function addressValue(a: Address): bigint {
  return BigInt(a);
}

/** Ascending numeric compare of two addresses as 160-bit integers. */
export function compareAddresses(a: Address, b: Address): number {
  const x = addressValue(a);
  const y = addressValue(b);
  return x < y ? -1 : x > y ? 1 : 0;
}

/**
 * Derives one line per payment with a fresh random ephemeral key per line, then sorts the whole run
 * ascending by stealth address. Throws on a repeated ephemeral key or stealth address.
 */
export function derivePayRun(params: DerivePayRunParams): PayRunLine[] {
  const { recipients, denominate } = params;
  const randomKey = params.randomEphemeralKey ?? (() => secp256k1.utils.randomSecretKey());
  const lines: PayRunLine[] = [];

  recipients.forEach((r, index) => {
    const recipientId = r.id ?? String(index);
    const amounts = denominate ? denominate(r.amount, r) : [r.amount];
    if (amounts.length === 0) throw new Error(`Soapay: recipient ${recipientId}: no lines`);
    for (const amount of amounts) {
      assertLineAmount(amount, `recipient ${recipientId}`);
      const ephemeralPrivateKey = randomKey();
      if (!secp256k1.utils.isValidSecretKey(ephemeralPrivateKey)) {
        // ScopeLift silently replaces an invalid key with a random one; refuse instead.
        throw new Error("Soapay: invalid ephemeral private key");
      }
      const out = generateStealthAddress({
        stealthMetaAddressURI: r.metaAddressURI,
        schemeId: SCHEME_ID,
        ephemeralPrivateKey,
      });
      const eph = out.ephemeralPublicKey.toLowerCase() as Hex;
      if (eph.length !== 68) throw new Error("Soapay: ephemeral key is not 33 bytes");
      const prefix = Number.parseInt(eph.slice(2, 4), 16);
      if (prefix !== 2 && prefix !== 3) throw new Error("Soapay: ephemeral key prefix must be 0x02/0x03");
      lines.push({
        stealthAddress: getAddress(out.stealthAddress),
        amount,
        ephemeralPublicKey: eph,
        keyPrefix: prefix,
        keyX: `0x${eph.slice(4)}`,
        viewTag: Number.parseInt(out.viewTag.slice(2, 4), 16),
        recipientId,
      });
    }
  });

  lines.sort((a, b) => compareAddresses(a.stealthAddress, b.stealthAddress));
  assertPayRunInvariants(lines);
  return lines;
}

/**
 * Checks a full run before encoding: amounts in (0, 2^80), strictly ascending stealth addresses
 * (so no repeats), and no repeated ephemeral key anywhere in the run.
 */
export function assertPayRunInvariants(lines: readonly PayRunLine[]): void {
  const eph = new Set<string>();
  let prev = -1n;
  lines.forEach((l, i) => {
    assertLineAmount(l.amount, `line ${i}`);
    const key = l.ephemeralPublicKey.toLowerCase();
    if (eph.has(key)) throw new Error(`Soapay: ephemeral key reused at line ${i}`);
    eph.add(key);
    const v = addressValue(l.stealthAddress);
    if (v === prev) throw new Error(`Soapay: stealth address repeated at line ${i}`);
    if (v < prev) throw new Error(`Soapay: lines not ascending at line ${i}`);
    prev = v;
  });
}

/**
 * Cuts the globally sorted run into ceil(n / max) consecutive chunks whose sizes differ by at most one.
 * Never partitions by recipient: a recipient's lines fall wherever their addresses sort.
 */
export function chunkLines<T>(lines: readonly T[], max: number = MAX_LINES_PER_TX): T[][] {
  if (!Number.isInteger(max) || max < 1) throw new Error("Soapay: max lines per tx must be a positive integer");
  const n = lines.length;
  if (n === 0) return [];
  const count = Math.ceil(n / max);
  const base = Math.floor(n / count);
  const extra = n % count;
  const chunks: T[][] = [];
  let at = 0;
  for (let i = 0; i < count; i++) {
    const size = base + (i < extra ? 1 : 0);
    chunks.push(lines.slice(at, at + size));
    at += size;
  }
  return chunks;
}

export type HeadFields = {
  stealthAddress: Address;
  amount: bigint;
  viewTag: number;
  keyPrefix: number;
};

/** head = (addr << 96) | (amount << 16) | (viewTag << 8) | keyPrefix  (docs/mvp-spec.md §1). */
export function encodeHead(f: HeadFields): bigint {
  if (!isAddress(f.stealthAddress, { strict: false })) throw new Error("Soapay: bad stealth address");
  assertLineAmount(f.amount, "head");
  if (!Number.isInteger(f.viewTag) || f.viewTag < 0 || f.viewTag > 0xff) throw new Error("Soapay: bad view tag");
  if (f.keyPrefix !== 2 && f.keyPrefix !== 3) throw new Error("Soapay: key prefix must be 0x02 or 0x03");
  return (
    (addressValue(f.stealthAddress) << 96n) |
    (f.amount << 16n) |
    (BigInt(f.viewTag) << 8n) |
    BigInt(f.keyPrefix)
  );
}

export function decodeHead(head: bigint): HeadFields {
  if (head < 0n || head >= 1n << 256n) throw new Error("Soapay: head out of range");
  return {
    stealthAddress: getAddress(pad(toHex(head >> 96n), { size: 20 })),
    amount: (head >> 16n) & MAX_LINE_AMOUNT,
    viewTag: Number((head >> 8n) & 0xffn),
    keyPrefix: Number(head & 0xffn),
  };
}

export type MetadataFields = { viewTag: number; token: Address; amount: bigint };

function metadata57(m: MetadataFields): Hex {
  if (!Number.isInteger(m.viewTag) || m.viewTag < 0 || m.viewTag > 0xff) throw new Error("Soapay: bad view tag");
  if (!isAddress(m.token, { strict: false })) throw new Error("Soapay: bad token address");
  if (m.amount < 0n || m.amount >= 1n << 256n) throw new Error("Soapay: amount must fit uint256");
  return concatHex([
    numberToHex(m.viewTag, { size: 1 }),
    METADATA_TRANSFER_SELECTOR,
    m.token.toLowerCase() as Hex,
    numberToHex(m.amount, { size: 32 }),
  ]);
}

/** Standard 57-byte EIP-5564 ERC-20 metadata: viewTag | 0xa9059cbb | token | uint256 amount. */
export function buildMetadata57(m: MetadataFields): Hex {
  return metadata57(m);
}

/** StealthDisperse's 77-byte metadata: the 57-byte form followed by payer (= msg.sender). */
export function buildMetadata77(m: MetadataFields & { payer: Address }): Hex {
  if (!isAddress(m.payer, { strict: false })) throw new Error("Soapay: bad payer address");
  return concatHex([metadata57(m), m.payer.toLowerCase() as Hex]);
}

/** One call, in the shape viem's `sendTransaction` and `sendCalls` both accept. */
export type PayRunCall = { to: Address; data: Hex };

export type PackedPayment = { head: bigint; keyX: Hex };

export function packLine(l: PayRunLine): PackedPayment {
  return { head: encodeHead(l), keyX: l.keyX };
}

function sumAmounts(lines: readonly PayRunLine[]): bigint {
  return lines.reduce((s, l) => s + l.amount, 0n);
}

export type StealthDisperseCalls = {
  /** `token.approve(stealthDisperse, total)`: exact total of the run, never max. Send first. */
  approve: PayRunCall;
  /** One `StealthDisperse.pay` per chunk, in order. */
  pays: PayRunCall[];
  total: bigint;
  chunkSizes: number[];
};

/** EOA path: one exact-total approval, then one `pay(token, lines)` per chunk. */
export function encodeStealthDisperseCalls(params: {
  stealthDisperse: Address;
  token: Address;
  lines: readonly PayRunLine[];
  maxLinesPerTx?: number;
}): StealthDisperseCalls {
  const { stealthDisperse, token, lines } = params;
  const max = params.maxLinesPerTx ?? MAX_LINES_PER_TX;
  if (max > MAX_LINES_PER_TX) throw new Error(`Soapay: at most ${MAX_LINES_PER_TX} lines per tx`);
  if (lines.length === 0) throw new Error("Soapay: empty pay run");
  assertPayRunInvariants(lines);
  const chunks = chunkLines(lines, max);
  const total = sumAmounts(lines);
  return {
    approve: {
      to: token,
      data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [stealthDisperse, total] }),
    },
    pays: chunks.map((chunk) => ({
      to: stealthDisperse,
      data: encodeFunctionData({ abi: stealthDisperseAbi, functionName: "pay", args: [token, chunk.map(packLine)] }),
    })),
    total,
    chunkSizes: chunks.map((c) => c.length),
  };
}

/** One EIP-5792 batch: pass as `sendCalls({ calls })`. */
export type BatchCallsChunk = { calls: PayRunCall[] };

/**
 * Smart-account path (EIP-5792, no custom contract): per chunk,
 * `[token.transfer(stealth, amount), Announcer.announce(1, stealth, ephPub, metadata57)] × N`,
 * with the pairs kept in ascending stealth-address order.
 */
export function encodeBatchCalls(params: {
  token: Address;
  lines: readonly PayRunLine[];
  announcer?: Address;
  maxLinesPerTx?: number;
}): BatchCallsChunk[] {
  const { token, lines } = params;
  const announcer = params.announcer ?? ANNOUNCER_ADDRESS;
  const max = params.maxLinesPerTx ?? MAX_LINES_PER_TX;
  if (max > MAX_LINES_PER_TX) throw new Error(`Soapay: at most ${MAX_LINES_PER_TX} lines per tx`);
  if (lines.length === 0) throw new Error("Soapay: empty pay run");
  assertPayRunInvariants(lines);
  return chunkLines(lines, max).map((chunk) => ({
    calls: chunk.flatMap((l): PayRunCall[] => [
      {
        to: token,
        data: encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [l.stealthAddress, l.amount] }),
      },
      {
        to: announcer,
        data: encodeFunctionData({
          abi: announcerAbi,
          functionName: "announce",
          args: [BigInt(SCHEME_ID), l.stealthAddress, l.ephemeralPublicKey, buildMetadata57({ viewTag: l.viewTag, token, amount: l.amount })],
        }),
      },
    ]),
  }));
}

export type PayRunEstimate = {
  lineCount: number;
  recipientCount: number;
  txCount: number;
  totalAmount: bigint;
  totalGas: bigint;
  perTx: { lines: number; amount: bigint; gas: bigint }[];
};

/** Planning estimate at ~42k gas per line, all-in, plus per-run totals. */
export function estimatePayRunGas(lines: readonly PayRunLine[], maxLinesPerTx: number = MAX_LINES_PER_TX): PayRunEstimate {
  const perTx = chunkLines(lines, maxLinesPerTx).map((c) => ({
    lines: c.length,
    amount: sumAmounts(c),
    gas: BigInt(c.length) * PAYRUN_GAS_PER_LINE,
  }));
  return {
    lineCount: lines.length,
    recipientCount: new Set(lines.map((l) => l.recipientId)).size,
    txCount: perTx.length,
    totalAmount: sumAmounts(lines),
    totalGas: BigInt(lines.length) * PAYRUN_GAS_PER_LINE,
    perTx,
  };
}
