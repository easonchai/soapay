// `soapay distribute`: CSV → resolved recipients → preset amounts → DistributionPlan → text/JSON.
import { formatUnits, parseUnits } from "viem";
import {
  applyPinDecision,
  assertDistributable,
  checkMetaPin,
  pinKey,
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
  type PinBook,
  type PinDecision,
  type Recipient,
  type RegisteredChain,
  type RotationAttestationLookup,
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
  /** Pin check result, when pins were checked. */
  pins?: PinSummary;
};

/** Pin inputs: the stored book, the attestation check, and the payer's explicit overrides. */
export type PinCheckDeps = {
  book: PinBook;
  lookup?: RotationAttestationLookup;
  /** Identifiers passed with --accept-change. */
  accept?: readonly string[];
  now: number;
};

export type PinSummary = {
  /** The book after this run (new pins, moved pins). */
  book: PinBook;
  /** True when `book` differs from the stored one and must be written. */
  changed: boolean;
  counts: { new: number; ok: number; rotated: number; accepted: number };
  changes: { identifier: string; decision: Extract<PinDecision, { state: "rotated" | "accepted" }>; to: string }[];
  /** --accept-change names that had nothing to accept. */
  unusedAccepts: string[];
};

/** A pinned meta-address changed without a valid attestation or an explicit --accept-change. */
export class PinChangedError extends Error {
  readonly blocked: { identifier: string; from: string; to: string; reason: string }[];
  constructor(blocked: PinChangedError["blocked"], pinFile?: string) {
    const lines = [
      `ALERT: the meta-address behind ${blocked.length === 1 ? "1 recipient" : `${blocked.length} recipients`} changed since it was pinned${pinFile ? ` (${pinFile})` : ""}. Nothing was sent.`,
    ];
    for (const b of blocked) {
      lines.push(`  ${b.identifier}`, `    pinned    ${b.from}`, `    now       ${b.to}`, `    World ID  ${b.reason}`);
    }
    lines.push(
      "This can be a salary redirect: whoever holds the name's registrant key can repoint it. Confirm the new",
      "keys with the recipient out of band, then re-run with " + blocked.map((b) => `--accept-change ${b.identifier}`).join(" ") + ".",
    );
    super(lines.join("\n"));
    this.name = "PinChangedError";
    this.blocked = blocked;
  }
}

/** Checks every resolved name against its pin; throws PinChangedError listing ALL blocked ones. */
export async function checkPins(
  resolved: readonly { identifier: string; metaAddressURI: string; registrant?: `0x${string}`; source: string }[],
  deps: PinCheckDeps,
  pinFile?: string,
): Promise<PinSummary> {
  const accept = new Set((deps.accept ?? []).map(pinKey));
  const used = new Set<string>();
  let book = deps.book;
  const counts = { new: 0, ok: 0, rotated: 0, accepted: 0 };
  const changes: PinSummary["changes"] = [];
  const blocked: PinChangedError["blocked"] = [];
  for (const r of resolved) {
    // A raw meta-address is the key itself; there is nothing behind it that could change.
    if (r.source === "meta-address") continue;
    const key = pinKey(r.identifier);
    const params: Parameters<typeof checkMetaPin>[0] = { identifier: r.identifier, pin: deps.book.pins[key], resolvedMeta: r.metaAddressURI, acceptChange: accept.has(key) };
    if (deps.lookup) params.lookup = deps.lookup;
    const decision = await checkMetaPin(params);
    if (decision.state === "blocked") {
      blocked.push({ identifier: r.identifier, from: decision.from, to: decision.to, reason: decision.attestation.reason });
      continue;
    }
    if (decision.state === "accepted") used.add(key);
    counts[decision.state]++;
    if (decision.state === "rotated" || decision.state === "accepted") changes.push({ identifier: r.identifier, decision, to: r.metaAddressURI });
    const res: { metaAddressURI: string; registrant?: `0x${string}`; source: string } = { metaAddressURI: r.metaAddressURI, source: r.source };
    if (r.registrant) res.registrant = r.registrant;
    book = applyPinDecision(book, { identifier: r.identifier, resolved: res, decision, now: deps.now });
  }
  if (blocked.length) throw new PinChangedError(blocked, pinFile);
  return { book, changed: book !== deps.book, counts, changes, unusedAccepts: [...accept].filter((a) => !used.has(a)) };
}

function units(value: string, decimals: number, what: string): bigint {
  if (!/^\d+(\.\d+)?$/.test(value)) throw new UsageError(`${what}: "${value}" is not a positive decimal number`);
  const frac = value.split(".")[1];
  if (frac !== undefined && frac.length > decimals) throw new UsageError(`${what}: "${value}" has more than ${decimals} decimals`);
  return parseUnits(value, decimals);
}

export async function buildDistribution(
  args: DistributeArgs,
  csvText: string,
  deps: { resolver: NameResolver; randomEphemeralKey?: () => Uint8Array; pins?: PinCheckDeps; pinFile?: string },
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
  const forPins: Parameters<typeof checkPins>[0][number][] = [];
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
    const p: (typeof forPins)[number] = { identifier: identifier.trim(), metaAddressURI: meta.metaAddressURI, source: meta.source };
    if (meta.registrant) p.registrant = meta.registrant;
    forPins.push(p);
  }
  // Pins before anything is planned: a changed name stops the whole run.
  const pins = deps.pins ? await checkPins(forPins, deps.pins, deps.pinFile) : undefined;

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
  const built: BuiltDistribution = { plan: planDistribution(params), chain, decimals, symbol, resolvedBy };
  if (pins) built.pins = pins;
  return built;
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

function describePins(p: PinSummary): string {
  const { counts: c } = p;
  const total = c.new + c.ok + c.rotated + c.accepted;
  const parts = [c.ok && `${c.ok} unchanged`, c.new && `${c.new} newly pinned`, c.rotated && `${c.rotated} re-verified by World ID`, c.accepted && `${c.accepted} accepted by --accept-change`].filter(Boolean);
  return `${total} ${total === 1 ? "name" : "names"} checked against pinned meta-addresses${parts.length ? ` (${parts.join(", ")})` : ""}`;
}

export function formatPlan(b: BuiltDistribution, opts: { showLines: boolean; execute: boolean; stealthDisperse?: string; pinFile?: string }): string {
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
  if (b.pins) out.push(`  pins        ${describePins(b.pins)}${opts.pinFile ? `, ${opts.pinFile}` : ""}`);
  for (const w of plan.warnings) out.push(`warning: ${w}`);
  for (const ch of b.pins?.changes ?? []) {
    out.push(
      ch.decision.state === "rotated"
        ? `note: ${ch.identifier} rotated its keys; re-verified by World ID on ${new Date(ch.decision.verifiedAt * 1000).toISOString()}, so the pin moved to the new meta-address.`
        : `warning: ${ch.identifier} changed its meta-address with no valid World ID attestation (${ch.decision.attestation.reason}); paying the new one because of --accept-change.`,
    );
  }
  for (const u of b.pins?.unusedAccepts ?? []) out.push(`warning: --accept-change ${u}: no changed meta-address to accept for that name in this run.`);
  if (opts.showLines) {
    out.push("", "  #    stealth address                              amount                recipient");
    plan.lines.forEach((l, i) => out.push(`  ${String(i).padEnd(4)} ${l.stealthAddress}  ${amt(l.amount).padEnd(20)}  ${l.recipientId}`));
  }
  if (!opts.execute) out.push("", "Nothing sent. Re-run with --execute and PAYER_PRIVATE_KEY set to send it.");
  return out.join("\n");
}

/** JSON view of a plan (bigints as decimal strings). Omits ephemeral keys, which are public anyway. */
export function planJson(b: BuiltDistribution, stealthDisperse?: string, pinFile?: string) {
  const { plan } = b;
  const pins = b.pins && {
    file: pinFile ?? null,
    ...b.pins.counts,
    changes: b.pins.changes.map((c) => ({ recipient: c.identifier, via: c.decision.state === "rotated" ? "world-id" : "accept-change", from: c.decision.from, to: c.to })),
    unusedAccepts: b.pins.unusedAccepts,
  };
  return {
    ...(pins ? { pins } : {}),
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
