// Command dispatch. `run` takes its I/O as parameters so tests drive it without a network or a TTY.
import { createPublicClient, createWalletClient, formatEther, formatUnits, http, isHex, type Address, type Hash, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  apiAnnouncementSource,
  compositeResolver,
  encodeDistribution,
  ensNameResolver,
  erc20Abi,
  erc6538Resolver,
  executeDistribution,
  getChain,
  keysFromMnemonic,
  metaAddressResolver,
  rpcAnnouncementSource,
  validateMnemonic,
  type AnnouncementSource,
  type NameResolver,
  type RegisteredChain,
} from "@soapay/sdk";
import { parseCli, USAGE, UsageError, type DistributeArgs, type ScanArgs } from "./args.js";
import { buildDistribution, formatPlan, planJson } from "./distribute.js";
import { formatScan, scanJson, scanPayments } from "./scan.js";

export type CliIo = {
  stdout(s: string): void;
  stderr(s: string): void;
  env: Record<string, string | undefined>;
  readFile(path: string): Promise<string>;
  /** Test overrides; production builds these from the chain registry and --rpc/--api. */
  resolver?: NameResolver;
  announcementSource?: AnnouncementSource;
  randomEphemeralKey?: () => Uint8Array;
  /** Test override for the sending side of `--execute`; production builds it over viem. */
  payerChain?: (key: Hex, chain: RegisteredChain, rpc: string) => PayerChain;
  /** Delay between allowance re-reads after the approval lands (ms). */
  pollMs?: number;
};

/** What `--execute` needs from the pay chain, acting as the payer. */
export type PayerChain = {
  payer: Address;
  tokenBalance(token: Address, owner: Address): Promise<bigint>;
  allowance(token: Address, owner: Address, spender: Address): Promise<bigint>;
  ethBalance(owner: Address): Promise<bigint>;
  sendTransaction(tx: { to: Address; data: Hex }): Promise<Hash>;
  waitForTransactionReceipt(args: { hash: Hash }): Promise<{ status: "success" | "reverted" }>;
};

const json = (v: unknown) => JSON.stringify(v, null, 2);
const transportOpts = { retryCount: 3, timeout: 30_000 } as const;

function rpcUrl(chain: RegisteredChain, override?: string): string {
  const url = override ?? chain.chain.rpcUrls.default.http[0];
  if (!url) throw new UsageError(`no RPC URL for chain ${chain.id}; pass --rpc`);
  return url;
}

function viemPayerChain(key: Hex, chain: RegisteredChain, rpc: string): PayerChain {
  const account = privateKeyToAccount(key);
  const transport = http(rpc, transportOpts);
  const pub = createPublicClient({ chain: chain.chain, transport });
  const wallet = createWalletClient({ account, chain: chain.chain, transport });
  return {
    payer: account.address,
    tokenBalance: (token, owner) => pub.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [owner] }),
    allowance: (token, owner, spender) => pub.readContract({ address: token, abi: erc20Abi, functionName: "allowance", args: [owner, spender] }),
    ethBalance: (owner) => pub.getBalance({ address: owner }),
    sendTransaction: (tx) => wallet.sendTransaction(tx),
    waitForTransactionReceipt: ({ hash }) => pub.waitForTransactionReceipt({ hash, timeout: 120_000 }),
  };
}

/** Block-explorer link for a tx, or the bare hash when the chain has no explorer. */
export function explorerTx(chain: RegisteredChain, hash: string): string {
  const base = chain.chain.blockExplorers?.default.url;
  return base ? `${base.replace(/\/+$/, "")}/tx/${hash}` : hash;
}

function defaultResolver(chain: RegisteredChain, rpc?: string, ensRpc?: string): NameResolver {
  // Network-backed resolvers are built lazily, so plain meta-address CSVs never touch the network.
  const lazy = (name: string, canResolve: (id: string) => boolean, make: () => NameResolver): NameResolver => {
    let inner: NameResolver | undefined;
    return { name, canResolve, resolve: (id) => (inner ??= make()).resolve(id) };
  };
  const baseClient = () => createPublicClient({ chain: chain.chain, transport: http(rpcUrl(chain, rpc), transportOpts) });
  const resolvers: NameResolver[] = [
    metaAddressResolver(),
    lazy("erc6538", (id) => /^0x[0-9a-fA-F]{40}$/.test(id.trim()), () => erc6538Resolver({ client: baseClient(), registry: chain.registry })),
  ];
  const ensChain = chain.ensChain;
  if (ensChain) {
    resolvers.push(
      lazy("ens", (id) => /\.[a-z]{2,}$/i.test(id.trim()), () =>
        ensNameResolver({
          ensClient: createPublicClient({ chain: ensChain, transport: http(ensRpc, transportOpts) }),
          baseClient: baseClient(),
          registry: chain.registry,
        }),
      ),
    );
  }
  return compositeResolver(resolvers);
}

async function distribute(args: DistributeArgs, io: CliIo): Promise<number> {
  const chain = getChain(args.chainId);
  const csv = await io.readFile(args.csv);
  const deps: Parameters<typeof buildDistribution>[2] = { resolver: io.resolver ?? defaultResolver(chain, args.rpc, args.ensRpc) };
  if (io.randomEphemeralKey) deps.randomEphemeralKey = io.randomEphemeralKey;
  const built = await buildDistribution(args, csv, deps);
  const stealthDisperse = args.disperse ?? chain.stealthDisperse;

  if (args.json) io.stdout(json(planJson(built, stealthDisperse)));
  else {
    const opts: Parameters<typeof formatPlan>[1] = { showLines: args.showLines, execute: args.execute };
    if (stealthDisperse) opts.stealthDisperse = stealthDisperse;
    io.stdout(formatPlan(built, opts));
  }
  if (!args.execute) return 0;

  if (chain.chain.testnet !== true && !args.allowMainnet) {
    throw new UsageError(`${chain.chain.name} is not a testnet; --execute there also needs --allow-mainnet. Nothing was sent.`);
  }
  if (!stealthDisperse) throw new UsageError(`no StealthDisperse on chain ${chain.id}; pass --disperse`);
  const key = io.env.PAYER_PRIVATE_KEY;
  if (!key || !isHex(key) || key.length !== 66) throw new UsageError("--execute needs PAYER_PRIVATE_KEY (0x + 64 hex) in the environment");
  const payerChain = (io.payerChain ?? viemPayerChain)(key as Hex, chain, rpcUrl(chain, args.rpc));
  const { plan } = built;
  const token = plan.asset.address;
  // With --json, stdout stays machine-readable; the human progress goes to stderr.
  const log = (line: string) => (args.json ? io.stderr(line) : io.stdout(line));
  const amt = (v: bigint) => `${formatUnits(v, built.decimals)} ${built.symbol}`;

  // Preflight: everything the payer is about to sign, checked before the first signature.
  const [balance, eth] = await Promise.all([payerChain.tokenBalance(token, payerChain.payer), payerChain.ethBalance(payerChain.payer)]);
  const encoded = encodeDistribution(plan, { via: "disperse", stealthDisperse });
  if (encoded.via !== "disperse") throw new Error("unreachable");
  log("");
  log("Preflight");
  log(`  payer       ${payerChain.payer}`);
  log(`  holds       ${amt(balance)}, ${Number(formatEther(eth)).toPrecision(4).replace(/\.?0+$/, "")} ETH for gas`);
  log(`  sends       ${amt(plan.total)} in ${plan.lines.length} lines to ${plan.recipientCount} recipients`);
  log(
    `  txs         ${1 + encoded.pays.length}: 1 approval (exact total, to StealthDisperse) + ${encoded.pays.length} pay (${plan.chunks.map((c) => c.length).join(", ")} lines)`,
  );
  if (balance < plan.total) throw new UsageError(`payer ${payerChain.payer} holds ${amt(balance)}; the plan needs ${amt(plan.total)}. Nothing was sent.`);
  if (eth === 0n) throw new UsageError(`payer ${payerChain.payer} has no ETH for gas on ${chain.chain.name}. Nothing was sent.`);

  log("");
  log("Sending");
  let approveHash: Hash | undefined;
  const pollMs = io.pollMs ?? 1_000;
  const result = await executeDistribution({
    encoded,
    wallet: { sendTransaction: (tx) => payerChain.sendTransaction(tx) },
    publicClient: {
      async waitForTransactionReceipt({ hash }) {
        const receipt = await payerChain.waitForTransactionReceipt({ hash });
        // Load-balanced public RPCs can estimate `pay` against a node that hasn't seen the approval
        // yet ("exceeds allowance"), so wait until the allowance is visible before the first pay.
        if (hash === approveHash && receipt.status === "success") {
          for (let i = 0; i < 30; i++) {
            if ((await payerChain.allowance(token, payerChain.payer, stealthDisperse)) >= plan.total) break;
            await new Promise((r) => setTimeout(r, pollMs));
          }
        }
        return receipt;
      },
    },
    onSent: (step) => {
      if (step.kind === "approve") approveHash = step.hash;
      const label = step.kind === "approve" ? "approve" : `pay ${step.index + 1}/${encoded.pays.length}`;
      log(`  ${label.padEnd(10)}  ${explorerTx(chain, step.hash)}`);
    },
  });
  if (args.json) io.stdout(json({ ...result, links: [result.approveHash, ...result.payHashes].map((h) => explorerTx(chain, h)) }));
  else {
    log("");
    log(`Done: ${amt(plan.total)} to ${plan.recipientCount} recipients on ${plan.lines.length} fresh stealth addresses, every line announced (ERC-5564).`);
  }
  return 0;
}

async function scan(args: ScanArgs, io: CliIo): Promise<number> {
  const chain = getChain(args.chainId);
  const phrase = io.env[args.mnemonicEnv];
  if (!phrase) throw new UsageError(`environment variable ${args.mnemonicEnv} is not set`);
  if (!validateMnemonic(phrase)) throw new UsageError(`${args.mnemonicEnv} does not hold a valid BIP-39 phrase`);
  const keys = keysFromMnemonic(phrase);

  const needsClient = args.balances || (!args.api && !io.announcementSource);
  const client = needsClient ? createPublicClient({ chain: chain.chain, transport: http(rpcUrl(chain, args.rpc), transportOpts) }) : undefined;
  const source =
    io.announcementSource ??
    (args.api
      ? apiAnnouncementSource({ apiUrl: args.api })
      : rpcAnnouncementSource({ client: client!, startBlock: chain.announcerStartBlock, announcer: chain.announcer }));
  const range: { fromBlock?: bigint; toBlock?: bigint } = {};
  if (args.fromBlock !== undefined) range.fromBlock = args.fromBlock;
  if (args.toBlock !== undefined) range.toBlock = args.toBlock;
  const announcements = await source.fetch(range);

  const params: Parameters<typeof scanPayments>[0] = { keys, announcements, chain };
  if (args.balances && client) params.balancesClient = client;
  if (args.knownPayers) params.knownPayers = args.knownPayers;
  const result = await scanPayments(params);
  io.stdout(args.json ? json(scanJson(result)) : formatScan(result, chain));
  return 0;
}

export async function run(argv: readonly string[], io: CliIo): Promise<number> {
  try {
    const args = parseCli(argv);
    if (args.command === "help") {
      io.stdout(USAGE);
      return 0;
    }
    return args.command === "distribute" ? await distribute(args, io) : await scan(args, io);
  } catch (e) {
    if (e instanceof UsageError) {
      io.stderr(`soapay: ${e.message}\n\n${USAGE}`);
      return 2;
    }
    io.stderr(`soapay: ${e instanceof Error ? e.message : String(e)}`);
    return 1;
  }
}
