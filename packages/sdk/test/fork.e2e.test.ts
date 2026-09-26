/**
 * End-to-end on a Base mainnet fork: real EntryPoint v0.8, Simple7702Account, Circle Paymaster v0.8,
 * USDC, Permit2 and Universal Router. Skipped unless FORK_E2E=1.
 *
 *   FORK_E2E=1 [FORK_RPC_URL=https://mainnet.base.org] pnpm --filter @soapay/sdk vitest run test/fork.e2e.test.ts
 *
 * The test starts anvil itself and plays the bundler: `eth_estimateUserOperationGas` returns fixed
 * limits, and `eth_sendUserOperation` calls `EntryPoint.handleOps([op], beneficiary)` from a funded
 * bundler EOA in a type-4 (EIP-7702) transaction carrying the stealth key's authorization, as real
 * bundlers do. Stealth addresses are funded with USDC only (storage write); they never get ETH.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createPublicClient,
  createWalletClient,
  custom,
  decodeEventLog,
  encodeAbiParameters,
  encodeFunctionData,
  erc20Abi,
  getAddress,
  http,
  isAddressEqual,
  keccak256,
  numberToHex,
  parseAbi,
  parseAbiParameters,
  parseEther,
  type Address,
  type Hex,
  type Log,
  type PublicClient,
  type SignedAuthorization,
  type Transport,
  type Chain,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";
import { entryPoint08Abi, toPackedUserOperation, type UserOperation } from "viem/account-abstraction";
import {
  CHAINS,
  CIRCLE_PAYMASTER_V08,
  ENTRYPOINT_V08,
  SIMPLE_7702_ACCOUNT,
  createSpendClient,
  isDelegated,
  spendFromStealth,
} from "../src/index.js";
import { NATIVE_ETH, PERMIT2_ADDRESS, UNIVERSAL_ROUTER, WETH_BASE, permit2Abi, swapInPlace, type SwapFetch } from "../src/swap.js";
import { startAnvil, selfBundler, type Anvil } from "./helpers/fork.js";

const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
const log = (globalThis as unknown as { console: { log: (...a: unknown[]) => void } }).console.log;
const enabled = env.FORK_E2E === "1";

const USDC = CHAINS[base.id].usdc;
const PAYMASTER = CIRCLE_PAYMASTER_V08[base.id];
const ROUTER = UNIVERSAL_ROUTER[base.id];
/** FiatTokenV2_2 `balanceAndBlacklistStates` mapping slot. */
const USDC_BALANCE_SLOT = 9n;
const DEST = "0x000000000000000000000000000000000000bEEF" as Address;

const usdcExtraAbi = parseAbi(["function nonces(address owner) view returns (uint256)"]);
const approvalEvent = parseAbi(["event Approval(address indexed owner, address indexed spender, uint256 value)"]);
const transferEvent = parseAbi(["event Transfer(address indexed from, address indexed to, uint256 value)"]);

describe.skipIf(!enabled)("Base fork E2E: 7702 + EntryPoint v0.8 + Circle paymaster + Uniswap", () => {
  let anvil: Anvil;
  let publicClient: PublicClient<Transport, Chain>;
  let bundler: ReturnType<typeof selfBundler>;
  let client: ReturnType<typeof createSpendClient>;
  const results: Record<string, unknown> = {};

  const erc20 = (token: Address, who: Address) => publicClient.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [who] });
  const fundUsdc = async (who: Address, amount: bigint) => {
    const slot = keccak256(encodeAbiParameters(parseAbiParameters("address, uint256"), [who, USDC_BALANCE_SLOT]));
    await publicClient.request({ method: "anvil_setStorageAt" as never, params: [USDC, slot, numberToHex(amount, { size: 32 })] as never });
    expect(await erc20(USDC, who)).toBe(amount);
  };
  const txLogs = async (hash: Hex): Promise<Log[]> => (await publicClient.getTransactionReceipt({ hash })).logs;

  beforeAll(async () => {
    anvil = await startAnvil();
    publicClient = createPublicClient({ chain: base, transport: http(anvil.url) }) as unknown as PublicClient<Transport, Chain>;
    bundler = selfBundler(publicClient, anvil.url);
    // Only the bundler EOA gets ETH.
    await publicClient.request({ method: "anvil_setBalance" as never, params: [bundler.bundler.address, numberToHex(parseEther("10"))] as never });
    // anvil answers eth_maxPriorityFeePerGas with 1 gwei, ~1000x a real Base tip, which would push the
    // USDC fee past the 1 USDC cap. Price like a Base bundler: 2x base fee + a 0.001 gwei tip.
    client = createSpendClient({
      chainId: base.id,
      publicClient,
      bundlerTransport: bundler.transport,
      estimateFeesPerGas: async () => {
        const { baseFeePerGas } = await publicClient.getBlock();
        const maxPriorityFeePerGas = 1_000_000n;
        return { maxFeePerGas: 2n * (baseFeePerGas ?? 0n) + maxPriorityFeePerGas, maxPriorityFeePerGas };
      },
    });
    for (const a of [ENTRYPOINT_V08, SIMPLE_7702_ACCOUNT, PAYMASTER, PERMIT2_ADDRESS, ROUTER]) {
      expect((await publicClient.getCode({ address: a }))?.length ?? 0, a).toBeGreaterThan(2);
    }
  }, 120_000);

  afterAll(() => {
    anvil?.stop();
    log("FORK E2E RESULTS", JSON.stringify(results, (_, v) => (typeof v === "bigint" ? v.toString() : v), 2));
  });

  it("first spend: delegates via 7702 inside handleOps, pays USDC to the destination, gas in USDC (permit via ERC-1271)", async () => {
    const stealthKey = generatePrivateKey();
    const stealth = privateKeyToAccount(stealthKey).address;
    await fundUsdc(stealth, 50_000_000n);
    expect(await publicClient.getBalance({ address: stealth })).toBe(0n);
    expect((await isDelegated(publicClient, stealth)).kind).toBe("eoa");

    const paymasterBefore = await erc20(USDC, PAYMASTER);
    const destBefore = await erc20(USDC, DEST);
    const res = await spendFromStealth(client, { stealthKey, to: DEST, amount: 10_000_000n });
    expect(res.delegated).toBe(true);
    expect(res.txHash).toBeDefined();
    expect(bundler.txs.at(-1)!.authorization).toBe(true);

    const status = await isDelegated(publicClient, stealth);
    expect(status).toMatchObject({ kind: "delegated", delegated: true, delegate: SIMPLE_7702_ACCOUNT });
    expect((await erc20(USDC, DEST)) - destBefore).toBe(10_000_000n);

    const stealthAfter = await erc20(USDC, stealth);
    const paymasterDelta = (await erc20(USDC, PAYMASTER)) - paymasterBefore;
    const feePaid = 50_000_000n - 10_000_000n - stealthAfter;
    expect(feePaid).toBeGreaterThan(0n);
    expect(feePaid).toBeLessThanOrEqual(res.feeEstimate);
    expect(paymasterDelta).toBe(feePaid);
    expect(await publicClient.getBalance({ address: stealth })).toBe(0n);

    // The Circle paymaster pulls its fee through USDC.permit(stealth → paymaster). The stealth EOA is
    // already delegated when validation runs, so FiatToken checks the signature via ERC-1271 on
    // Simple7702Account. A consumed nonce + Approval(stealth, paymaster) prove the permit validated.
    const nonce = await publicClient.readContract({ address: USDC, abi: usdcExtraAbi, functionName: "nonces", args: [stealth] });
    const approvals = (await txLogs(res.txHash!))
      .filter((l) => isAddressEqual(l.address, USDC))
      .flatMap((l) => {
        try {
          const ev = decodeEventLog({ abi: approvalEvent, data: l.data, topics: l.topics });
          return ev.eventName === "Approval" ? [ev.args] : [];
        } catch {
          return [];
        }
      })
      .filter((a) => isAddressEqual(a.owner, stealth) && isAddressEqual(a.spender, PAYMASTER));
    results.spend = { stealth, txHash: res.txHash, feePaid, feeEstimate: res.feeEstimate, delegate: status.delegate, usdcPermitNonceAfter: nonce, permitApproval: approvals[0]?.value };
    expect(nonce).toBe(1n);
    expect(approvals[0]?.value).toBe(1_000_000n); // permit amount = fee cap
    results.permitViaErc1271 = "VALIDATED";
  }, 180_000);

  it("swap in place: USDC -> WETH through the Universal Router, output lands only at the stealth address", async () => {
    const stealthKey = generatePrivateKey();
    const stealth = privateKeyToAccount(stealthKey).address;
    await fundUsdc(stealth, 50_000_000n);
    const wethBefore = await erc20(WETH_BASE, stealth);

    const res = await swapInPlace(client, { stealthKey, tokenOut: WETH_BASE, amountIn: 20_000_000n, slippageBps: 100 });
    expect(res.quote.source).toBe("universal-router");
    expect(res.delegated).toBe(true);

    const usdcAfter = await erc20(USDC, stealth);
    const wethGain = (await erc20(WETH_BASE, stealth)) - wethBefore;
    const feePaid = 50_000_000n - 20_000_000n - usdcAfter;
    expect(feePaid).toBeGreaterThan(0n);
    expect(wethGain).toBeGreaterThanOrEqual(res.quote.minOut);
    expect(await publicClient.getBalance({ address: stealth })).toBe(0n);

    // Every WETH Transfer in the tx ends at the stealth address; nobody else received tokenOut.
    const wethTransfers = (await txLogs(res.txHash!))
      .filter((l) => isAddressEqual(l.address, WETH_BASE))
      .map((l) => decodeEventLog({ abi: transferEvent, data: l.data, topics: l.topics, strict: false }))
      .filter((e) => e.eventName === "Transfer")
      .map((e) => e.args as { from: Address; to: Address; value: bigint });
    expect(wethTransfers.length).toBeGreaterThan(0);
    for (const t of wethTransfers) expect(getAddress(t.to)).toBe(stealth);

    // Exact approvals: nothing left over for Permit2 or the router.
    expect(await publicClient.readContract({ address: USDC, abi: erc20Abi, functionName: "allowance", args: [stealth, PERMIT2_ADDRESS] })).toBe(0n);
    const [p2amount] = await publicClient.readContract({ address: PERMIT2_ADDRESS, abi: permit2Abi, functionName: "allowance", args: [stealth, USDC, ROUTER] });
    expect(p2amount).toBe(0n);
    results.swapWeth = { stealth, txHash: res.txHash, amountIn: 20_000_000n, quoted: res.quote.amountOut, minOut: res.quote.minOut, wethGain, feePaid, route: res.quote.route };
  }, 180_000);

  it("swap in place to native ETH: unwrapped to the stealth address itself", async () => {
    const stealthKey = generatePrivateKey();
    const stealth = privateKeyToAccount(stealthKey).address;
    await fundUsdc(stealth, 30_000_000n);
    const res = await swapInPlace(client, { stealthKey, tokenOut: NATIVE_ETH, amountIn: 10_000_000n, slippageBps: 100 });
    const ethGain = await publicClient.getBalance({ address: stealth });
    expect(ethGain).toBeGreaterThanOrEqual(res.quote.minOut);
    expect(await erc20(WETH_BASE, stealth)).toBe(0n);
    // WETH only moved pool -> router, then was burned by the unwrap (no third party).
    const wethTransfers = (await txLogs(res.txHash!))
      .filter((l) => isAddressEqual(l.address, WETH_BASE))
      .flatMap((l) => {
        try {
          const e = decodeEventLog({ abi: transferEvent, data: l.data, topics: l.topics });
          return [e.args];
        } catch {
          return [];
        }
      });
    for (const t of wethTransfers) expect([ROUTER, stealth].map(getAddress)).toContain(getAddress(t.to));
    results.swapEth = { stealth, txHash: res.txHash, quoted: res.quote.amountOut, minOut: res.quote.minOut, ethGain };
  }, 180_000);

  // D-27, live: a real Trading API `/quote` (through the Soapay API proxy, which adds the key) with
  // a placeholder swapper, re-encoded locally and executed on the fork. Needs a running API:
  //   SWAP_API_URL=http://localhost:8787/uniswap FORK_E2E=1 pnpm --filter @soapay/sdk vitest run test/fork.e2e.test.ts
  it.skipIf(!env.SWAP_API_URL).each([
    ["WETH", WETH_BASE],
    ["native ETH", NATIVE_ETH],
  ] as const)("Trading API quote with a placeholder swapper, executed in place: USDC -> %s", async (label, tokenOut) => {
    const stealthKey = generatePrivateKey();
    const stealth = privateKeyToAccount(stealthKey).address;
    await fundUsdc(stealth, 30_000_000n);
    const bodies: string[] = [];
    const g = globalThis as unknown as { fetch: SwapFetch };
    const fetch: SwapFetch = (url, init) => {
      bodies.push(url + init.body);
      return g.fetch(url, init);
    };
    const balanceOut = () => (tokenOut === NATIVE_ETH ? publicClient.getBalance({ address: stealth }) : erc20(tokenOut, stealth));
    const before = await balanceOut();
    const res = await swapInPlace(client, { stealthKey, tokenOut, amountIn: 10_000_000n, slippageBps: 100, apiUrl: env.SWAP_API_URL!, source: "trading-api", fetch }, { wait: true });
    expect(res.quote.source).toBe("trading-api");
    expect(bodies.length).toBe(1);
    expect(bodies[0]!.toLowerCase()).not.toContain(stealth.slice(2).toLowerCase());
    const gain = (await balanceOut()) - before;
    expect(gain).toBeGreaterThanOrEqual(res.quote.minOut);
    results[`tradingApi${label.replace(/\W/g, "")}`] = { stealth, txHash: res.txHash, route: res.quote.route, quoted: res.quote.amountOut, minOut: res.quote.minOut, gain };
  }, 180_000);
});
