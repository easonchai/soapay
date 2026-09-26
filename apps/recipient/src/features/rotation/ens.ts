/**
 * ENSv2 rotation step (docs/mvp-spec.md §2.1 step 3): the registrant sends `setText("stealth", newMeta)`
 * on its own Permissioned Resolver on Ethereum Sepolia. The call data is the SDK's
 * `buildSetStealthRecordCall`; the API has already topped up the registrant's Sepolia gas.
 */
import { buildSetStealthRecordCall } from "@soapay/sdk";
import { createPublicClient, createWalletClient, http, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import { normalize } from "viem/ens";

export type BuildSetStealthRecordCall = (args: { name: string; metaAddress: string; resolver: Address }) => { to: Address; data: Hex };

export interface EnsWriter {
  readonly ready: boolean;
  readonly unavailableReason?: string;
  /** Sends the registrant's `setText(stealth)` and waits for it. The registrant key is used only here. */
  setStealthRecord(args: { name: string; metaAddress: string; registrantKey: Hex }): Promise<{ txHash: Hex }>;
}

const unavailable = (reason: string): EnsWriter => ({
  ready: false,
  unavailableReason: reason,
  setStealthRecord: () => Promise.reject(new Error(reason)),
});

/**
 * Used when no Ethereum Sepolia RPC is configured. viem's own default for Sepolia refuses browser
 * requests ("Failed to fetch"), which broke the last step of key rotation.
 */
export const DEFAULT_L1_RPC_URL = "https://ethereum-sepolia-rpc.publicnode.com";

export function createEnsWriter(opts: { l1RpcUrl: string; build?: BuildSetStealthRecordCall }): EnsWriter {
  const build = opts.build ?? buildSetStealthRecordCall;
  const transport = http(opts.l1RpcUrl || DEFAULT_L1_RPC_URL, { retryCount: 2 });
  const publicClient = createPublicClient({ chain: sepolia, transport });
  return {
    ready: true,
    async setStealthRecord({ name, metaAddress, registrantKey }) {
      const resolver = await publicClient.getEnsResolver({ name: normalize(name) });
      const call = build({ name, metaAddress, resolver });
      const wallet = createWalletClient({ account: privateKeyToAccount(registrantKey), chain: sepolia, transport });
      const txHash = await wallet.sendTransaction({ to: call.to, data: call.data });
      const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
      if (receipt.status !== "success") throw new Error(`setText reverted (${txHash})`);
      return { txHash };
    },
  };
}
