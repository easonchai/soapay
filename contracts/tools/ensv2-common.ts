/**
 * Shared plumbing for the ENSv2 Sepolia scripts (contracts/ENSV2.md). Keys come ONLY from env.
 *
 * Env:
 *   SEPOLIA_RPC_URL   Ethereum Sepolia JSON-RPC (required)
 *   PARENT_LABEL      label under .eth, default "soapay" (-> soapay.eth)
 */
import {
  createPublicClient,
  createWalletClient,
  http,
  isHex,
  type Account,
  type Hex,
  type PublicClient,
  type WalletClient,
  type Transport,
  type Chain,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { sepolia } from 'viem/chains';
import { ENSV2_SEPOLIA, type Call } from '../../packages/sdk/src/ensv2.ts';

export const D = ENSV2_SEPOLIA;

export function env(key: string, fallback?: string): string {
  const v = process.env[key]?.trim();
  if (v) return v;
  if (fallback !== undefined) return fallback;
  throw new Error(`missing env ${key} (see contracts/ENSV2.md)`);
}

export function keyFromEnv(key: string): Account {
  const pk = env(key);
  if (!isHex(pk) || pk.length !== 66) throw new Error(`${key} must be a 0x-prefixed 32-byte hex private key`);
  return privateKeyToAccount(pk as Hex);
}

export const parentLabel = () => env('PARENT_LABEL', 'soapay').toLowerCase();
export const parentName = () => `${parentLabel()}.eth`;

export type Clients = {
  publicClient: PublicClient<Transport, Chain>;
  wallet: (account: Account) => WalletClient<Transport, Chain, Account>;
};

export async function clients(): Promise<Clients> {
  const transport = http(env('SEPOLIA_RPC_URL'));
  const publicClient = createPublicClient({ chain: sepolia, transport });
  const chainId = await publicClient.getChainId();
  if (chainId !== D.chainId) throw new Error(`SEPOLIA_RPC_URL is chain ${chainId}, expected ${D.chainId}`);
  return {
    publicClient,
    wallet: (account) => createWalletClient({ account, chain: sepolia, transport }),
  };
}

/** Send one call, wait for it, throw on revert. */
export async function send(
  c: Clients,
  account: Account,
  label: string,
  call: Call & { value?: bigint },
): Promise<Hex> {
  const hash = await c.wallet(account).sendTransaction({ to: call.to, data: call.data, value: call.value });
  const receipt = await c.publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== 'success') throw new Error(`${label}: tx ${hash} reverted`);
  console.log(`  ok  ${label}  ${hash}`);
  return hash;
}

export function main(fn: () => Promise<void>): void {
  fn().catch((e: unknown) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
