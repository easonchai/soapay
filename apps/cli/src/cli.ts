// Command dispatch. `run` takes its I/O as parameters so tests drive it without a network or a TTY.
import { createPublicClient, createWalletClient, http, isHex, type Hex } from "viem";
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
};

const json = (v: unknown) => JSON.stringify(v, null, 2);

function rpcUrl(chain: RegisteredChain, override?: string): string {
  const url = override ?? chain.chain.rpcUrls.default.http[0];
  if (!url) throw new UsageError(`no RPC URL for chain ${chain.id}; pass --rpc`);
  return url;
}

function defaultResolver(chain: RegisteredChain, rpc?: string): NameResolver {
  // Network-backed resolvers are built lazily, so plain meta-address CSVs never touch the network.
  const lazy = (name: string, canResolve: (id: string) => boolean, make: () => NameResolver): NameResolver => {
    let inner: NameResolver | undefined;
    return { name, canResolve, resolve: (id) => (inner ??= make()).resolve(id) };
  };
  const baseClient = () => createPublicClient({ chain: chain.chain, transport: http(rpcUrl(chain, rpc)) });
  const resolvers: NameResolver[] = [
    metaAddressResolver(),
    lazy("erc6538", (id) => /^0x[0-9a-fA-F]{40}$/.test(id.trim()), () => erc6538Resolver({ client: baseClient(), registry: chain.registry })),
  ];
  const ensChain = chain.ensChain;
  if (ensChain) {
    resolvers.push(
      lazy("ens", (id) => /\.[a-z]{2,}$/i.test(id.trim()), () =>
        ensNameResolver({ ensClient: createPublicClient({ chain: ensChain, transport: http() }), baseClient: baseClient(), registry: chain.registry }),
      ),
    );
  }
  return compositeResolver(resolvers);
}

async function distribute(args: DistributeArgs, io: CliIo): Promise<number> {
  const chain = getChain(args.chainId);
  const csv = await io.readFile(args.csv);
  const deps: Parameters<typeof buildDistribution>[2] = { resolver: io.resolver ?? defaultResolver(chain, args.rpc) };
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

  if (!stealthDisperse) throw new UsageError(`no StealthDisperse on chain ${chain.id}; pass --disperse`);
  const key = io.env.PAYER_PRIVATE_KEY;
  if (!key || !isHex(key) || key.length !== 66) throw new UsageError("--execute needs PAYER_PRIVATE_KEY (0x + 64 hex) in the environment");
  const account = privateKeyToAccount(key as Hex);
  const transport = http(rpcUrl(chain, args.rpc));
  const publicClient = createPublicClient({ chain: chain.chain, transport });
  const wallet = createWalletClient({ account, chain: chain.chain, transport });

  const balance = await publicClient.readContract({ address: built.plan.asset.address, abi: erc20Abi, functionName: "balanceOf", args: [account.address] });
  if (balance < built.plan.total) {
    throw new UsageError(`payer ${account.address} holds ${balance} base units, the plan needs ${built.plan.total}`);
  }
  const encoded = encodeDistribution(built.plan, { via: "disperse", stealthDisperse });
  if (encoded.via !== "disperse") throw new Error("unreachable");
  io.stderr(`Sending from ${account.address}: 1 approval (exact total) + ${encoded.pays.length} pay tx(s)`);
  const result = await executeDistribution({
    encoded,
    wallet: { sendTransaction: (tx) => wallet.sendTransaction(tx) },
    publicClient,
    onSent: (s) => io.stderr(`  ${s.kind}${s.kind === "pay" ? ` ${s.index + 1}/${encoded.pays.length}` : ""}: ${s.hash}`),
  });
  io.stdout(args.json ? json(result) : `Sent. approve ${result.approveHash}; pay ${result.payHashes.join(", ")}`);
  return 0;
}

async function scan(args: ScanArgs, io: CliIo): Promise<number> {
  const chain = getChain(args.chainId);
  const phrase = io.env[args.mnemonicEnv];
  if (!phrase) throw new UsageError(`environment variable ${args.mnemonicEnv} is not set`);
  if (!validateMnemonic(phrase)) throw new UsageError(`${args.mnemonicEnv} does not hold a valid BIP-39 phrase`);
  const keys = keysFromMnemonic(phrase);

  const needsClient = args.balances || (!args.api && !io.announcementSource);
  const client = needsClient ? createPublicClient({ chain: chain.chain, transport: http(rpcUrl(chain, args.rpc)) }) : undefined;
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
