// Chain and wallet adapters over @wagmi/core actions. No React: any UI (or a script)
// passes a wagmi `Config` and gets the dependency objects the pure modules expect.
import {
  getBalance,
  getBytecode,
  getCallsStatus,
  getCapabilities,
  getGasPrice,
  getTransactionReceipt,
  readContract,
  sendCalls,
  sendTransaction,
  waitForCallsStatus,
  waitForTransactionReceipt,
} from "wagmi/actions";
import type { Config } from "wagmi";
import { erc20Abi, parseAbi, type Address, type Hash } from "viem";
import type { BatchOutcome, ExecDeps, RecheckDeps } from "./execute.js";
import { classifyAccountCode, selectPayPath, type AccountKind, type PayPath } from "./paypath.js";
import type { AppConfig } from "../config.js";

const safeProbeAbi = parseAbi(["function getThreshold() view returns (uint256)"]);

function batchOutcome(status: string | undefined, receipts: readonly { status: string; transactionHash: Hash }[] | undefined): BatchOutcome {
  const txHash = receipts?.[receipts.length - 1]?.transactionHash;
  const s: BatchOutcome["status"] = status === "success" ? "success" : status === "failure" ? "failure" : "pending";
  return { status: s, ...(txHash ? { txHash } : {}) };
}

export function wagmiExecDeps(config: Config, app: Pick<AppConfig, "chainId" | "usdc">): ExecDeps {
  const { chainId, usdc } = app;
  return {
    sendTransaction: (call) => sendTransaction(config, { chainId, to: call.to, data: call.data }),
    waitForReceipt: async (hash) => {
      const r = await waitForTransactionReceipt(config, { chainId, hash, timeout: 180_000 });
      return r.status === "success" ? "success" : "reverted";
    },
    // Atomic is REQUIRED: a partially executed chunk would pay some lines without announcements.
    sendCalls: async (calls) => (await sendCalls(config, { chainId, calls, forceAtomic: true })).id,
    waitForCalls: async (id) => {
      const r = await waitForCallsStatus(config, { id, timeout: 180_000 });
      return batchOutcome(r.status, r.receipts);
    },
    readAllowance: (owner, spender) =>
      readContract(config, { chainId, address: usdc, abi: erc20Abi, functionName: "allowance", args: [owner, spender] }),
  };
}

export function wagmiRecheckDeps(config: Config, chainId: number): RecheckDeps {
  return {
    getReceipt: async (hash) => {
      try {
        const r = await getTransactionReceipt(config, { chainId, hash });
        return r.status === "success" ? "success" : "reverted";
      } catch {
        return null;
      }
    },
    getCallsStatus: async (id) => {
      const r = await getCallsStatus(config, { id });
      return batchOutcome(r.status, r.receipts);
    },
  };
}

export type AccountProbe = { kind: AccountKind; capabilities: unknown; disperseDeployed: boolean; path: PayPath };

/** Classifies the connected account and picks the pay path (paypath.ts). */
export async function probeAccount(config: Config, app: AppConfig, account: Address): Promise<AccountProbe> {
  const chainId = app.chainId;
  const [code, capabilities, disperseCode] = await Promise.all([
    getBytecode(config, { chainId, address: account }).catch(() => undefined),
    getCapabilities(config, { account, chainId }).catch(() => undefined),
    app.stealthDisperse ? getBytecode(config, { chainId, address: app.stealthDisperse }).catch(() => undefined) : Promise.resolve(undefined),
  ]);
  let looksLikeSafe = false;
  if (code && code !== "0x") {
    looksLikeSafe = await readContract(config, { chainId, address: account, abi: safeProbeAbi, functionName: "getThreshold" })
      .then(() => true)
      .catch(() => false);
  }
  const kind = classifyAccountCode(code, looksLikeSafe);
  const disperseDeployed = !!disperseCode && disperseCode !== "0x";
  return {
    kind,
    capabilities,
    disperseDeployed,
    path: selectPayPath({ chainId, capabilities, accountKind: kind, stealthDisperse: app.stealthDisperse, disperseDeployed }),
  };
}

export type Funding = {
  usdcBalance: bigint | null;
  allowance: bigint | null;
  ethBalance: bigint | null;
  gasPrice: bigint | null;
};

/** Balance, allowance (StealthDisperse only) and gas price for the preview. Nulls = couldn't read. */
export async function readFunding(config: Config, app: AppConfig, account: Address): Promise<Funding> {
  const chainId = app.chainId;
  const [usdcBalance, allowance, eth, gasPrice] = await Promise.all([
    readContract(config, { chainId, address: app.usdc, abi: erc20Abi, functionName: "balanceOf", args: [account] }).catch(() => null),
    app.stealthDisperse
      ? readContract(config, { chainId, address: app.usdc, abi: erc20Abi, functionName: "allowance", args: [account, app.stealthDisperse] }).catch(
          () => null,
        )
      : Promise.resolve(null),
    getBalance(config, { chainId, address: account }).catch(() => null),
    getGasPrice(config, { chainId }).catch(() => null),
  ]);
  return { usdcBalance, allowance, ethBalance: eth?.value ?? null, gasPrice };
}
