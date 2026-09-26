// Argument parsing for `soapay distribute` and `soapay scan`. Pure: no I/O, no network.
import { parseArgs, type ParseArgsOptionsConfig } from "node:util";
import { getAddress, isAddress, type Address } from "viem";

export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UsageError";
  }
}

export const USAGE = `Usage:
  soapay distribute --csv <file> --asset <symbol|token> [--chain 84532] [--preset payroll|dividend|grant]
                    [--total <amount>] [--decimals <n>] [--chunk <amount>] [--max-lines <n>]
                    [--disperse <address>] [--rpc <url>] [--ens-rpc <url>] [--show-lines] [--json]
                    [--pins <file>] [--accept-change <name>]... [--api <url>] [--attester <address>]
                    [--dry-run | --execute [--allow-mainnet]]
  soapay scan --mnemonic-env <VAR> [--chain 84532] [--api <url> | --rpc <url>] [--from <block>] [--to <block>]
              [--known-payer <address>]... [--no-balances] [--json]

distribute
  CSV header: recipient,amount[,id]   (payroll, grant)   amounts in whole token units, e.g. 1250.50
              recipient,holdings[,id] (dividend)         holdings are any non-negative numbers
  recipient is a meta-address (st:eth:0x…), a 0x address registered in ERC-6538, or an ENS name.
  --preset dividend needs --total; for grant, --total is an optional budget.
  --chunk pays whole denominations of that size plus one remainder line per recipient.
  Names are resolved on the ENS chain (--ens-rpc) and cross-checked against ERC-6538 on the pay chain.
  Dry run by default: prints the plan (lines, chunks, gas). --execute prints a preflight (payer,
  balances, txs), then sends it via StealthDisperse from PAYER_PRIVATE_KEY (read from the environment,
  never from flags): one exact-total approval, then the pay txs, each with an explorer link.
  --execute refuses non-testnet chains unless --allow-mainnet is also given.
  Pins: the first time a name (or 0x registrant) resolves, its ERC-6538 meta-address is pinned in
  --pins (default: .soapay/pins.json next to the CSV). If it resolves to anything else later, the
  run stops with an alert (exit 3) and nothing is sent, unless the Soapay API (--api) holds a
  World ID rotation attestation for exactly that change, signed by the pinned --attester (or
  SOAPAY_ATTESTER; both default to the Soapay testnet deployment on 84532), or you pass
  --accept-change <name> after confirming the change with the recipient.

scan
  Reads the recovery phrase from the named environment variable and prints received payments,
  with real balances unless --no-balances. Payments from a --known-payer are not flagged unknown-payer.`;

export type Preset = "payroll" | "dividend" | "grant";

export type DistributeArgs = {
  command: "distribute";
  csv: string;
  asset: string;
  chainId: number;
  preset: Preset;
  total?: string;
  decimals?: number;
  chunk?: string;
  maxLines?: number;
  disperse?: Address;
  rpc?: string;
  ensRpc?: string;
  showLines: boolean;
  json: boolean;
  execute: boolean;
  allowMainnet: boolean;
  /** Pin file; default `.soapay/pins.json` next to the CSV. */
  pins?: string;
  /** Identifiers whose changed meta-address the payer explicitly accepts. */
  acceptChange?: string[];
  /** Soapay API for rotation attestations. */
  api?: string;
  /** Pinned MetaRotation attester. */
  attester?: Address;
};

export type ScanArgs = {
  command: "scan";
  mnemonicEnv: string;
  chainId: number;
  api?: string;
  rpc?: string;
  fromBlock?: bigint;
  toBlock?: bigint;
  balances: boolean;
  knownPayers?: Address[];
  json: boolean;
};

export type HelpArgs = { command: "help" };

export type CliArgs = DistributeArgs | ScanArgs | HelpArgs;

function positiveInt(v: string | undefined, flag: string): number | undefined {
  if (v === undefined) return undefined;
  if (!/^\d+$/.test(v) || Number(v) < 1 || !Number.isSafeInteger(Number(v))) throw new UsageError(`${flag} must be a positive integer`);
  return Number(v);
}

function block(v: string | undefined, flag: string): bigint | undefined {
  if (v === undefined) return undefined;
  if (!/^\d+$/.test(v)) throw new UsageError(`${flag} must be a block number`);
  return BigInt(v);
}

function decimalAmount(v: string | undefined, flag: string): string | undefined {
  if (v === undefined) return undefined;
  if (!/^\d+(\.\d+)?$/.test(v)) throw new UsageError(`${flag} must be a positive decimal number`);
  return v;
}

function url(v: string | undefined, flag: string): string | undefined {
  if (v === undefined) return undefined;
  if (!/^https?:\/\//.test(v)) throw new UsageError(`${flag} must be an http(s) URL`);
  return v;
}

function parse(argv: readonly string[], options: ParseArgsOptionsConfig) {
  try {
    return parseArgs({ args: [...argv], options, strict: true, allowPositionals: false });
  } catch (e) {
    throw new UsageError(e instanceof Error ? e.message : String(e));
  }
}

export function parseCli(argv: readonly string[]): CliArgs {
  const [command, ...rest] = argv;
  if (command === undefined || command === "help" || command === "--help" || command === "-h") return { command: "help" };

  if (command === "distribute") {
    const { values: v } = parse(rest, {
      csv: { type: "string" },
      asset: { type: "string" },
      chain: { type: "string", default: "84532" },
      preset: { type: "string", default: "payroll" },
      total: { type: "string" },
      decimals: { type: "string" },
      chunk: { type: "string" },
      "max-lines": { type: "string" },
      disperse: { type: "string" },
      rpc: { type: "string" },
      "ens-rpc": { type: "string" },
      "show-lines": { type: "boolean", default: false },
      json: { type: "boolean", default: false },
      "dry-run": { type: "boolean", default: false },
      execute: { type: "boolean", default: false },
      "allow-mainnet": { type: "boolean", default: false },
      pins: { type: "string" },
      "accept-change": { type: "string", multiple: true },
      api: { type: "string" },
      attester: { type: "string" },
    });
    const s = (k: string) => v[k] as string | undefined;
    const b = (k: string) => v[k] === true;
    if (!s("csv")) throw new UsageError("--csv is required");
    if (!s("asset")) throw new UsageError("--asset is required");
    if (b("execute") && b("dry-run")) throw new UsageError("--execute and --dry-run are mutually exclusive");
    if (b("allow-mainnet") && !b("execute")) throw new UsageError("--allow-mainnet only applies with --execute");
    const preset = s("preset");
    if (preset !== "payroll" && preset !== "dividend" && preset !== "grant") {
      throw new UsageError("--preset must be payroll, dividend or grant (vesting schedules: use the SDK's vesting preset)");
    }
    const total = decimalAmount(s("total"), "--total");
    if (preset === "dividend" && total === undefined) throw new UsageError("--preset dividend needs --total");
    if (preset === "payroll" && total !== undefined) throw new UsageError("--total applies to dividend and grant only");
    const disperse = s("disperse");
    if (disperse !== undefined && !isAddress(disperse, { strict: false })) throw new UsageError("--disperse must be an address");
    const decimals = s("decimals");
    if (decimals !== undefined && (!/^\d+$/.test(decimals) || Number(decimals) > 36)) throw new UsageError("--decimals must be 0..36");

    const out: DistributeArgs = {
      command: "distribute",
      csv: s("csv")!,
      asset: s("asset")!,
      chainId: positiveInt(s("chain"), "--chain")!,
      preset,
      showLines: b("show-lines"),
      json: b("json"),
      execute: b("execute"),
      allowMainnet: b("allow-mainnet"),
    };
    if (total !== undefined) out.total = total;
    if (decimals !== undefined) out.decimals = Number(decimals);
    const chunk = decimalAmount(s("chunk"), "--chunk");
    if (chunk !== undefined) out.chunk = chunk;
    const maxLines = positiveInt(s("max-lines"), "--max-lines");
    if (maxLines !== undefined) out.maxLines = maxLines;
    if (disperse !== undefined) out.disperse = getAddress(disperse);
    const rpc = url(s("rpc"), "--rpc");
    if (rpc !== undefined) out.rpc = rpc;
    const ensRpc = url(s("ens-rpc"), "--ens-rpc");
    if (ensRpc !== undefined) out.ensRpc = ensRpc;
    const pins = s("pins");
    if (pins !== undefined) {
      if (!pins.trim()) throw new UsageError("--pins needs a file path");
      out.pins = pins;
    }
    const accept = ((v["accept-change"] as string[] | undefined) ?? []).map((a) => a.trim());
    if (accept.some((a) => !a)) throw new UsageError("--accept-change needs a name");
    if (accept.length) out.acceptChange = accept;
    const api = url(s("api"), "--api");
    if (api !== undefined) out.api = api;
    const attester = s("attester");
    if (attester !== undefined) {
      if (!isAddress(attester, { strict: false })) throw new UsageError("--attester must be an address");
      out.attester = getAddress(attester);
    }
    return out;
  }

  if (command === "scan") {
    const { values: v } = parse(rest, {
      "mnemonic-env": { type: "string" },
      chain: { type: "string", default: "84532" },
      api: { type: "string" },
      rpc: { type: "string" },
      from: { type: "string" },
      to: { type: "string" },
      "no-balances": { type: "boolean", default: false },
      "known-payer": { type: "string", multiple: true },
      json: { type: "boolean", default: false },
    });
    const s = (k: string) => v[k] as string | undefined;
    const env = s("mnemonic-env");
    if (!env) throw new UsageError("--mnemonic-env is required (the name of the variable holding the phrase, not the phrase)");
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(env)) throw new UsageError("--mnemonic-env must be an environment variable name");
    const out: ScanArgs = {
      command: "scan",
      mnemonicEnv: env,
      chainId: positiveInt(s("chain"), "--chain")!,
      balances: v["no-balances"] !== true,
      json: v.json === true,
    };
    const api = url(s("api"), "--api");
    if (api !== undefined) out.api = api;
    const rpc = url(s("rpc"), "--rpc");
    if (rpc !== undefined) out.rpc = rpc;
    const from = block(s("from"), "--from");
    if (from !== undefined) out.fromBlock = from;
    const to = block(s("to"), "--to");
    if (to !== undefined) out.toBlock = to;
    if (from !== undefined && to !== undefined && to < from) throw new UsageError("--to must be >= --from");
    const known = (v["known-payer"] as string[] | undefined) ?? [];
    for (const k of known) if (!isAddress(k, { strict: false })) throw new UsageError(`--known-payer must be an address (got "${k}")`);
    if (known.length) out.knownPayers = known.map((k) => getAddress(k));
    return out;
  }

  throw new UsageError(`unknown command "${command}"`);
}
