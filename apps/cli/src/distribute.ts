// `soapay distribute`: CSV → resolved recipients → preset amounts → DistributionPlan → text/JSON.
import { formatUnits, parseUnits } from "viem";
import {
  assertDistributable,
  denominated,
  dividend,
  getChain,
  grant,
  payroll,
  planDistribution,
  resolveAsset,
  type DistributionInput,
  type DistributionPlan,
  type NameResolver,
  type Recipient,
  type RegisteredChain,
} from "@soapay/sdk";
import { UsageError, type DistributeArgs } from "./args.js";
import { parseCsv } from "./csv.js";

/** Holdings are only used as proportions; scale decimals so "12.5" and "3" compare correctly. */
const HOLDINGS_DECIMALS = 18;

export type BuiltDistribution = {
  plan: DistributionPlan;
  chain: RegisteredChain;
  decimals: number;
  symbol: string;
  /** How recipients were resolved: resolver kind → count (e.g. { ens: 3, "meta-address": 1 }). */
  resolvedBy: Record<string, number>;
};

function units(value: string, decimals: number, what: string): bigint {
  if (!/^\d+(\.\d+)?$/.test(value)) throw new UsageError(`${what}: "${value}" is not a positive decimal number`);
  const frac = value.split(".")[1];
  if (frac !== undefined && frac.length > decimals) throw new UsageError(`${what}: "${value}" has more than ${decimals} decimals`);
  return parseUnits(value, decimals);
}

export async function buildDistribution(
  args: DistributeArgs,
  csvText: string,
  deps: { resolver: NameResolver; randomEphemeralKey?: () => Uint8Array },
): Promise<BuiltDistribution> {
  const chain = getChain(args.chainId);
  const asset = resolveAsset(args.chainId, args.asset);
  assertDistributable(asset);
  const decimals = args.decimals ?? asset.decimals;
  if (decimals === undefined) throw new UsageError(`unknown decimals for ${asset.address}; pass --decimals`);
  const symbol = asset.symbol ?? "tokens";

  const valueColumn = args.preset === "dividend" ? "holdings" : "amount";
  const rows = parseCsv(csvText, ["recipient", valueColumn]);

  const resolved: { metaAddressURI: string; value: string; id: string }[] = [];
  const seen = new Map<string, number>();
  const resolvedBy: Record<string, number> = {};
  for (const row of rows) {
    const identifier = row.values.recipient ?? "";
    if (!identifier) throw new UsageError(`CSV line ${row.line}: empty recipient`);
    const meta = await deps.resolver.resolve(identifier).catch((e: unknown) => {
      throw new UsageError(`CSV line ${row.line}: ${e instanceof Error ? e.message : String(e)}`);
    });
    const prev = seen.get(meta.metaAddressURI);
    if (prev !== undefined) throw new UsageError(`CSV line ${row.line}: same recipient as line ${prev}; merge the rows`);
    seen.set(meta.metaAddressURI, row.line);
    resolvedBy[meta.source] = (resolvedBy[meta.source] ?? 0) + 1;
    resolved.push({ metaAddressURI: meta.metaAddressURI, value: row.values[valueColumn] ?? "", id: row.values.id || identifier });
  }

  let input: DistributionInput;
  if (args.preset === "dividend") {
    const holders = resolved.map((r) => ({ metaAddressURI: r.metaAddressURI, id: r.id, holdings: units(r.value, HOLDINGS_DECIMALS, `holdings of ${r.id}`) }));
    input = dividend(holders, units(args.total!, decimals, "--total"));
  } else {
    const recipients: Recipient[] = resolved.map((r) => ({ metaAddressURI: r.metaAddressURI, id: r.id, amount: units(r.value, decimals, `amount of ${r.id}`) }));
    input = args.preset === "grant" ? grant(recipients, args.total !== undefined ? { budget: units(args.total, decimals, "--total") } : {}) : payroll(recipients);
  }

  const params: Parameters<typeof planDistribution>[0] = { ...input, asset };
  if (args.chunk !== undefined) params.split = denominated(units(args.chunk, decimals, "--chunk"));
  if (args.maxLines !== undefined) params.maxLinesPerTx = args.maxLines;
  if (deps.randomEphemeralKey) params.randomEphemeralKey = deps.randomEphemeralKey;
  return { plan: planDistribution(params), chain, decimals, symbol, resolvedBy };
}

const RESOLUTION_LABELS: Record<string, [string, string]> = {
  ens: ["name checked against ERC-6538", "names checked against ERC-6538"],
  "meta-address": ["meta-address", "meta-addresses"],
  erc6538: ["ERC-6538 registrant", "ERC-6538 registrants"],
};

function describeResolution(by: Record<string, number>): string {
  const parts = Object.entries(by).map(([k, n]) => {
    const [one, many] = RESOLUTION_LABELS[k] ?? [k, k];
    return `${n} ${n === 1 ? one : many}`;
  });
  return parts.length ? ` (${parts.join(", ")})` : "";
}

export function formatPlan(b: BuiltDistribution, opts: { showLines: boolean; execute: boolean; stealthDisperse?: string }): string {
  const { plan, chain, decimals, symbol } = b;
  const amt = (v: bigint) => `${formatUnits(v, decimals)} ${symbol}`;
  const out: string[] = [];
  out.push(`Soapay ${plan.kind} plan${opts.execute ? "" : " (dry run)"}`);
  out.push(`  chain       ${chain.chain.name} (${chain.id})`);
  out.push(`  asset       ${symbol} ${plan.asset.address} (${decimals} decimals)`);
  out.push(`  recipients  ${plan.recipientCount}${describeResolution(b.resolvedBy)}`);
  out.push(`  lines       ${plan.lines.length}`);
  out.push(`  total       ${amt(plan.total)}`);
  out.push(`  txs         ${plan.chunks.length} (lines per tx: ${plan.chunks.map((c) => c.length).join(", ")}; max ${plan.maxLinesPerTx})`);
  out.push(`  gas         ${plan.estimate.totalGas} total, planning estimate (${plan.estimate.perTx.map((t) => t.gas).join(", ")} per tx)`);
  out.push(`  pay path    ${opts.stealthDisperse ? `StealthDisperse ${opts.stealthDisperse}` : "none on this chain (pass --disperse, or use the SDK's EIP-5792 batch path)"}`);
  for (const w of plan.warnings) out.push(`warning: ${w}`);
  if (opts.showLines) {
    out.push("", "  #    stealth address                              amount                recipient");
    plan.lines.forEach((l, i) => out.push(`  ${String(i).padEnd(4)} ${l.stealthAddress}  ${amt(l.amount).padEnd(20)}  ${l.recipientId}`));
  }
  if (!opts.execute) out.push("", "Nothing sent. Re-run with --execute and PAYER_PRIVATE_KEY set to send it.");
  return out.join("\n");
}

/** JSON view of a plan (bigints as decimal strings). Omits ephemeral keys, which are public anyway. */
export function planJson(b: BuiltDistribution, stealthDisperse?: string) {
  const { plan } = b;
  return {
    kind: plan.kind,
    chainId: b.chain.id,
    asset: { address: plan.asset.address, symbol: b.symbol, decimals: b.decimals },
    stealthDisperse: stealthDisperse ?? null,
    recipients: plan.recipientCount,
    total: plan.total.toString(),
    maxLinesPerTx: plan.maxLinesPerTx,
    txs: plan.estimate.perTx.map((t) => ({ lines: t.lines, amount: t.amount.toString(), gas: t.gas.toString() })),
    totalGas: plan.estimate.totalGas.toString(),
    warnings: plan.warnings,
    resolvedBy: b.resolvedBy,
    lines: plan.lines.map((l) => ({ stealthAddress: l.stealthAddress, amount: l.amount.toString(), recipientId: l.recipientId })),
  };
}
