import { encodeFunctionData, erc20Abi, type Hex } from 'viem';
import { ERC5564AnnouncerAbi } from '@scopelift/stealth-address-sdk';
import type { PlannedRow } from '../derive.js';
import type { ChainConfig } from '../chains.js';
import type { BatchCall } from './types.js';

/** Contract-less path: N transfers then N announces from the sender's own account. */
export function buildBatchCalls(rows: PlannedRow[], cfg: Pick<ChainConfig, 'usdc' | 'announcer'>): BatchCall[] {
  const transfers: BatchCall[] = rows.map((r) => ({
    to: cfg.usdc,
    data: encodeFunctionData({ abi: erc20Abi, functionName: 'transfer', args: [r.stealthAddress, r.amount] }),
  }));
  const announces: BatchCall[] = rows.map((r) => ({
    to: cfg.announcer,
    data: encodeFunctionData({
      abi: ERC5564AnnouncerAbi,
      functionName: 'announce',
      args: [1n, r.stealthAddress, r.ephemeralPublicKey, r.metadata],
    }),
  }));
  return [...transfers, ...announces];
}

/** Mirrors contracts/src/StealthDisperse.sol. */
export const STEALTH_DISPERSE_ABI = [
  {
    type: 'function',
    name: 'pay',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'token', type: 'address' },
      {
        name: 'payments',
        type: 'tuple[]',
        components: [
          { name: 'stealthAddress', type: 'address' },
          { name: 'amount', type: 'uint256' },
          { name: 'ephemeralPubKey', type: 'bytes' },
          { name: 'viewTag', type: 'bytes1' },
        ],
      },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'payWithPermit',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'token', type: 'address' },
      {
        name: 'payments',
        type: 'tuple[]',
        components: [
          { name: 'stealthAddress', type: 'address' },
          { name: 'amount', type: 'uint256' },
          { name: 'ephemeralPubKey', type: 'bytes' },
          { name: 'viewTag', type: 'bytes1' },
        ],
      },
      { name: 'value', type: 'uint256' },
      { name: 'deadline', type: 'uint256' },
      { name: 'v', type: 'uint8' },
      { name: 'r', type: 'bytes32' },
      { name: 's', type: 'bytes32' },
    ],
    outputs: [],
  },
  { type: 'error', name: 'NotAscending', inputs: [{ name: 'index', type: 'uint256' }] },
  { type: 'error', name: 'BadEphemeralKey', inputs: [{ name: 'index', type: 'uint256' }] },
  { type: 'error', name: 'ZeroAmount', inputs: [{ name: 'index', type: 'uint256' }] },
  { type: 'error', name: 'PermitFailed', inputs: [] },
] as const;

export type DispersePayment = { stealthAddress: Hex; amount: bigint; ephemeralPubKey: Hex; viewTag: Hex };

/** Rows are already sorted ascending by deriveRows; the contract re-checks. */
export function buildDispersePayments(rows: PlannedRow[]): DispersePayment[] {
  return rows.map((r) => ({
    stealthAddress: r.stealthAddress,
    amount: r.amount,
    ephemeralPubKey: r.ephemeralPublicKey,
    viewTag: r.viewTag,
  }));
}
