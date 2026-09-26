/**
 * Generic private distributions (D-29): payroll, dividends, grants and vesting are all "a payer sends
 * an asset to N recipients, one fresh stealth address per line". `planDistribution` is a thin wrapper
 * over `derivePayRun` + `chunkLines` + `estimatePayRunGas`, so every sender invariant from payrun.ts
 * still holds: lines are derived first, sorted globally by stealth address, chunked into roughly equal
 * consecutive txs (never by recipient), no ephemeral key or stealth address repeats, and approvals are
 * for the exact total.
 *
 * Presets only compute per-recipient amounts. They are pure integer math over base units.
 *
 * Vocabulary: the **payer** funds and signs the distribution (employer, issuer, grant program); a
 * **recipient** is identified by a pinned ERC-6538 meta-address and receives one or more lines.
 */
import type { Address, Hash, Hex } from "viem";
import { MAX_LINES_PER_TX } from "./constants.js";
import { splitIntoDenominations } from "./denominations.js";
import {
  chunkLines,
  derivePayRun,
  encodeBatchCalls,
  encodeStealthDisperseCalls,
  estimatePayRunGas,
  type BatchCallsChunk,
  type PayRunEstimate,
  type PayRunLine,
  type PayRunRecipient,
  type StealthDisperseCalls,
} from "./payrun.js";
import { assertCompliant, assertDistributable, type Asset, type ComplianceHook, type Erc20Asset } from "./registry.js";

// ---------------------------------------------------------------------------------------------
// Vocabulary

/** Who funds a distribution. For StealthDisperse this is `msg.sender`, written into each announcement. */
export type Payer = { address: Address; label?: string };

/** One payee: a pinned meta-address and an amount in base units. Same shape as `PayRunRecipient`. */
export type Recipient = PayRunRecipient;

/** One on-chain payment line (one stealth address). Same shape as `PayRunLine`. */
export type DistributionLine = PayRunLine;

export type DistributionKind = "payroll" | "dividend" | "grant" | "vesting" | "custom";

/** What a preset returns: spread it into `planDistribution({ ...preset, asset })`. */
export type DistributionInput = {
  kind: DistributionKind;
  recipients: Recipient[];
  /** Human-readable notes (dropped zero allocations, small-set warnings, ...). */
  warnings: string[];
};

/** Splits one recipient's amount into line amounts (e.g. `denominated(chunk)`). */
export type SplitFn = (amount: bigint, recipient: Recipient) => readonly bigint[];

/** Below this many recipients, amounts alone may identify people (CLAUDE.md open issue). */
export const SMALL_DISTRIBUTION_THRESHOLD = 10;

// ---------------------------------------------------------------------------------------------
// Planning

export type PlanDistributionParams = {
  recipients: readonly Recipient[];
  asset: Asset;
  kind?: DistributionKind;
  payer?: Payer;
  /** Per-recipient line split; defaults to one line per recipient. */
  split?: SplitFn;
  maxLinesPerTx?: number;
  /** Carried through from presets and merged into the plan's warnings. */
  warnings?: readonly string[];
  /** Test hook only, passed to derivePayRun. */
  randomEphemeralKey?: () => Uint8Array;
};

export type DistributionPlan = {
  kind: DistributionKind;
  asset: Erc20Asset;
  payer?: Payer;
  recipientCount: number;
  /** All lines, ascending by stealth address. */
  lines: DistributionLine[];
  /** Consecutive chunks of `lines`, one per transaction. */
  chunks: DistributionLine[][];
  total: bigint;
  estimate: PayRunEstimate;
  maxLinesPerTx: number;
  warnings: string[];
};

/**
 * Derives, sorts, chunks and estimates a distribution. Throws UnsupportedAssetError for anything but
 * ERC-20 (see registry.ts `assetCapabilities`).
 */
export function planDistribution(params: PlanDistributionParams): DistributionPlan {
  const { asset } = params;
  assertDistributable(asset);
  const maxLinesPerTx = params.maxLinesPerTx ?? MAX_LINES_PER_TX;
  if (params.recipients.length === 0) throw new Error("Soapay: distribution has no recipients");

  const derive: Parameters<typeof derivePayRun>[0] = { recipients: params.recipients };
  if (params.split) derive.denominate = params.split;
  if (params.randomEphemeralKey) derive.randomEphemeralKey = params.randomEphemeralKey;
  const lines = derivePayRun(derive);
  const chunks = chunkLines(lines, maxLinesPerTx);
  const estimate = estimatePayRunGas(lines, maxLinesPerTx);

  const warnings = [...(params.warnings ?? [])];
  if (params.recipients.length < SMALL_DISTRIBUTION_THRESHOLD) {
    warnings.push(
      `Only ${params.recipients.length} recipient(s): with fewer than ${SMALL_DISTRIBUTION_THRESHOLD}, amounts alone may identify people.${params.split ? "" : " Consider denominations."}`,
    );
  }

  const plan: DistributionPlan = {
    kind: params.kind ?? "custom",
    asset,
    recipientCount: params.recipients.length,
    lines,
    chunks,
    total: estimate.totalAmount,
    estimate,
    maxLinesPerTx,
    warnings,
  };
  if (params.payer) plan.payer = params.payer;
  return plan;
}

/** A `split` that pays whole `chunkSize` denominations plus one remainder line (exact mode). */
export function denominated(chunkSize: bigint): SplitFn {
  return (amount) => splitIntoDenominations(amount, chunkSize, { mode: "exact" }).chunks;
}

export type EncodedDistribution =
  | ({ via: "disperse" } & StealthDisperseCalls)
  | { via: "batch"; batches: BatchCallsChunk[] };

/**
 * Encodes a plan for one of the two pay paths: `disperse` (EOAs, via StealthDisperse: one exact
 * approval, then one `pay` per chunk) or `batch` (smart accounts, EIP-5792, no custom contract).
 */
export function encodeDistribution(
  plan: DistributionPlan,
  path: { via: "disperse"; stealthDisperse: Address } | { via: "batch"; announcer?: Address },
): EncodedDistribution {
  const token = plan.asset.address;
  if (path.via === "disperse") {
    return {
      via: "disperse",
      ...encodeStealthDisperseCalls({ stealthDisperse: path.stealthDisperse, token, lines: plan.lines, maxLinesPerTx: plan.maxLinesPerTx }),
    };
  }
  const batch: Parameters<typeof encodeBatchCalls>[0] = { token, lines: plan.lines, maxLinesPerTx: plan.maxLinesPerTx };
  if (path.announcer) batch.announcer = path.announcer;
  return { via: "batch", batches: encodeBatchCalls(batch) };
}

/** Runs a compliance hook over every stealth address in the plan (see registry.ts `ComplianceHook`). */
export async function checkDistributionCompliance(plan: DistributionPlan, hook: ComplianceHook): Promise<void> {
  await assertCompliant(
    hook,
    plan.lines.map((l) => l.stealthAddress),
    plan.asset,
  );
}

/** Minimal wallet surface for sending (any viem WalletClient with an account and chain fits). */
export type DistributionWallet = { sendTransaction(tx: { to: Address; data: Hex }): Promise<Hash> };
/** Minimal public-client surface for receipts. */
export type DistributionReceipts = {
  waitForTransactionReceipt(args: { hash: Hash }): Promise<{ status: "success" | "reverted" }>;
};

export type ExecuteDistributionResult = { approveHash: Hash; payHashes: Hash[] };

/**
 * Sends the StealthDisperse path from an EOA: the exact-total approval, then each `pay` in order,
 * waiting for every receipt (so the next tx never races the allowance). Stops on the first revert.
 * The EIP-5792 batch path is wallet-specific (`sendCalls`), so apps send `batches` themselves.
 */
export async function executeDistribution(params: {
  encoded: Extract<EncodedDistribution, { via: "disperse" }>;
  wallet: DistributionWallet;
  publicClient: DistributionReceipts;
  onSent?: (step: { kind: "approve" | "pay"; index: number; hash: Hash }) => void;
}): Promise<ExecuteDistributionResult> {
  const { encoded, wallet, publicClient } = params;
  const send = async (kind: "approve" | "pay", index: number, tx: { to: Address; data: Hex }) => {
    const hash = await wallet.sendTransaction(tx);
    params.onSent?.({ kind, index, hash });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new Error(`Soapay: ${kind} tx ${hash} reverted`);
    return hash;
  };
  const approveHash = await send("approve", 0, encoded.approve);
  const payHashes: Hash[] = [];
  for (const [i, pay] of encoded.pays.entries()) payHashes.push(await send("pay", i, pay));
  return { approveHash, payHashes };
}

// ---------------------------------------------------------------------------------------------
// Presets

function assertPositive(amount: bigint, what: string): void {
  if (amount <= 0n) throw new Error(`Soapay: ${what}: amount must be > 0`);
}

function withId<T extends { id?: string }>(r: T, index: number): string {
  return r.id ?? String(index);
}

/** Fixed amounts per recipient (a salary run). Validates amounts; nothing else. */
export function payroll(entries: readonly Recipient[]): DistributionInput {
  entries.forEach((e, i) => assertPositive(e.amount, `recipient ${withId(e, i)}`));
  return { kind: "payroll", recipients: entries.map((e) => ({ ...e })), warnings: [] };
}

/**
 * Splits `total` pro rata by `holdings` with exact integer math. Every share is
 * `floor(total * h_i / H)`; the `total - sum(floors)` leftover units (fewer than the number of
 * holders) go one each to the largest fractional remainders, ties broken by input order (largest
 * remainder / Hamilton method). The result always sums to exactly `total`.
 */
export function proRata(holdings: readonly bigint[], total: bigint): bigint[] {
  if (total < 0n) throw new Error("Soapay: pro-rata total must be >= 0");
  let sum = 0n;
  for (const h of holdings) {
    if (h < 0n) throw new Error("Soapay: holdings must be >= 0");
    sum += h;
  }
  if (sum === 0n) throw new Error("Soapay: total holdings must be > 0");

  const shares = holdings.map((h) => (total * h) / sum);
  const remainders = holdings.map((h, i) => ({ i, r: (total * h) % sum }));
  let leftover = total - shares.reduce((s, x) => s + x, 0n);
  remainders.sort((a, b) => (a.r === b.r ? a.i - b.i : a.r > b.r ? -1 : 1));
  for (const { i } of remainders) {
    if (leftover === 0n) break;
    shares[i] = (shares[i] ?? 0n) + 1n;
    leftover--;
  }
  return shares;
}

export type Holder = { metaAddressURI: string; holdings: bigint; id?: string };

/**
 * Dividend: `total` split pro rata by holdings (see `proRata`). Holders whose share rounds to zero are
 * dropped (a line must be > 0) and listed in `warnings`; the rest still sums to exactly `total`.
 */
export function dividend(holders: readonly Holder[], total: bigint): DistributionInput & { allocations: bigint[] } {
  assertPositive(total, "dividend total");
  const allocations = proRata(
    holders.map((h) => h.holdings),
    total,
  );
  const recipients: Recipient[] = [];
  const dropped: string[] = [];
  holders.forEach((h, i) => {
    const amount = allocations[i] ?? 0n;
    const id = withId(h, i);
    if (amount === 0n) dropped.push(id);
    else recipients.push({ metaAddressURI: h.metaAddressURI, amount, id });
  });
  const warnings = dropped.length > 0 ? [`${dropped.length} holder(s) receive 0 and are skipped: ${dropped.join(", ")}`] : [];
  return { kind: "dividend", recipients, warnings, allocations };
}

/**
 * Grant round: fixed awards, optionally checked against a `budget` (throws if the awards exceed it;
 * warns about the unallocated rest).
 */
export function grant(awards: readonly Recipient[], opts: { budget?: bigint } = {}): DistributionInput {
  awards.forEach((a, i) => assertPositive(a.amount, `award ${withId(a, i)}`));
  const sum = awards.reduce((s, a) => s + a.amount, 0n);
  const warnings: string[] = [];
  if (opts.budget !== undefined) {
    if (sum > opts.budget) throw new Error(`Soapay: grant awards ${sum} exceed the budget ${opts.budget}`);
    if (sum < opts.budget) warnings.push(`${opts.budget - sum} of the budget is unallocated`);
  }
  return { kind: "grant", recipients: awards.map((a) => ({ ...a })), warnings };
}

/** Linear vesting with an optional cliff, released at whole `period` boundaries. Times in unix seconds. */
export type VestingSchedule = {
  total: bigint;
  start: number;
  /** Seconds after `start` before anything vests; whatever accrued by then vests at the cliff. */
  cliff?: number;
  /** Seconds from `start` until fully vested. */
  duration: number;
  /** Release granularity in seconds (e.g. 30 days). The last release is at `start + duration`. */
  period: number;
};

function checkSchedule(s: VestingSchedule): void {
  if (s.total < 0n) throw new Error("Soapay: vesting total must be >= 0");
  for (const [k, v] of [["start", s.start], ["duration", s.duration], ["period", s.period], ["cliff", s.cliff ?? 0]] as const) {
    if (!Number.isSafeInteger(v) || v < 0) throw new Error(`Soapay: vesting ${k} must be a non-negative integer`);
  }
  if (s.duration <= 0 || s.period <= 0) throw new Error("Soapay: vesting duration and period must be > 0");
  if ((s.cliff ?? 0) > s.duration) throw new Error("Soapay: vesting cliff exceeds the duration");
}

/** Cumulative amount vested at time `at` (floor, so it never over-releases; exactly `total` at the end). */
export function vestedAmount(s: VestingSchedule, at: number): bigint {
  checkSchedule(s);
  const elapsed = at - s.start;
  if (elapsed < (s.cliff ?? 0) || elapsed <= 0) return 0n;
  if (elapsed >= s.duration) return s.total;
  const periods = Math.floor(elapsed / s.period);
  const counted = BigInt(periods * s.period);
  return (s.total * counted) / BigInt(s.duration);
}

export type VestingRelease = { index: number; at: number; amount: bigint };

/** Every non-zero release of the schedule, in order. The amounts sum to exactly `total`. */
export function vestingSchedule(s: VestingSchedule): VestingRelease[] {
  checkSchedule(s);
  const out: VestingRelease[] = [];
  const steps = Math.ceil(s.duration / s.period);
  let prev = 0n;
  for (let k = 1; k <= steps; k++) {
    const at = s.start + Math.min(k * s.period, s.duration);
    const cum = vestedAmount(s, at);
    if (cum > prev) out.push({ index: out.length, at, amount: cum - prev });
    prev = cum;
  }
  return out;
}

export type Grantee = { metaAddressURI: string; schedule: VestingSchedule; id?: string; /** Already paid out. */ released?: bigint };

/**
 * The vesting tranche due at `at`: each grantee receives `vestedAmount(schedule, at) - released`.
 * Grantees with nothing new are skipped. Run it per period and record what was released.
 */
export function vesting(grantees: readonly Grantee[], at: number): DistributionInput {
  const recipients: Recipient[] = [];
  let idle = 0;
  grantees.forEach((g, i) => {
    const released = g.released ?? 0n;
    const vested = vestedAmount(g.schedule, at);
    if (released > vested) throw new Error(`Soapay: grantee ${withId(g, i)} released more than has vested`);
    const due = vested - released;
    if (due > 0n) recipients.push({ metaAddressURI: g.metaAddressURI, amount: due, id: withId(g, i) });
    else idle++;
  });
  const warnings = idle > 0 ? [`${idle} grantee(s) have nothing newly vested`] : [];
  return { kind: "vesting", recipients, warnings };
}

/** All presets under one name, for callers that pick by string (e.g. the CLI's `--preset`). */
export const presets = { payroll, dividend, grant, vesting } as const;
