import type { Hex, PublicClient } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { ERC6538RegistryAbi } from '@scopelift/stealth-address-sdk';
import type { StealthKeys } from './keys.js';

export type RelayRequest = { registrant: Hex; schemeId: 1; stealthMetaAddress: Hex; signature: Hex };
export type RelayResponse = { txHash: Hex } | { error: string };

export const REGISTRY_TYPES = {
  Erc6538RegistryEntry: [
    { name: 'schemeId', type: 'uint256' },
    { name: 'stealthMetaAddress', type: 'bytes' },
    { name: 'nonce', type: 'uint256' },
  ],
} as const;

/** Pure: signs the ERC-6538 registerKeysOnBehalf payload with the registrant's own key. */
export async function signRegisterOnBehalf(opts: {
  keys: Pick<StealthKeys, 'registrantPrivateKey' | 'registrant' | 'stealthMetaAddress'>;
  chainId: number;
  registry: Hex;
  nonce: bigint;
}): Promise<RelayRequest> {
  const account = privateKeyToAccount(opts.keys.registrantPrivateKey);
  const signature = await account.signTypedData({
    domain: { name: 'ERC6538Registry', version: '1.0', chainId: opts.chainId, verifyingContract: opts.registry },
    types: REGISTRY_TYPES,
    primaryType: 'Erc6538RegistryEntry',
    message: { schemeId: 1n, stealthMetaAddress: opts.keys.stealthMetaAddress, nonce: opts.nonce },
  });
  return {
    registrant: opts.keys.registrant,
    schemeId: 1,
    stealthMetaAddress: opts.keys.stealthMetaAddress,
    signature,
  };
}

/** '0x' when nothing is registered for scheme 1. */
export function readRegisteredMeta(publicClient: PublicClient, registry: Hex, registrant: Hex) {
  return publicClient.readContract({
    address: registry,
    abi: ERC6538RegistryAbi,
    functionName: 'stealthMetaAddressOf',
    args: [registrant, 1n],
  }) as Promise<Hex>;
}

export function readNonce(publicClient: PublicClient, registry: Hex, registrant: Hex) {
  return publicClient.readContract({
    address: registry,
    abi: ERC6538RegistryAbi,
    functionName: 'nonceOf',
    args: [registrant],
  }) as Promise<bigint>;
}

export async function submitToRelay(relayUrl: string, req: RelayRequest): Promise<Hex> {
  const res = await fetch(relayUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(req),
  });
  const body = (await res.json().catch(() => ({ error: `HTTP ${res.status}` }))) as RelayResponse;
  if (!res.ok || 'error' in body) throw new Error('error' in body ? body.error : `Relay failed: HTTP ${res.status}`);
  return body.txHash;
}

const REGISTRY_SET_EVENT = {
  type: 'event',
  name: 'StealthMetaAddressSet',
  inputs: [
    { name: 'registrant', type: 'address', indexed: true },
    { name: 'schemeId', type: 'uint256', indexed: true },
    { name: 'stealthMetaAddress', type: 'bytes', indexed: false },
  ],
} as const;

/**
 * Recovers the registration block for a registrant that was registered elsewhere, via one
 * indexed log query. Returns null when no event is found; throws when the RPC refuses the range.
 */
export async function findRegistrationBlock(
  publicClient: PublicClient,
  registry: Hex,
  registrant: Hex,
  fromBlock: bigint,
): Promise<bigint | null> {
  const toBlock = await publicClient.getBlockNumber();
  const logs = await publicClient.getLogs({
    address: registry,
    event: REGISTRY_SET_EVENT,
    args: { registrant },
    fromBlock,
    toBlock,
  });
  let min: bigint | null = null;
  for (const l of logs) {
    if (l.blockNumber !== null && (min === null || l.blockNumber < min)) min = l.blockNumber;
  }
  return min;
}
