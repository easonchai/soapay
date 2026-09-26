/**
 * Read-only check of the demo views (D-41) against the live Base Sepolia pay run and gasless spend
 * (docs/demo-flow.md "Links to have open"). Skipped unless LIVE_VIEWS=1. No keys needed.
 *
 *   LIVE_VIEWS=1 [RPC_URL=https://sepolia.base.org] pnpm --filter @soapay/sdk test views.live
 */
import { describe, expect, it } from "vitest";
import { createPublicClient, getAddress, http } from "viem";
import { baseSepolia } from "viem/chains";
import { fetchPayRunBatch, readGaslessProof, SIMPLE_7702_ACCOUNT } from "../src/index.js";

const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
const live = env.LIVE_VIEWS === "1";

const PAY_RUN = "0x24f23d610d1917905d3896e282243b07a038afb2bf266f94f11f31ea9e5b492d" as const;
const SPEND = "0x1167b83dfab7476ac32b286b890fdcfdba396766d9389778568d949cbffc1bae" as const;
const SPENDER = getAddress("0x535a79686fc7c65d2f19ba62c3f99125c2a6f72b");

describe.skipIf(!live)("live demo views (LIVE_VIEWS=1)", () => {
  const client = createPublicClient({ chain: baseSepolia, transport: http(env.RPC_URL) });

  it("rebuilds the live pay run: 2 lines, 3.0 and 2.5 USDC", async () => {
    const batch = await fetchPayRunBatch({ client, txHash: PAY_RUN, chainId: baseSepolia.id });
    expect(batch.lines.map((l) => l.amount)).toEqual([3_000_000n, 2_500_000n]);
    expect(batch.lines[0]!.stealthAddress).toBe(SPENDER);
    expect(batch.unfunded).toBe(0);
  });

  it("proves the live gasless spend: 0 ETH, 7702 → Simple7702Account, Circle paymaster fee in USDC", async () => {
    const p = await readGaslessProof({ client, address: SPENDER, chainId: baseSepolia.id, txHash: SPEND });
    expect(p.ethBalance).toBe(0n);
    expect(p.account.delegate).toBe(getAddress(SIMPLE_7702_ACCOUNT));
    expect(p.spend?.paymasterKind).toBe("circle");
    expect(p.spend?.usdcFee).toBe(5_666n);
  });
});
