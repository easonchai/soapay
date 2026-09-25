/**
 * Shared Base-fork harness for the E2E suites: starts anvil and plays a minimal 4337 bundler
 * (fixed gas estimates, handleOps in a type-4 tx carrying the 7702 authorization).
 */
import { expect } from "vitest";
import {
  createPublicClient,
  createWalletClient,
  custom,
  decodeEventLog,
  encodeFunctionData,
  getAddress,
  http,
  isAddressEqual,
  numberToHex,
  type Address,
  type Hex,
  type PublicClient,
  type SignedAuthorization,
  type Transport,
  type Chain,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";
import { entryPoint08Abi, toPackedUserOperation, type UserOperation } from "viem/account-abstraction";
import { ENTRYPOINT_V08 } from "../../src/index.js";

export const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;

export type Anvil = { url: string; stop: () => void };

export async function startAnvil(): Promise<Anvil> {
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
export function selfBundler(publicClient: PublicClient<Transport, Chain>, anvilUrl: string) {
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

