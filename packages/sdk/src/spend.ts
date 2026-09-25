/**
 * Spending from a stealth address that holds only USDC (PRD Flow 4, docs/mvp-spec.md §3).
 *
 * The stealth EOA delegates to eth-infinitism Simple7702Account via EIP-7702 and sends one userOp
 * through EntryPoint v0.8 with USDC.transfer. An ERC-20 paymaster takes the gas in USDC. On first
 * spend the signed authorization rides in the same userOp (`eip7702Auth`). Nothing ever sends ETH
 * to a stealth address, and the stealth key only lives in memory for the duration of a call.
 *
 * The consolidation guard (guard.ts) decides whether a set of spends is allowed. This module never
 * combines addresses: one userOp per stealth address, always.
 */
import {
  createPublicClient,
  encodeFunctionData,
  erc20Abi,
  getAddress,
  http,
  isAddressEqual,
  parseAbi,
  type Address,
  type Chain,
  type Hex,
  type LocalAccount,
  type PublicClient,
  type SignedAuthorization,
  type Transport,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  createBundlerClient,
  prepareUserOperation,
  toSimple7702SmartAccount,
  type BundlerClient,
  type UserOperation,
} from "viem/account-abstraction";
import { ENTRYPOINT_V08, SIMPLE_7702_ACCOUNT, getChainConfig } from "./constants.js";
import { circlePaymaster } from "./paymasters/circle.js";
import type { PaymasterAdapter, PaymasterContext, SpendCall } from "./paymasters/types.js";

export * from "./paymasters/types.js";
export * from "./paymasters/circle.js";
export * from "./paymasters/pimlico.js";

/** Default fee cap: 1 USDC. Base gas is cents; this also bounds the paymaster permit. */
export const DEFAULT_MAX_FEE_USDC = 1_000_000n;

// ---------------------------------------------------------------------------------------------
// Delegation designator (EIP-7702)
// ---------------------------------------------------------------------------------------------

export const DELEGATION_DESIGNATOR_PREFIX = "0xef0100" as const;

/** Returns the delegate if `code` is exactly `0xef0100 || address` (23 bytes), else null. */
export function parseDelegationDesignator(code: Hex | undefined | null): Address | null {
  if (!code) return null;
  const c = code.toLowerCase();
  if (c.length !== 2 + 23 * 2 || !c.startsWith(DELEGATION_DESIGNATOR_PREFIX)) return null;
  return getAddress(`0x${c.slice(8)}`);
}

export type DelegationStatus = {
  address: Address;
  /** "eoa": no code. "delegated": 7702 designator. "contract": ordinary bytecode (not a stealth EOA). */
  kind: "eoa" | "delegated" | "contract";
  delegate: Address | null;
  /** True only when delegated to `SIMPLE_7702_ACCOUNT` (or `expected`). */
  delegated: boolean;
};

export async function isDelegated(
  client: Pick<PublicClient, "getCode">,
  address: Address,
  expected: Address = SIMPLE_7702_ACCOUNT,
): Promise<DelegationStatus> {
  const code = await client.getCode({ address });
  if (!code || code === "0x") return { address, kind: "eoa", delegate: null, delegated: false };
  const delegate = parseDelegationDesignator(code);
  if (!delegate) return { address, kind: "contract", delegate: null, delegated: false };
  return { address, kind: "delegated", delegate, delegated: isAddressEqual(delegate, expected) };
}

// ---------------------------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------------------------

export type FeesPerGas = { maxFeePerGas: bigint; maxPriorityFeePerGas: bigint };
export type EstimateFeesPerGas = (bundlerClient: BundlerClient) => Promise<FeesPerGas>;

export type CreateSpendClientOptions<chain extends Chain = Chain> = {
  chainId: number;
  /** Bundler RPC (Pimlico or similar). Either this or `bundlerTransport`. */
  bundlerUrl?: string;
  /** Custom bundler transport, e.g. for tests. Overrides `bundlerUrl`. */
  bundlerTransport?: Transport;
  /** Chain RPC. Defaults to the chain's public RPC over http(). Must have `chain` set. */
  publicClient?: PublicClient<Transport, chain>;
  /** Default "circle". */
  paymaster?: "circle" | PaymasterAdapter;
  /** Gas price source. Default: viem's (2x the node's EIP-1559 estimate). See `pimlicoFeesPerGas`. */
  estimateFeesPerGas?: EstimateFeesPerGas;
};

export type SpendClient = {
  chainId: number;
  chain: Chain;
  usdc: Address;
  publicClient: PublicClient<Transport, Chain>;
  bundlerClient: BundlerClient;
  paymaster: PaymasterAdapter;
};

export function createSpendClient<chain extends Chain = Chain>(options: CreateSpendClientOptions<chain>): SpendClient {
  const config = getChainConfig(options.chainId);
  const publicClient = (options.publicClient ?? createPublicClient({ chain: config.chain, transport: http() })) as unknown as PublicClient<Transport, Chain>;
  if (publicClient.chain?.id !== options.chainId) throw new Error("Soapay spend: publicClient chain does not match chainId");
  const transport = options.bundlerTransport ?? (options.bundlerUrl ? http(options.bundlerUrl) : undefined);
  if (!transport) throw new Error("Soapay spend: bundlerUrl is required");
  const estimate = options.estimateFeesPerGas;
  const bundlerClient = createBundlerClient({
    client: publicClient,
    chain: config.chain,
    transport,
    ...(estimate ? { userOperation: { estimateFeesPerGas: ({ bundlerClient }) => estimate(bundlerClient as BundlerClient) } } : {}),
  });
  const paymaster = options.paymaster === undefined || options.paymaster === "circle" ? circlePaymaster() : options.paymaster;
  return { chainId: options.chainId, chain: config.chain, usdc: config.usdc, publicClient, bundlerClient, paymaster };
}

/** `pimlico_getUserOperationGasPrice` ("standard" tier), for Pimlico bundlers. */
export const pimlicoFeesPerGas: EstimateFeesPerGas = async (bundlerClient) => {
  const res = (await bundlerClient.request({ method: "pimlico_getUserOperationGasPrice" as never, params: [] as never })) as {
    standard: { maxFeePerGas: Hex; maxPriorityFeePerGas: Hex };
  };
  return { maxFeePerGas: BigInt(res.standard.maxFeePerGas), maxPriorityFeePerGas: BigInt(res.standard.maxPriorityFeePerGas) };
};

// ---------------------------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------------------------

export class SpendError extends Error {
  override name = "SpendError";
}
export class FeeTooHighError extends SpendError {
  override name = "FeeTooHighError";
  constructor(
    readonly fee: bigint,
    readonly maxFee: bigint,
  ) {
    super(`Soapay spend: fee ${fee} exceeds cap ${maxFee}`);
  }
}
export class InsufficientBalanceError extends SpendError {
  override name = "InsufficientBalanceError";
  constructor(
    readonly needed: bigint,
    readonly balance: bigint,
  ) {
    super(`Soapay spend: need ${needed}, have ${balance}`);
  }
}

// ---------------------------------------------------------------------------------------------
// Spend
// ---------------------------------------------------------------------------------------------

export type SpendParams = {
  /** Stealth private key recovered by the scanner. Held in memory only; never persisted or sent. */
  stealthKey: Hex;
  to: Address;
  /** Base units of `token`, or "max" to send the whole balance minus the fee. */
  amount: bigint | "max";
  /** Defaults to the chain's USDC. */
  token?: Address;
  /** Fee cap in fee-token base units. Also the paymaster permit amount. Default 1 USDC. */
  maxFeeUsdc?: bigint;
};

export type SpendEstimate = {
  from: Address;
  token: Address;
  feeToken: Address;
  /** Resolved amount `to` receives (for "max": balance − fee). */
  amount: bigint;
  /** Most fee-token the paymaster can pull (quoted with headroom). The unused part is refunded. */
  fee: bigint;
  balance: bigint;
  /** Largest `amount` sendable with this fee (0 if the balance cannot cover the fee). */
  maxSendable: bigint;
  /** Whether the userOp carries the 7702 authorization (first spend, or re-delegation). */
  delegated: boolean;
  userOperation: UserOperation<"0.8">;
};

export type SpendResult = {
  from: Address;
  userOpHash: Hex;
  txHash?: Hex;
  /** Whether this userOp included the 7702 authorization. */
  delegated: boolean;
  amount: bigint;
  feeEstimate: bigint;
};

const entryPointNonceAbi = parseAbi(["function getNonce(address sender, uint192 key) view returns (uint256)"]);

type Session = {
  owner: LocalAccount;
  account: Awaited<ReturnType<typeof toSimple7702SmartAccount>>;
  authorization: SignedAuthorization | undefined;
  ctx: PaymasterContext;
  token: Address;
  feeToken: Address;
};

async function openSession(client: SpendClient, params: SpendParams): Promise<Session> {
  const owner = privateKeyToAccount(params.stealthKey);
  const account = await toSimple7702SmartAccount({
    client: client.publicClient,
    owner,
    implementation: SIMPLE_7702_ACCOUNT,
    // Key 0, the plain sequential nonce most accounts use. viem's default key is Date.now(),
    // which would fingerprint these userOps.
    getNonce: () =>
      client.publicClient.readContract({ address: ENTRYPOINT_V08, abi: entryPointNonceAbi, functionName: "getNonce", args: [owner.address, 0n] }),
  });
  if (!isAddressEqual(account.entryPoint.address, ENTRYPOINT_V08)) throw new SpendError("Soapay spend: EntryPoint mismatch");

  const status = await isDelegated(client.publicClient, owner.address);
  if (status.kind === "contract") throw new SpendError(`Soapay spend: ${owner.address} holds contract code, not a stealth EOA`);
  let authorization: SignedAuthorization | undefined;
  if (!status.delegated) {
    // The bundler submits handleOps, so the stealth EOA never sends a tx itself: its current nonce
    // is the authorization nonce.
    const nonce = await client.publicClient.getTransactionCount({ address: owner.address, blockTag: "pending" });
    authorization = await owner.signAuthorization({ chainId: client.chainId, nonce, contractAddress: SIMPLE_7702_ACCOUNT });
  }

  const maxFee = params.maxFeeUsdc ?? DEFAULT_MAX_FEE_USDC;
  if (maxFee <= 0n) throw new SpendError("Soapay spend: maxFeeUsdc must be positive");
  return {
    owner,
    account,
    authorization,
    token: params.token ?? client.usdc,
    feeToken: client.paymaster.feeToken(client.chainId),
    ctx: {
      chainId: client.chainId,
      entryPoint: ENTRYPOINT_V08,
      publicClient: client.publicClient,
      bundlerClient: client.bundlerClient,
      owner,
      maxFee,
    },
  };
}

/** The calls for one spend. Exported for tests; every call has value 0. */
export function buildTransferCall(token: Address, to: Address, amount: bigint): SpendCall {
  return { to: token, data: encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [to, amount] }), value: 0n };
}

async function buildUserOp(client: SpendClient, s: Session, to: Address, amount: bigint) {
  if (amount <= 0n) throw new SpendError("Soapay spend: amount must be positive");
  const extra = (await client.paymaster.prepareCalls?.(s.ctx)) ?? [];
  const calls = [...extra, buildTransferCall(s.token, to, amount)];
  if (calls.some((c) => c.value !== 0n)) throw new SpendError("Soapay spend: calls must not move ETH");

  const adapter = client.paymaster;
  const { account: _account, ...prepared } = (await prepareUserOperation(client.bundlerClient, {
    account: s.account,
    calls,
    ...(s.authorization
      ? {
          authorization: s.authorization,
          // EntryPoint v0.8 7702 marker: initCode = 0x7702 means "use the delegation".
          factory: "0x7702" as Address,
          factoryData: "0x" as Hex,
          parameters: ["factory", "fees", "gas", "paymaster", "nonce", "signature", "authorization"] as const,
        }
      : { parameters: ["fees", "gas", "paymaster", "nonce", "signature"] as const }),
    paymaster: {
      getPaymasterStubData: (p: unknown) => adapter.getPaymasterStubData(p as never, s.ctx),
      getPaymasterData: (p: unknown) => adapter.getPaymasterData(p as never, s.ctx),
    } as never,
  })) as unknown as UserOperation<"0.8"> & { account?: unknown };
  // Drop `account` so sendUserOperation submits this exact op instead of preparing a new one.
  const op = prepared as UserOperation<"0.8">;

  const fee = await adapter.quoteMaxFee(op, s.ctx);
  return { op, fee, amount };
}

async function balanceOf(client: SpendClient, token: Address, owner: Address): Promise<bigint> {
  return client.publicClient.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [owner] });
}

/** Largest amount sendable when the fee is paid from the same balance. */
export function maxSendable(balance: bigint, fee: bigint): bigint {
  return balance > fee ? balance - fee : 0n;
}

async function plan(client: SpendClient, s: Session, params: SpendParams): Promise<SpendEstimate> {
  const from = s.owner.address;
  const sameToken = isAddressEqual(s.token, s.feeToken);
  const [balance, feeBalance] = await Promise.all([
    balanceOf(client, s.token, from),
    sameToken ? Promise.resolve(undefined) : balanceOf(client, s.feeToken, from),
  ]);
  const cap = s.ctx.maxFee;
  const delegated = s.authorization !== undefined;

  const finish = (b: Awaited<ReturnType<typeof buildUserOp>>): SpendEstimate => {
    if (b.fee > cap) throw new FeeTooHighError(b.fee, cap);
    if (sameToken) {
      if (b.amount + b.fee > balance) throw new InsufficientBalanceError(b.amount + b.fee, balance);
    } else {
      if (b.amount > balance) throw new InsufficientBalanceError(b.amount, balance);
      if (b.fee > (feeBalance ?? 0n)) throw new InsufficientBalanceError(b.fee, feeBalance ?? 0n);
    }
    return {
      from,
      token: s.token,
      feeToken: s.feeToken,
      amount: b.amount,
      fee: b.fee,
      balance,
      maxSendable: sameToken ? maxSendable(balance, b.fee) : balance,
      delegated,
      userOperation: b.op,
    };
  };

  if (params.amount !== "max") return finish(await buildUserOp(client, s, params.to, params.amount));
  if (!sameToken) return finish(await buildUserOp(client, s, params.to, balance));

  // Send max: fee and calldata depend on each other a little, so iterate until amount + fee fits.
  // The first estimate uses balance − cap so the bundler's simulation can afford the prefund.
  if (balance === 0n) throw new InsufficientBalanceError(1n, 0n);
  let amount = balance > cap ? balance - cap : balance / 2n;
  let built = await buildUserOp(client, s, params.to, amount);
  for (let i = 0; i < 4; i++) {
    if (built.fee > cap) throw new FeeTooHighError(built.fee, cap);
    const target = maxSendable(balance, built.fee);
    if (target === 0n) throw new InsufficientBalanceError(built.fee + 1n, balance);
    if (target === amount) return finish(built);
    const next = await buildUserOp(client, s, params.to, target);
    if (target + next.fee <= balance) return finish(next);
    amount = target;
    built = next;
  }
  throw new SpendError("Soapay spend: send-max did not converge");
}

/**
 * Quote a spend without sending. For "you receive X after fees" and "send max": the recipient gets
 * `amount`, the fee comes out of the stealth balance, and `maxSendable` = balance − fee.
 */
export async function estimateSpend(client: SpendClient, params: SpendParams): Promise<SpendEstimate> {
  const s = await openSession(client, params);
  return plan(client, s, params);
}

export type SpendOptions = {
  /** Wait for inclusion and return txHash. Default true. */
  wait?: boolean;
  /** Receipt timeout in ms (viem default otherwise). */
  timeout?: number;
};

/** Sign and send one userOp from one stealth address. */
export async function spendFromStealth(client: SpendClient, params: SpendParams, options: SpendOptions = {}): Promise<SpendResult> {
  const s = await openSession(client, params);
  const est = await plan(client, s, params);
  const signature = await s.account.signUserOperation(est.userOperation);
  const userOpHash = await client.bundlerClient.sendUserOperation({
    ...(est.userOperation as UserOperation),
    signature,
    entryPointAddress: ENTRYPOINT_V08,
  } as never);
  const result: SpendResult = { from: est.from, userOpHash, delegated: est.delegated, amount: est.amount, feeEstimate: est.fee };
  if (options.wait === false) return result;
  const receipt = await client.bundlerClient.waitForUserOperationReceipt({
    hash: userOpHash,
    ...(options.timeout !== undefined ? { timeout: options.timeout } : {}),
  });
  if (!receipt.success) throw new SpendError(`Soapay spend: userOp ${userOpHash} reverted (${receipt.reason ?? "no reason"})`);
  return { ...result, txHash: receipt.receipt.transactionHash };
}

export type SpendManyOptions = SpendOptions & {
  /** Fixed pause between userOps, ms. Default 0. */
  delayMs?: number;
  /** Extra uniform random pause in [0, jitterMs), ms. Default 0. */
  jitterMs?: number;
  /** Injected for tests. */
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
};

// lib is ES2022 only (no DOM/Node typings), so reach setTimeout through globalThis.
const defaultSleep = (ms: number) =>
  new Promise<void>((resolve) =>
    (globalThis as unknown as { setTimeout: (fn: () => void, ms: number) => unknown }).setTimeout(resolve, ms),
  );

export class SpendManyError extends SpendError {
  override name = "SpendManyError";
  constructor(
    readonly completed: SpendResult[],
    readonly failedIndex: number,
    override readonly cause: unknown,
  ) {
    super(`Soapay spend: spend ${failedIndex} failed after ${completed.length} succeeded`);
  }
}

/**
 * One userOp per stealth address, sent one after another, never combined: a combined userOp would
 * merge clusters on-chain (PRD guard). Run `guard.planSpend` before this; merging to a single
 * destination is a guard decision, not this function's.
 */
export async function spendMany(client: SpendClient, spends: readonly SpendParams[], options: SpendManyOptions = {}): Promise<SpendResult[]> {
  const sleep = options.sleep ?? defaultSleep;
  const random = options.random ?? Math.random;
  const results: SpendResult[] = [];
  for (let i = 0; i < spends.length; i++) {
    if (i > 0) {
      const pause = (options.delayMs ?? 0) + Math.floor(random() * (options.jitterMs ?? 0));
      if (pause > 0) await sleep(pause);
    }
    try {
      results.push(await spendFromStealth(client, spends[i]!, options));
    } catch (err) {
      throw new SpendManyError(results, i, err);
    }
  }
  return results;
}
