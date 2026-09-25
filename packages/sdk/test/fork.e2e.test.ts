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
import { NATIVE_ETH, PERMIT2_ADDRESS, UNIVERSAL_ROUTER, WETH_BASE, permit2Abi, swapInPlace } from "../src/swap.js";

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

type Anvil = { url: string; stop: () => void };

async function startAnvil(): Promise<Anvil> {
  const { spawn } = (await import("node:child_process" as string)) as {
    spawn: (cmd: string, args: string[], opts: object) => { kill: () => void; on: (e: string, f: (...a: unknown[]) => void) => void };
  };
  const port = 20_000 + Math.floor(Math.random() * 20_000);
  const upstream = env.FORK_RPC_URL ?? "https://mainnet.base.org";
  const child = spawn("anvil", ["--fork-url", upstream, "--port", String(port), "--silent"], { stdio: "ignore" });
  let exited = false;
  child.on("exit", () => (exited = true));
  const url = `http://127.0.0.1:${port}`;
  const probe = createPublicClient({ transport: http(url) });
  for (let i = 0; i < 120; i++) {
    if (exited) throw new Error("anvil exited early (is Foundry installed?)");
    try {
      if ((await probe.getChainId()) === base.id) return { url, stop: () => child.kill() };
    } catch {
      /* not up yet */
    }
    await new Promise((r) => (globalThis as unknown as { setTimeout: (f: () => void, ms: number) => void }).setTimeout(() => r(undefined), 500));
  }
  child.kill();
  throw new Error("anvil did not start");
}

/** Minimal in-process bundler: fixed gas estimates, handleOps via a type-4 tx, receipts from logs. */
function selfBundler(publicClient: PublicClient<Transport, Chain>, anvilUrl: string) {
  const bundlerKey = generatePrivateKey();
  const bundler = privateKeyToAccount(bundlerKey);
  const wallet = createWalletClient({ account: bundler, chain: base, transport: http(anvilUrl) });
  const receipts = new Map<string, unknown>();
  const txs: { hash: Hex; authorization: boolean }[] = [];

  const transport = custom({
    async request({ method, params }: { method: string; params?: unknown }) {
      const p = (params ?? []) as unknown[];
      switch (method) {
        case "eth_chainId":
          return numberToHex(base.id);
        case "eth_supportedEntryPoints":
          return [ENTRYPOINT_V08];
        case "eth_estimateUserOperationGas":
          return {
            preVerificationGas: numberToHex(100_000n),
            verificationGasLimit: numberToHex(400_000n),
            callGasLimit: numberToHex(600_000n),
          };
        case "eth_sendUserOperation": {
          const rpc = p[0] as Record<string, Hex> & { eip7702Auth?: Record<string, Hex> };
          expect(getAddress(p[1] as Address)).toBe(ENTRYPOINT_V08);
          const op = {
            sender: getAddress(rpc.sender!),
            nonce: BigInt(rpc.nonce!),
            callData: rpc.callData!,
            callGasLimit: BigInt(rpc.callGasLimit!),
            verificationGasLimit: BigInt(rpc.verificationGasLimit!),
            preVerificationGas: BigInt(rpc.preVerificationGas!),
            maxFeePerGas: BigInt(rpc.maxFeePerGas!),
            maxPriorityFeePerGas: BigInt(rpc.maxPriorityFeePerGas!),
            signature: rpc.signature!,
            ...(rpc.factory ? { factory: rpc.factory as Address, factoryData: (rpc.factoryData ?? "0x") as Hex } : {}),
            ...(rpc.paymaster
              ? {
                  paymaster: getAddress(rpc.paymaster),
                  paymasterData: rpc.paymasterData!,
                  paymasterVerificationGasLimit: BigInt(rpc.paymasterVerificationGasLimit!),
                  paymasterPostOpGasLimit: BigInt(rpc.paymasterPostOpGasLimit!),
                }
              : {}),
          } as UserOperation<"0.8">;
          const a = rpc.eip7702Auth;
          const authorization: SignedAuthorization | undefined = a
            ? {
                address: getAddress(a.address!),
                chainId: Number(BigInt(a.chainId!)),
                nonce: Number(BigInt(a.nonce!)),
                r: a.r!,
                s: a.s!,
                yParity: Number(BigInt(a.yParity!)),
              }
            : undefined;
          const data = encodeFunctionData({ abi: entryPoint08Abi, functionName: "handleOps", args: [[toPackedUserOperation(op)], bundler.address] });
          const hash = await wallet.sendTransaction({
            to: ENTRYPOINT_V08,
            data,
            gas: 3_000_000n,
            ...(authorization ? { authorizationList: [authorization] } : {}),
          });
          txs.push({ hash, authorization: !!authorization });
          const receipt = await publicClient.waitForTransactionReceipt({ hash });
          if (receipt.status !== "success") throw new Error(`handleOps reverted: ${hash}`);
          const rawReceipt = await publicClient.request({ method: "eth_getTransactionReceipt", params: [hash] });
          for (const l of receipt.logs) {
            if (!isAddressEqual(l.address, ENTRYPOINT_V08)) continue;
            try {
              const ev = decodeEventLog({ abi: entryPoint08Abi, data: l.data, topics: l.topics });
              if (ev.eventName !== "UserOperationEvent") continue;
              const args = ev.args as { userOpHash: Hex; sender: Address; paymaster: Address; nonce: bigint; success: boolean; actualGasCost: bigint; actualGasUsed: bigint };
              receipts.set(args.userOpHash, {
                userOpHash: args.userOpHash,
                entryPoint: ENTRYPOINT_V08,
                sender: args.sender,
                nonce: numberToHex(args.nonce),
                paymaster: args.paymaster,
                actualGasCost: numberToHex(args.actualGasCost),
                actualGasUsed: numberToHex(args.actualGasUsed),
                success: args.success,
                logs: (rawReceipt as { logs: unknown[] }).logs,
                receipt: rawReceipt,
              });
              return args.userOpHash;
            } catch {
              /* other EntryPoint event */
            }
          }
          throw new Error("no UserOperationEvent in handleOps receipt");
        }
        case "eth_getUserOperationReceipt":
          return receipts.get(p[0] as string) ?? null;
        default:
          throw new Error(`self-bundler: unsupported ${method}`);
      }
    },
  });
  return { transport, bundler, txs };
}

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
});
