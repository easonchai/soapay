/**
 * Manual testnet check (Base Sepolia by default). Skipped unless LIVE_SPEND=1.
 *
 *   LIVE_SPEND=1 BUNDLER_URL=https://api.pimlico.io/v2/84532/rpc?apikey=... \
 *   STEALTH_KEY=0x... [SPEND_TO=0x...] [SPEND_AMOUNT=10000] [CHAIN_ID=84532] [RPC_URL=...] \
 *   pnpm --filter @soapay/sdk test spend.live
 *
 * STEALTH_KEY must hold test USDC (https://faucet.circle.com) and NO ETH. Run it twice: the first
 * run must report delegated=true (7702 authorization in the userOp), the second delegated=false.
 */
import { describe, expect, it } from "vitest";
import { createPublicClient, http, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { CHAINS, createSpendClient, estimateSpend, isDelegated, pimlicoFeesPerGas, spendFromStealth } from "../src/index.js";

const log = (globalThis as unknown as { console: { log: (...a: unknown[]) => void } }).console.log;
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
const live = env.LIVE_SPEND === "1" && !!env.BUNDLER_URL && !!env.STEALTH_KEY;

describe.skipIf(!live)("live spend (LIVE_SPEND=1)", () => {
  it("spends USDC from a stealth EOA with gas paid in USDC", async () => {
    const chainId = Number(env.CHAIN_ID ?? 84532) as keyof typeof CHAINS;
    const { chain } = CHAINS[chainId];
    const publicClient = createPublicClient({ chain, transport: http(env.RPC_URL) });
    const client = createSpendClient({
      chainId,
      publicClient,
      bundlerUrl: env.BUNDLER_URL!,
      ...(env.BUNDLER_URL!.includes("pimlico") ? { estimateFeesPerGas: pimlicoFeesPerGas } : {}),
    });
    const stealthKey = env.STEALTH_KEY as Hex;
    const from = privateKeyToAccount(stealthKey).address;
    expect(await publicClient.getBalance({ address: from })).toBe(0n);

    const to = (env.SPEND_TO ?? from) as Address;
    const amount = BigInt(env.SPEND_AMOUNT ?? 10_000);
    const est = await estimateSpend(client, { stealthKey, to, amount });
    log("estimate", { from, fee: est.fee, balance: est.balance, delegated: est.delegated });

    const res = await spendFromStealth(client, { stealthKey, to, amount }, { timeout: 120_000 });
    log("spent", res);
    expect(res.txHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect((await isDelegated(publicClient, from)).delegated).toBe(true);
    expect(await publicClient.getBalance({ address: from })).toBe(0n);
  }, 180_000);
});
