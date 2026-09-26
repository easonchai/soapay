/** Real Chain and Api implementations over viem, the SDK and fetch. */
import { createPublicClient, createWalletClient, erc20Abi, http, type Address, type Chain as ViemChain, type Hex, type PublicClient, type Transport } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  createSpendClient,
  estimateSpend,
  executeFromStealth,
  fetchAnnouncements,
  getChainConfig,
  getRegistryNonce,
  pimlicoFeesPerGas,
  quoteSwapInPlace,
  resolveStealthMeta,
  spendMany,
  verifyBalances,
  type RegistryReader,
  type SpendClient,
} from "@soapay/sdk";
import type { McpConfig, Secrets } from "./config.js";
import { ApiError, type Api, type Chain } from "./context.js";

export function liveChain(config: McpConfig, secrets: Secrets): Chain {
  const cc = getChainConfig(config.chainId);
  const base = createPublicClient({ chain: cc.chain, transport: http(config.rpcUrl, { retryCount: 2, timeout: 30_000 }) }) as PublicClient<
    Transport,
    ViemChain
  >;
  const ens = createPublicClient({ chain: cc.ensChain, transport: http(config.ensRpcUrl, { retryCount: 2, timeout: 30_000 }) });
  const wallet = secrets.payerKey
    ? createWalletClient({ chain: cc.chain, transport: http(config.rpcUrl), account: privateKeyToAccount(secrets.payerKey) })
    : undefined;
  let spendClient: SpendClient | undefined;
  const spend = () =>
    (spendClient ??= createSpendClient({
      chainId: config.chainId,
      bundlerUrl: config.bundlerUrl,
      publicClient: base,
      // Used only where gas is sponsored (Base Sepolia); Base mainnet keeps the Circle USDC paymaster.
      paymasterUrl: config.paymasterUrl,
      ...(/pimlico/i.test(config.bundlerUrl) ? { estimateFeesPerGas: pimlicoFeesPerGas } : {}),
    }));

  return {
    usdc: cc.usdc,
    usdcBalance: (owner) => base.readContract({ address: cc.usdc, abi: erc20Abi, functionName: "balanceOf", args: [owner] }),
    ethBalance: (owner) => base.getBalance({ address: owner }),
    allowance: (owner, spender) =>
      base.readContract({ address: cc.usdc, abi: erc20Abi, functionName: "allowance", args: [owner, spender] }),
    gasPrice: () => base.getGasPrice(),
    registryNonce: (registrant) => getRegistryNonce(base as unknown as RegistryReader, registrant),
    resolveName: (name) => resolveStealthMeta({ ensClient: ens, baseClient: base as unknown as RegistryReader, name }),
    async sendTransaction(call) {
      if (!wallet) throw new Error("AGENT_PAYER_PRIVATE_KEY is not set");
      return wallet.sendTransaction({ to: call.to, data: call.data, account: wallet.account, chain: cc.chain });
    },
    async waitForReceipt(hash) {
      const r = await base.waitForTransactionReceipt({ hash, timeout: 120_000 });
      return r.status;
    },
    verifyBalances: (matches, tokens) => verifyBalances({ client: base, matches, tokens }),
    async quoteSpend(stealthKey: Hex, to: Address) {
      const e = await estimateSpend(spend(), { stealthKey, to, amount: "max" });
      return { fee: e.fee, balance: e.balance, maxSendable: e.maxSendable };
    },
    spendMany: (spends) => spendMany(spend(), spends, { wait: true }),
    execute: (params) => executeFromStealth(spend(), params, { wait: true }),
    quoteSwap: (params) =>
      quoteSwapInPlace({ ...params, chainId: config.chainId, publicClient: base, apiUrl: `${config.apiUrl}/uniswap` }),
  };
}

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch {
    throw new ApiError(0, "network", `can't reach the Soapay API at ${new URL(url).origin}`);
  }
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    // non-JSON
  }
  if (!res.ok) {
    const err = (body as { error?: { code?: string; message?: string } } | null)?.error;
    throw new ApiError(res.status, err?.code ?? `http_${res.status}`, err?.message ?? `request failed (${res.status})`);
  }
  return body as T;
}

const post = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

export function liveApi(config: McpConfig): Api {
  const root = config.apiUrl;
  return {
    register: (body) => call(`${root}/register`, post(body)),
    claimName: (body) => call(`${root}/names`, post(body)),
    async getName(label) {
      try {
        return await call(`${root}/names/${encodeURIComponent(label)}`);
      } catch (e) {
        if (e instanceof ApiError && e.status === 404) return null;
        throw e;
      }
    },
    async announcements() {
      return (await fetchAnnouncements({ apiUrl: root, limit: 1000 })).announcements;
    },
    faucet: (address) => call(`${root}/faucet`, post({ address })),
  };
}
