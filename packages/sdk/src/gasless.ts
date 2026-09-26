// Gasless-spend proof (D-41): verifiable facts about a stealth address after it spent, read live.
//
// Every field is a direct chain read or decoded from the spend's receipt; nothing is inferred beyond
// what those reads imply. Deliberately NOT claimed: "this address never received ETH". Proving that
// needs every internal transfer ever made to it (a trace or explorer index), which this does not read.
// What it does show: the ETH balance now, the account nonce and code (7702 delegation), and that the
// spend's gas was paid by a paymaster in USDC, with the fee taken from the receipt's Transfer logs, or
// (Base Sepolia, D-52) sponsored outright, with no token taken from the address.
import { decodeEventLog, getAddress, isAddressEqual, parseAbi, type Address, type Hex, type PublicClient } from "viem";
import { erc20Abi } from "./abis.js";
import { CIRCLE_USDC, ENTRYPOINT_V08, SIMPLE_7702_ACCOUNT, getChainConfig } from "./constants.js";
import { CIRCLE_PAYMASTER_V08 } from "./paymasters/circle.js";
import { parseDelegationDesignator } from "./spend.js";
import type { BatchReceipt } from "./batch.js";

export const userOperationEventAbi = parseAbi([
  "event UserOperationEvent(bytes32 indexed userOpHash, address indexed sender, address indexed paymaster, uint256 nonce, bool success, uint256 actualGasCost, uint256 actualGasUsed)",
]);

const ZERO: Address = "0x0000000000000000000000000000000000000000";

export type GaslessSpendFacts = {
  txHash: Hex;
  blockNumber: bigint;
  /** Who submitted the transaction and paid its ETH gas up front: the bundler, not the stealth address. */
  submitter: Address;
  entryPoint: Address;
  userOpHash: Hex;
  /** null when the userOp named no paymaster (the account paid its own gas). */
  paymaster: Address | null;
  /**
   * "circle" when the paymaster is the chain's Circle Paymaster v0.8; "sponsored" when another
   * paymaster took no pay token from the address (testnet sponsorship, D-52); else "other".
   */
  paymasterKind: "circle" | "sponsored" | "other" | null;
  success: boolean;
  /** Gas cost in wei, charged to the paymaster's EntryPoint deposit (UserOperationEvent.actualGasCost). */
  actualGasCost: bigint;
  /** Net USDC the address paid the paymaster in this tx (pulled minus refunded). null without a paymaster. */
  usdcFee: bigint | null;
};

export type GaslessProof = {
  address: Address;
  /** Native ETH balance at read time, in wei. */
  ethBalance: bigint;
  /** Account nonce (EIP-7702 authorizations and the account's own transactions both use it). */
  nonce: number;
  account: { kind: "eoa" | "delegated" | "contract"; delegate: Address | null; simple7702: boolean };
  /**
   * True when nonce is 1 and the code is a 7702 designator: that one nonce was used by the
   * authorization, so the address has never sent a transaction of its own. null when the reads
   * don't settle it (then the UI shows the nonce and claims nothing).
   */
  neverSentTx: boolean | null;
  /** Facts from the spend's receipt; null without a receipt or when no userOp from this address is in it. */
  spend: GaslessSpendFacts | null;
};

export type GaslessProofReads = {
  address: Address;
  ethBalance: bigint;
  nonce: number;
  code: Hex | undefined | null;
  receipt?: BatchReceipt | null;
};

/** Pure: turns the raw reads into proof facts. */
export function gaslessProofFromReads(reads: GaslessProofReads, opts: { chainId: number; entryPoint?: Address }): GaslessProof {
  const address = getAddress(reads.address);
  const code = reads.code && reads.code !== "0x" ? reads.code : null;
  const delegate = parseDelegationDesignator(code);
  const kind: GaslessProof["account"]["kind"] = !code ? "eoa" : delegate ? "delegated" : "contract";
  const neverSentTx = kind === "delegated" && reads.nonce === 1 ? true : null;
  return {
    address,
    ethBalance: reads.ethBalance,
    nonce: reads.nonce,
    account: { kind, delegate, simple7702: delegate !== null && isAddressEqual(delegate, SIMPLE_7702_ACCOUNT) },
    neverSentTx,
    spend: reads.receipt ? spendFacts(address, reads.receipt, opts) : null,
  };
}

function spendFacts(address: Address, receipt: BatchReceipt, opts: { chainId: number; entryPoint?: Address }): GaslessSpendFacts | null {
  const entryPoint = opts.entryPoint ?? ENTRYPOINT_V08;
  let payToken: Address | null = null;
  try {
    payToken = getChainConfig(opts.chainId).usdc;
  } catch {
    payToken = null;
  }
  let op: { userOpHash: Hex; paymaster: Address; success: boolean; actualGasCost: bigint } | null = null;
  for (const log of receipt.logs) {
    if (!isAddressEqual(log.address, entryPoint)) continue;
    try {
      const ev = decodeEventLog({ abi: userOperationEventAbi, topics: log.topics as [Hex, ...Hex[]], data: log.data });
      if (!isAddressEqual(ev.args.sender, address)) continue;
      op = { userOpHash: ev.args.userOpHash, paymaster: getAddress(ev.args.paymaster), success: ev.args.success, actualGasCost: ev.args.actualGasCost };
    } catch {
      // Another EntryPoint event (BeforeExecution, AccountDeployed, …).
    }
  }
  if (!op) return null;

  const paymaster = isAddressEqual(op.paymaster, ZERO) ? null : op.paymaster;
  const circle = (CIRCLE_PAYMASTER_V08 as Record<number, Address>)[opts.chainId];
  const isCircle = !!paymaster && !!circle && isAddressEqual(paymaster, circle);
  // The Circle paymaster charges Circle USDC even where the pay token is a mock (Base Sepolia, D-52).
  const usdc = isCircle ? ((CIRCLE_USDC as Record<number, Address>)[opts.chainId] ?? payToken) : payToken;
  let usdcFee: bigint | null = null;
  if (paymaster && usdc) {
    let fee = 0n;
    for (const log of receipt.logs) {
      if (!isAddressEqual(log.address, usdc)) continue;
      try {
        const ev = decodeEventLog({ abi: erc20Abi, eventName: "Transfer", topics: log.topics as [Hex, ...Hex[]], data: log.data });
        if (isAddressEqual(ev.args.from, address) && isAddressEqual(ev.args.to, paymaster)) fee += ev.args.value;
        else if (isAddressEqual(ev.args.from, paymaster) && isAddressEqual(ev.args.to, address)) fee -= ev.args.value;
      } catch {
        // Approval (the paymaster's permit) or another event.
      }
    }
    usdcFee = fee;
  }
  return {
    txHash: receipt.transactionHash,
    blockNumber: receipt.blockNumber,
    submitter: getAddress(receipt.from),
    entryPoint: getAddress(entryPoint),
    userOpHash: op.userOpHash,
    paymaster,
    paymasterKind: paymaster ? (isCircle ? "circle" : usdcFee === 0n ? "sponsored" : "other") : null,
    success: op.success,
    actualGasCost: op.actualGasCost,
    usdcFee,
  };
}

export type GaslessProofClient = Pick<PublicClient, "getBalance" | "getTransactionCount" | "getCode" | "getTransactionReceipt">;

/** Reads everything live over RPC (four calls, plus the receipt when `txHash` is given). */
export async function readGaslessProof(params: {
  client: GaslessProofClient;
  address: Address;
  chainId: number;
  txHash?: Hex;
}): Promise<GaslessProof> {
  const { client, address } = params;
  const [ethBalance, nonce, code, receipt] = await Promise.all([
    client.getBalance({ address }),
    client.getTransactionCount({ address }),
    client.getCode({ address }),
    params.txHash ? client.getTransactionReceipt({ hash: params.txHash }) : Promise.resolve(null),
  ]);
  return gaslessProofFromReads(
    { address, ethBalance, nonce, code: code ?? null, receipt: receipt as unknown as BatchReceipt | null },
    { chainId: params.chainId },
  );
}
