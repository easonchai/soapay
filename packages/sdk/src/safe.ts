/**
 * Safe (multisig) output for pay runs (PRD P1 "Safe transaction output for multisig
 * senders"). Pure encoding only; proposing and signing stay in the Safe UI or Protocol Kit.
 *
 * A Safe executes a batch by DELEGATECALLing MultiSendCallOnly, so the inner calls run
 * with the Safe as `msg.sender`. That outer delegatecall is the only one allowed and
 * only to the pinned, canonical MultiSendCallOnly v1.4.1 below, whose code refuses any
 * inner delegatecall. The plain `MultiSend` contract (which permits inner delegatecalls)
 * is never used, and inner calls with `operation: 1` are rejected here too.
 */
import {
  concatHex,
  encodeFunctionData,
  encodePacked,
  getAddress,
  isAddress,
  keccak256,
  parseAbi,
  size,
  stringToHex,
  type Address,
  type Hex,
} from "viem";

/**
 * Canonical MultiSendCallOnly v1.4.1 (safe-global/safe-deployments
 * src/assets/v1.4.1/multi_send_call_only.json, "canonical" deployment, used by
 * chains 1, 8453 and 84532). Verified on 2026-09-25 with eth_getCode on
 * mainnet.base.org and sepolia.base.org: 410 bytes, keccak256 equal to
 * {@link SAFE_MULTISEND_CALL_ONLY_CODEHASH}.
 */
export const SAFE_MULTISEND_CALL_ONLY_V141 = "0x9641d764fc13c8B624c04430C7356C1C7C8102e2" as const;
/** Runtime code hash from safe-deployments; apps may re-check it with eth_getCode. */
export const SAFE_MULTISEND_CALL_ONLY_CODEHASH =
  "0xecd5bd14a08c5d2122379900b2f272bdf107a7e92423c10dd5fe3254386c9939" as const;

export const multiSendAbi = parseAbi(["function multiSend(bytes transactions) payable"]);

export type SafeCall = {
  to: Address;
  value?: bigint;
  data: Hex;
  /** Only 0 (CALL) is accepted. Present so callers passing Safe-shaped txs get a clear error. */
  operation?: number;
};

export type SafeMultiSendTx = {
  to: typeof SAFE_MULTISEND_CALL_ONLY_V141;
  value: 0n;
  data: Hex;
  /**
   * Safe operation for the outer transaction: 1 (DELEGATECALL) into MultiSendCallOnly.
   * With 0 (CALL) the inner transfers would come from MultiSendCallOnly itself and fail.
   */
  operation: 1;
};

const MAX_UINT256 = (1n << 256n) - 1n;

function checkCalls(calls: readonly SafeCall[]): void {
  if (calls.length === 0) throw new Error("safe: no calls");
  calls.forEach((c, i) => {
    if (c.operation !== undefined && c.operation !== 0) {
      throw new Error(`safe: call ${i} uses operation ${c.operation}; delegatecall is never allowed`);
    }
    if (!isAddress(c.to, { strict: false })) throw new Error(`safe: call ${i} has an invalid address`);
    const v = c.value ?? 0n;
    if (v < 0n || v > MAX_UINT256) throw new Error(`safe: call ${i} has an invalid value`);
    if (!/^0x([0-9a-fA-F]{2})*$/.test(c.data)) throw new Error(`safe: call ${i} has malformed data`);
  });
}

/** MultiSend packed encoding: operation(uint8) | to(address) | value(uint256) | dataLength(uint256) | data. */
export function encodeMultiSendTransactions(calls: readonly SafeCall[]): Hex {
  checkCalls(calls);
  return concatHex(
    calls.map((c) =>
      encodePacked(
        ["uint8", "address", "uint256", "uint256", "bytes"],
        [0, getAddress(c.to), c.value ?? 0n, BigInt(size(c.data)), c.data],
      ),
    ),
  );
}

/**
 * Wraps calls into one Safe transaction targeting MultiSendCallOnly v1.4.1. Any ETH value
 * on inner calls must already sit in the Safe (MultiSendCallOnly forwards from the Safe's
 * balance under delegatecall), so the outer value is always 0.
 */
export function encodeSafeMultiSendCallOnly(calls: readonly SafeCall[]): SafeMultiSendTx {
  const data = encodeFunctionData({
    abi: multiSendAbi,
    functionName: "multiSend",
    args: [encodeMultiSendTransactions(calls)],
  });
  return { to: SAFE_MULTISEND_CALL_ONLY_V141, value: 0n, data, operation: 1 };
}

/** Safe Transaction Builder batch file (safe-global/safe-react-apps, apps/tx-builder). */
export type SafeTxBuilderBatch = {
  version: "1.0";
  chainId: string;
  createdAt: number;
  meta: {
    name: string;
    description: string;
    txBuilderVersion: string;
    createdFromSafeAddress: Address;
    createdFromOwnerAddress: string;
    checksum: Hex;
  };
  transactions: { to: Address; value: string; data: Hex; contractMethod: null; contractInputsValues: null }[];
};

export type SafeTxBuilderOptions = {
  chainId: number;
  safeAddress: Address;
  name: string;
  description?: string;
  /** Milliseconds since epoch. Defaults to 0 so output is deterministic; pass Date.now() in apps. */
  createdAt?: number;
};

/** tx-builder version whose format this mirrors. */
export const SAFE_TX_BUILDER_VERSION = "1.18.3";

/**
 * Builds a batch JSON for the Safe{Wallet} Transaction Builder "drag and drop" import.
 * Lists the raw calls: the Transaction Builder wraps them in MultiSendCallOnly itself.
 * The checksum mirrors tx-builder's `addChecksum` (keccak256 over its key-sorted
 * serialisation with `meta.name` nulled), so the import shows no checksum warning.
 */
export function toSafeTxBuilderJson(calls: readonly SafeCall[], opts: SafeTxBuilderOptions): SafeTxBuilderBatch {
  checkCalls(calls);
  if (!isAddress(opts.safeAddress, { strict: false })) throw new Error("safe: invalid Safe address");
  const unsigned = {
    version: "1.0" as const,
    chainId: String(opts.chainId),
    createdAt: opts.createdAt ?? 0,
    meta: {
      name: opts.name,
      description: opts.description ?? "",
      txBuilderVersion: SAFE_TX_BUILDER_VERSION,
      createdFromSafeAddress: getAddress(opts.safeAddress),
      createdFromOwnerAddress: "",
    },
    transactions: calls.map((c) => ({
      to: getAddress(c.to),
      value: (c.value ?? 0n).toString(),
      data: c.data,
      contractMethod: null,
      contractInputsValues: null,
    })),
  };
  const checksum = keccak256(stringToHex(serializeForChecksum({ ...unsigned, meta: { ...unsigned.meta, name: null } })));
  return { ...unsigned, meta: { ...unsigned.meta, checksum } };
}

/** Port of tx-builder's `serializeJSONObject` (src/lib/checksum.ts), quirks included. */
export function serializeForChecksum(json: unknown): string {
  const replacer = (_: string, v: unknown) => (v === undefined ? null : v);
  if (Array.isArray(json)) return `[${json.map(serializeForChecksum).join(",")}]`;
  if (typeof json === "object" && json !== null) {
    const obj = json as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    let acc = `{${JSON.stringify(keys, replacer)}`;
    for (const k of keys) acc += `${serializeForChecksum(obj[k])},`;
    return `${acc}}`;
  }
  return `${JSON.stringify(json, replacer)}`;
}
