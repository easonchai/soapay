/**
 * Exit legs on real forks. Skipped unless FORK_E2E=1.
 *
 *   FORK_E2E=1 pnpm --filter @soapay/sdk exec vitest run test/exit.fork.e2e.test.ts
 *
 * Sepolia fork (SEPOLIA_FORK_RPC_URL, default publicnode): a fresh stealth EOA holding only USDC
 * delegates to Simple7702Account inside a self-bundled handleOps, pays gas in USDC through the real
 * Circle Paymaster v0.8 (its USDC.permit validated via ERC-1271), and deposits into the real 0xbow
 * USDC pool; then ragequits (real commitment proof, artifacts fetched from privacypools.com).
 *
 * Base Sepolia fork (BASE_SEPOLIA_FORK_RPC_URL, default sepolia.base.org): the CCTP V2
 * depositForBurnWithHook from a stealth address, checking the emitted DepositForBurn fields.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createPublicClient,
  decodeEventLog,
  encodeAbiParameters,
  erc20Abi,
  http,
  isAddressEqual,
  keccak256,
  numberToHex,
  pad,
  parseAbi,
  parseAbiParameters,
  parseEther,
  type Address,
  type Chain,
  type Hex,
  type PublicClient,
  type Transport,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { baseSepolia, sepolia } from "viem/chains";
import {
  CCTP_FORWARD_HOOK_DATA,
  CIRCLE_PAYMASTER_V08,
  ENTRYPOINT_V08,
  EXIT_BASE_SEPOLIA_TO_SEPOLIA as CONFIG,
  SIMPLE_7702_ACCOUNT,
  advanceExitLeg,
  createSpendClient,
  isDelegated,
  keysFromMnemonic,
  planExit,
  ppPoolAbi,
  type ExitContext,
  type ExitLeg,
} from "../src/index.js";
import { env, selfBundler, startAnvil, type Anvil } from "./helpers/fork.js";

const log = (globalThis as unknown as { console: { log: (...a: unknown[]) => void } }).console.log;
const enabled = env.FORK_E2E === "1";
const USDC_BALANCE_SLOT = 9n; // FiatTokenV2_2 balanceAndBlacklistStates
const keys = keysFromMnemonic("test test test test test test test test test test test junk");
const DEST_WALLET = "0x000000000000000000000000000000000000bEEF" as Address;
const results: Record<string, unknown> = {};

const usdcExtraAbi = parseAbi(["function nonces(address owner) view returns (uint256)"]);
const approvalEvent = parseAbi(["event Approval(address indexed owner, address indexed spender, uint256 value)"]);
const depositForBurnEvent = parseAbi([
  "event DepositForBurn(address indexed burnToken, uint256 amount, address indexed depositor, bytes32 mintRecipient, uint32 destinationDomain, bytes32 destinationTokenMessenger, bytes32 destinationCaller, uint256 maxFee, uint32 indexed minFinalityThreshold, bytes hookData)",
]);

async function forkClient(upstream: string, chain: Chain) {
  const anvil = await startAnvil({ upstream, chain });
  const publicClient = createPublicClient({ chain, transport: http(anvil.url) }) as unknown as PublicClient<Transport, Chain>;
  const bundler = selfBundler(publicClient, anvil.url, chain);
  await publicClient.request({ method: "anvil_setBalance" as never, params: [bundler.bundler.address, numberToHex(parseEther("10"))] as never });
  const client = createSpendClient({
    chainId: chain.id,
    publicClient,
    bundlerTransport: bundler.transport,
    estimateFeesPerGas: async () => {
      const { baseFeePerGas } = await publicClient.getBlock();
      const maxPriorityFeePerGas = 1_000_000n;
      return { maxFeePerGas: 2n * (baseFeePerGas ?? 0n) + maxPriorityFeePerGas, maxPriorityFeePerGas };
    },
  });
  const fundUsdc = async (token: Address, who: Address, amount: bigint) => {
    const slot = keccak256(encodeAbiParameters(parseAbiParameters("address, uint256"), [who, USDC_BALANCE_SLOT]));
    await publicClient.request({ method: "anvil_setStorageAt" as never, params: [token, slot, numberToHex(amount, { size: 32 })] as never });
    expect(await publicClient.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [who] })).toBe(amount);
  };
  const balance = (token: Address, who: Address) => publicClient.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [who] });
  return { anvil, publicClient, bundler, client, fundUsdc, balance };
}

describe.skipIf(!enabled)("Exit fork E2E", () => {
  afterAll(() => log("EXIT FORK RESULTS", JSON.stringify(results, (_, v) => (typeof v === "bigint" ? v.toString() : v), 2)));

  describe("Ethereum Sepolia: 7702 + Circle paymaster + 0xbow pool", () => {
    let f: Awaited<ReturnType<typeof forkClient>>;
    beforeAll(async () => {
      f = await forkClient(env.SEPOLIA_FORK_RPC_URL ?? "https://ethereum-sepolia-rpc.publicnode.com", sepolia);
      for (const a of [ENTRYPOINT_V08, SIMPLE_7702_ACCOUNT, CIRCLE_PAYMASTER_V08[sepolia.id], CONFIG.pool.entrypoint, CONFIG.pool.pool, CONFIG.pool.asset])
        expect((await f.publicClient.getCode({ address: a }))?.length ?? 0, a).toBeGreaterThan(2);
    }, 180_000);
    afterAll(() => f?.anvil.stop());

    it("a USDC-only stealth address deposits via approve + Entrypoint.deposit, then ragequits", async () => {
      const stealthKey = generatePrivateKey();
      const stealth = privateKeyToAccount(stealthKey).address;
      const USDC = CONFIG.pool.asset;
      const PAYMASTER = CIRCLE_PAYMASTER_V08[sepolia.id];
      // Our self-bundler's fixed gas limits (1.3M) at 2x base fee need a large prefund; the real
      // bundler's estimates are much tighter. The prefund's unused part is refunded in postOp.
      await f.fundUsdc(USDC, stealth, 40_000_000n);
      expect(await f.publicClient.getBalance({ address: stealth })).toBe(0n);

      const { legs } = planExit({ sources: [{ stealthAddress: stealth, amount: 40_000_000n }], destination: DEST_WALLET, config: CONFIG, firstPoolIndex: 0 });
      // Start at "minted": the bridge half runs on the Base Sepolia fork below.
      let leg: ExitLeg = { ...legs[0]!, status: "minted", mint: { amount: "40000000" } };
      const ctx: ExitContext = {
        config: CONFIG,
        spendClients: { [sepolia.id]: f.client },
        stealthKey,
        keys,
        maxFeeUsdc: { [sepolia.id]: 30_000_000n },
        persist: () => undefined,
      };
      const paymasterBefore = await f.balance(USDC, PAYMASTER);
      const poolBefore = await f.balance(USDC, CONFIG.pool.pool);

      leg = await advanceExitLeg(ctx, leg);
      expect(leg.error).toBeUndefined();
      expect(leg.status).toBe("depositing");
      expect(f.bundler.txs.at(-1)!.authorization).toBe(true);
      expect(await isDelegated(f.publicClient, stealth)).toMatchObject({ kind: "delegated", delegated: true });

      leg = await advanceExitLeg(ctx, leg);
      expect(leg.error).toBeUndefined();
      expect(leg.status).toBe("pending-asp");
      const deposited = BigInt(leg.deposit!.amount);
      const value = BigInt(leg.deposit!.value);
      expect(value).toBe(deposited - (deposited * CONFIG.pool.vettingFeeBps) / 10_000n);
      expect((await f.balance(USDC, CONFIG.pool.pool)) - poolBefore).toBe(value);
      expect(await f.publicClient.getBalance({ address: stealth })).toBe(0n);

      // Circle paymaster took its fee via USDC.permit(stealth → paymaster), validated through
      // ERC-1271 on Simple7702Account (the stealth EOA is delegated when validation runs).
      const receipt = await f.publicClient.getTransactionReceipt({ hash: leg.txs.deposit! });
      const approvals = receipt.logs
        .filter((l) => isAddressEqual(l.address, USDC))
        .flatMap((l) => {
          try {
            const ev = decodeEventLog({ abi: approvalEvent, data: l.data, topics: l.topics });
            return [ev.args];
          } catch {
            return [];
          }
        })
        .filter((a) => isAddressEqual(a.owner, stealth) && isAddressEqual(a.spender, PAYMASTER));
      const permitNonce = await f.publicClient.readContract({ address: USDC, abi: usdcExtraAbi, functionName: "nonces", args: [stealth] });
      expect(permitNonce).toBe(1n);
      expect(approvals.length).toBeGreaterThan(0);
      const paymasterFee = (await f.balance(USDC, PAYMASTER)) - paymasterBefore;
      expect(paymasterFee).toBeGreaterThan(0n);
      results.sepoliaDeposit = {
        stealth,
        tx: leg.txs.deposit,
        deposited,
        valueInPool: value,
        label: leg.deposit!.label,
        paymasterFeeUsdc: paymasterFee,
        gasUsed: receipt.gasUsed,
        permitViaErc1271: "VALIDATED",
      };

      // Declined path: ragequit from the stealth address (real commitment proof).
      leg = { ...leg, status: "declined" };
      // Top up for the ragequit's (self-bundler-sized) prefund; production reserves it at deposit.
      await f.fundUsdc(USDC, stealth, (await f.balance(USDC, stealth)) + 20_000_000n);
      const before = await f.balance(USDC, stealth);
      leg = await advanceExitLeg(ctx, leg);
      expect(leg.error).toBeUndefined();
      expect(leg.status).toBe("refunded");
      const rq = await f.publicClient.getTransactionReceipt({ hash: leg.txs.refund! });
      const ev = rq.logs
        .filter((l) => isAddressEqual(l.address, CONFIG.pool.pool))
        .map((l) => {
          try {
            return decodeEventLog({ abi: ppPoolAbi, data: l.data, topics: l.topics });
          } catch {
            return undefined;
          }
        })
        .find((e) => e?.eventName === "Ragequit");
      expect(ev?.args).toMatchObject({ _ragequitter: stealth, _value: value, _label: BigInt(leg.deposit!.label) });
      const after = await f.balance(USDC, stealth);
      expect(after - before).toBeGreaterThan(value - 3_000_000n); // value back, minus the ragequit gas
      results.sepoliaRagequit = { tx: leg.txs.refund, returned: value, stealthDelta: after - before, gasUsed: rq.gasUsed };
    }, 600_000);
  });

  describe("Base Sepolia: CCTP V2 burn with the forwarding hook", () => {
    let f: Awaited<ReturnType<typeof forkClient>>;
    beforeAll(async () => {
      f = await forkClient(env.BASE_SEPOLIA_FORK_RPC_URL ?? "https://sepolia.base.org", baseSepolia);
    }, 180_000);
    afterAll(() => f?.anvil.stop());

    it("burns from the stealth address to the same address on Sepolia, gas in USDC", async () => {
      const stealthKey = generatePrivateKey();
      const stealth = privateKeyToAccount(stealthKey).address;
      const USDC = CONFIG.cctp.source.usdc;
      await f.fundUsdc(USDC, stealth, 14_000_000n);
      const { legs } = planExit({ sources: [{ stealthAddress: stealth, amount: 14_000_000n }], destination: DEST_WALLET, config: CONFIG });
      const ctx: ExitContext = { config: CONFIG, spendClients: { [baseSepolia.id]: f.client }, stealthKey, keys };
      const leg = await advanceExitLeg(ctx, legs[0]!);
      expect(leg.error).toBeUndefined();
      expect(leg.status).toBe("burning");
      const receipt = await f.publicClient.getTransactionReceipt({ hash: leg.txs.burn! });
      const burn = receipt.logs
        .filter((l) => isAddressEqual(l.address, CONFIG.cctp.source.tokenMessenger))
        .map((l) => decodeEventLog({ abi: depositForBurnEvent, data: l.data, topics: l.topics }))[0]!;
      expect(burn.args).toMatchObject({
        burnToken: USDC,
        amount: BigInt(leg.burn!.amount),
        depositor: stealth,
        mintRecipient: pad(stealth.toLowerCase() as Hex, { size: 32 }),
        destinationDomain: 0,
        destinationCaller: pad("0x0", { size: 32 }),
        maxFee: BigInt(leg.burn!.maxFee),
        minFinalityThreshold: 1000,
        hookData: CCTP_FORWARD_HOOK_DATA,
      });
      const left = await f.balance(USDC, stealth);
      expect(left).toBeLessThan(14_000_000n - BigInt(leg.burn!.amount) + 1n);
      expect(await f.publicClient.getBalance({ address: stealth })).toBe(0n);
      results.baseSepoliaBurn = { stealth, tx: leg.txs.burn, burned: leg.burn!.amount, maxFee: leg.burn!.maxFee, gasFeeUsdc: 14_000_000n - BigInt(leg.burn!.amount) - left, gasUsed: receipt.gasUsed };
    }, 300_000);
  });
});
