/**
 * ENSv2 seam for rotation step 3 (docs/mvp-spec.md §2.1): the registrant sends `setText("stealth", newMeta)`
 * on its own Permissioned Resolver on Ethereum Sepolia.
 *
 * The call data comes from the SDK's `buildSetStealthRecordCall({ name, metaAddress, resolver })` in
 * packages/sdk/src/ensv2.ts, which is not in this tree yet.
 * TODO(ensv2): when it lands, make `loadBuildSetStealthRecordCall` return it:
 *     import { buildSetStealthRecordCall } from "@soapay/sdk";
 *     export function loadBuildSetStealthRecordCall() { return buildSetStealthRecordCall; }
 * Nothing else in the app changes.
 */
import { createPublicClient, createWalletClient, http, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import { normalize } from "viem/ens";

/** Exactly the SDK signature (ensv2.ts `Call` = `{ to, data }`). */
export type SetStealthRecordCall = { to: Address; data: Hex };
export type BuildSetStealthRecordCall = (args: { name: string; metaAddress: string; resolver: Address }) => SetStealthRecordCall;

export function loadBuildSetStealthRecordCall(): BuildSetStealthRecordCall | null {
  return null; // TODO(ensv2): return the SDK's buildSetStealthRecordCall
}

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

export function createEnsWriter(opts: { l1RpcUrl: string; build?: BuildSetStealthRecordCall | null }): EnsWriter {
  const build = opts.build === undefined ? loadBuildSetStealthRecordCall() : opts.build;
  if (!build) return unavailable("The ENSv2 record writer isn't in this build yet, so the on-chain step can't run.");
  const transport = http(opts.l1RpcUrl || undefined, { retryCount: 2 });
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
