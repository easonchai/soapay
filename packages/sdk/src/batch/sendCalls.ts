import { parseSignature, type Account, type Hex, type PublicClient, type WalletClient } from 'viem';
import type { PlannedRow } from '../derive.js';
import type { BatchCall, BatchMode, BatchPartial, BatchProgress, BatchResult, BatchSender } from './types.js';
import { STEALTH_DISPERSE_ABI, buildDispersePayments } from './buildCalls.js';

const PERMIT_ABI = [
  { type: 'function', name: 'name', stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] },
  { type: 'function', name: 'version', stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] },
  { type: 'function', name: 'nonces', stateMutability: 'view', inputs: [{ name: 'owner', type: 'address' }], outputs: [{ type: 'uint256' }] },
] as const;

/**
 * Thrown when a run stopped after something already reached the chain. The UI must show
 * what confirmed and must not offer a retry with the same rows: that would pay twice.
 */
export class BatchPartialError extends Error {
  constructor(
    public readonly mode: BatchMode,
    public readonly txHashes: Hex[],
    public readonly announcedRows: number,
    public readonly paidRows: number,
    cause: unknown,
    public readonly pendingId?: string,
  ) {
    super(firstLine(cause));
    this.name = 'BatchPartialError';
  }
  toResult(): BatchResult {
    const partial: BatchPartial = { announcedRows: this.announcedRows, paidRows: this.paidRows, error: this.message, pendingId: this.pendingId };
    return { mode: this.mode, txHashes: this.txHashes, partial };
  }
}

const firstLine = (e: unknown) => (e instanceof Error ? e.message : String(e)).split('\n')[0];

/** EIP-2612 wants v in {27, 28}. viem returns yParity for 0/1 recovery bytes and v for 27/28. */
export function permitV(signature: Hex): number {
  const sig = parseSignature(signature);
  if (sig.v !== undefined) return Number(sig.v);
  return 27 + sig.yParity;
}

export type WalletBatchSenderOpts = {
  walletClient: WalletClient;
  publicClient: PublicClient;
  chainId: number;
  /** Needed only for the permit path. */
  token: Hex;
  stealthDisperse?: Hex | undefined;
  rows: PlannedRow[];
};

/**
 * Mode order: atomic (EIP-5792) > permit (StealthDisperse configured) > sequential.
 * 7702-delegated and smart accounts fail Base USDC permits via ERC-1271, which is why
 * atomic wins when available.
 */
export function createWalletBatchSender(opts: WalletBatchSenderOpts): BatchSender {
  const { walletClient, publicClient, chainId } = opts;
  const maybeAccount = walletClient.account;
  if (!maybeAccount) throw new Error('Wallet client has no account');
  const account: Account = maybeAccount;

  async function detect(): Promise<BatchMode> {
    try {
      const caps = (await walletClient.getCapabilities({ account, chainId })) as
        | { atomic?: { status?: string }; atomicBatch?: { supported?: boolean } }
        | undefined;
      const status = caps?.atomic?.status;
      if (status === 'supported' || status === 'ready') return 'atomic';
      if (caps?.atomicBatch?.supported === true) return 'atomic'; // pre-final EIP-5792 wallets
    } catch {
      /* wallet does not implement wallet_getCapabilities */
    }
    return opts.stealthDisperse ? 'permit' : 'sequential';
  }

  async function sendAtomic(calls: BatchCall[], onProgress: (p: BatchProgress) => void): Promise<BatchResult> {
    onProgress({ step: 'Waiting for wallet signature', done: 0, total: 1 });
    const { id } = await walletClient.sendCalls({ account, chain: walletClient.chain, calls, forceAtomic: true });
    onProgress({ step: 'Waiting for confirmation', done: 0, total: 1 });
    const n = opts.rows.length;
    try {
      const status = await walletClient.waitForCallsStatus({ id, timeout: 180_000 });
      const txHashes = (status.receipts ?? []).map((r) => r.transactionHash as Hex);
      if (status.status !== 'success') {
        // failure = bundle reverted atomically, nothing paid; pending/unknown = may still land
        const paid = status.status === 'failure' ? 0 : n;
        throw new BatchPartialError('atomic', txHashes, paid, paid, `Bundle status ${status.status ?? 'unknown'}`, id);
      }
      onProgress({ step: 'Confirmed', done: 1, total: 1 });
      return { mode: 'atomic', txHashes };
    } catch (e) {
      if (e instanceof BatchPartialError) throw e;
      // Submitted but we lost track of it (timeout, RPC). It may still confirm.
      throw new BatchPartialError('atomic', [], n, n, e, id);
    }
  }

  async function sendPermit(onProgress: (p: BatchProgress) => void): Promise<BatchResult> {
    const disperse = opts.stealthDisperse!;
    const total = opts.rows.reduce((a, r) => a + r.amount, 0n);
    const [name, version, nonce] = await Promise.all([
      publicClient.readContract({ address: opts.token, abi: PERMIT_ABI, functionName: 'name' }),
      publicClient.readContract({ address: opts.token, abi: PERMIT_ABI, functionName: 'version' }),
      publicClient.readContract({ address: opts.token, abi: PERMIT_ABI, functionName: 'nonces', args: [account.address] }),
    ]);
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 30 * 60);
    onProgress({ step: 'Sign USDC permit for the exact total', done: 0, total: 2 });
    const sig = await walletClient.signTypedData({
      account,
      domain: { name, version, chainId, verifyingContract: opts.token },
      types: {
        Permit: [
          { name: 'owner', type: 'address' },
          { name: 'spender', type: 'address' },
          { name: 'value', type: 'uint256' },
          { name: 'nonce', type: 'uint256' },
          { name: 'deadline', type: 'uint256' },
        ],
      },
      primaryType: 'Permit',
      message: { owner: account.address, spender: disperse, value: total, nonce, deadline },
    });
    const { r, s } = parseSignature(sig);
    onProgress({ step: 'Send payWithPermit', done: 1, total: 2 });
    const { request } = await publicClient.simulateContract({
      account,
      address: disperse,
      abi: STEALTH_DISPERSE_ABI,
      functionName: 'payWithPermit',
      args: [opts.token, buildDispersePayments(opts.rows), total, deadline, permitV(sig), r, s],
    });
    const hash = await walletClient.writeContract(request);
    try {
      await publicClient.waitForTransactionReceipt({ hash });
    } catch (e) {
      const n = opts.rows.length;
      throw new BatchPartialError('permit', [hash], n, n, e);
    }
    onProgress({ step: 'Confirmed', done: 2, total: 2 });
    return { mode: 'permit', txHashes: [hash] };
  }

  async function sendSequential(calls: BatchCall[], onProgress: (p: BatchProgress) => void): Promise<BatchResult> {
    // buildBatchCalls emits transfers first then announces; announce first here so a
    // failed transfer never leaves a payment without its announcement.
    const half = calls.length / 2;
    const ordered = [...calls.slice(half), ...calls.slice(0, half)];
    const txHashes: Hex[] = [];
    for (let i = 0; i < ordered.length; i++) {
      const call = ordered[i];
      if (!call) break;
      onProgress({ step: i < half ? 'Announcing' : 'Paying', done: i, total: ordered.length });
      try {
        const hash = await walletClient.sendTransaction({
          account,
          chain: walletClient.chain,
          to: call.to,
          data: call.data,
        });
        txHashes.push(hash);
        await publicClient.waitForTransactionReceipt({ hash });
      } catch (e) {
        const announced = Math.min(txHashes.length, half);
        const paid = Math.max(0, txHashes.length - half);
        throw new BatchPartialError('sequential', txHashes, announced, paid, e);
      }
    }
    onProgress({ step: 'Confirmed', done: ordered.length, total: ordered.length });
    return { mode: 'sequential', txHashes };
  }

  return {
    detect,
    async send(calls, onProgress, mode) {
      const m = mode ?? (await detect());
      if (m === 'atomic') return sendAtomic(calls, onProgress);
      if (m === 'permit') return sendPermit(onProgress);
      return sendSequential(calls, onProgress);
    },
  };
}
