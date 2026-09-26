// Helpers shared by the examples: demo recipients and the optional send step.
import { createPublicClient, createWalletClient, formatUnits, http, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { encodeDistribution, executeDistribution, generateMnemonic, getChain, keysFromMnemonic, type DistributionPlan } from "@soapay/sdk";

/** Fresh demo meta-addresses. In a real run these are pinned at enrollment (ENS or ERC-6538). */
export function demoMetaAddresses(n: number): string[] {
  return Array.from({ length: n }, () => keysFromMnemonic(generateMnemonic()).metaAddressURI);
}

export function printPlan(plan: DistributionPlan, decimals: number, symbol: string): void {
  const fmt = (v: bigint) => `${formatUnits(v, decimals)} ${symbol}`;
  console.log(`${plan.kind}: ${plan.recipientCount} recipients, ${plan.lines.length} lines, ${plan.chunks.length} tx(s), total ${fmt(plan.total)}, ~${plan.estimate.totalGas} gas`);
  for (const w of plan.warnings) console.log(`  warning: ${w}`);
}

/**
 * Dry run unless EXECUTE=1. Sending needs PAYER_PRIVATE_KEY (and optionally RPC_URL) and a chain with
 * StealthDisperse registered (Base Sepolia by default).
 */
export async function maybeSend(plan: DistributionPlan, chainId: number): Promise<void> {
  if (process.env.EXECUTE !== "1") {
    console.log("Dry run: nothing sent. Set EXECUTE=1 and PAYER_PRIVATE_KEY to send.");
    return;
  }
  const chain = getChain(chainId);
  if (!chain.stealthDisperse) throw new Error(`no StealthDisperse registered on chain ${chainId}`);
  const key = process.env.PAYER_PRIVATE_KEY as Hex | undefined;
  if (!key) throw new Error("EXECUTE=1 needs PAYER_PRIVATE_KEY");
  const transport = http(process.env.RPC_URL);
  const account = privateKeyToAccount(key);
  const wallet = createWalletClient({ account, chain: chain.chain, transport });
  const publicClient = createPublicClient({ chain: chain.chain, transport });
  const encoded = encodeDistribution(plan, { via: "disperse", stealthDisperse: chain.stealthDisperse });
  if (encoded.via !== "disperse") throw new Error("unreachable");
  const res = await executeDistribution({
    encoded,
    wallet: { sendTransaction: (tx) => wallet.sendTransaction(tx) },
    publicClient,
    onSent: (s) => console.log(`  ${s.kind} ${s.index}: ${s.hash}`),
  });
  console.log(`Sent: approve ${res.approveHash}, ${res.payHashes.length} pay tx(s)`);
}
