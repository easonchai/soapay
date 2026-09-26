// Pay-run planning and the persisted run record.
//
// Invariants (CLAUDE.md "Sender-app invariants"), all delegated to the SDK and
// re-asserted here:
// - derive EVERY line of the run first, sort globally by stealth address, then cut
//   into near-equal chunks of ≤350 lines (`chunkLines`), never by employee;
// - fresh ephemeral key and stealth address per line (`derivePayRun`);
// - a retry RE-DERIVES the unpaid lines: stored stealth addresses are records for the
//   employer, never inputs to a payment.
// Ephemeral private keys never leave derivePayRun; records keep only
// {employee, amount, stealth address} per line.
import type { Address, Hash } from "viem";
import {
  chunkLines,
  derivePayRun,
  estimatePayRunGas,
  MAX_LINES_PER_TX,
  planDenominatedRun,
  smallTeamWarning,
  type DenominatedRunStats,
  type PayRunEstimate,
  type PayRunLine,
} from "@soapay/sdk";
import { tryParseUsdc } from "./amount.js";

export type Denomination = { chunkSize: bigint; mode: "exact" | "carry" };

/**
 * The pay run's denomination (D-31): ON by default, with the ONE company-wide chunk size from
 * Settings applied to every employee, in exact mode (whole chunks plus one smaller final line; never
 * carried over, so every run pays the exact wage). `on = false` is the per-run opt-out: one line per
 * employee. Throws on a bad chunk size.
 */
export function companyDenomination(on: boolean, chunk: string): Denomination | null {
  if (!on) return null;
  const c = tryParseUsdc(chunk);
  if (!c.ok || c.value <= 0n) throw new Error("The company chunk size (Settings) must be a positive USDC amount");
  return { chunkSize: c.value, mode: "exact" };
}

export type PlanRecipient = {
  employeeId: string;
  name: string;
  /** The PINNED meta-address (never a freshly resolved, unapproved one). */
  metaAddressURI: string;
  amount: bigint;
  /** Carry-mode balance brought into this run. */
  carryIn?: bigint;
};

export type RunPlan = {
  lines: PayRunLine[];
  chunks: PayRunLine[][];
  estimate: PayRunEstimate;
  total: bigint;
  names: Map<string, string>;
  /** Per employee: total and line count in this run. */
  perEmployee: Map<string, { amount: bigint; lines: number }>;
  denomination: Denomination | null;
  denomStats: DenominatedRunStats | null;
  /** Carry mode: balance to record once the run fully lands. */
  carryOut: Map<string, bigint>;
  smallTeam: string | null;
};

export type PlanOptions = { maxLinesPerTx?: number; randomEphemeralKey?: () => Uint8Array };

function finishPlan(
  lines: PayRunLine[],
  names: Map<string, string>,
  employeeCount: number,
  denomination: Denomination | null,
  denomStats: DenominatedRunStats | null,
  carryOut: Map<string, bigint>,
  max: number,
): RunPlan {
  const chunks = chunkLines(lines, max);
  const perEmployee = new Map<string, { amount: bigint; lines: number }>();
  for (const l of lines) {
    const p = perEmployee.get(l.recipientId) ?? { amount: 0n, lines: 0 };
    perEmployee.set(l.recipientId, { amount: p.amount + l.amount, lines: p.lines + 1 });
  }
  const estimate = estimatePayRunGas(lines, max);
  return {
    lines,
    chunks,
    estimate,
    total: estimate.totalAmount,
    names,
    perEmployee,
    denomination,
    denomStats,
    carryOut,
    smallTeam: smallTeamWarning(employeeCount),
  };
}

export function planRun(recipients: readonly PlanRecipient[], denomination: Denomination | null, opts: PlanOptions = {}): RunPlan {
  const max = opts.maxLinesPerTx ?? MAX_LINES_PER_TX;
  const payable = recipients.filter((r) => r.amount > 0n || (denomination?.mode === "carry" && (r.carryIn ?? 0n) !== 0n));
  if (payable.length === 0) throw new Error("Nobody to pay in this run");
  const names = new Map(payable.map((r) => [r.employeeId, r.name]));
  const meta = new Map(payable.map((r) => [r.employeeId, r.metaAddressURI]));

  let derivationInput: { metaAddressURI: string; amount: bigint; id: string }[];
  let denomStats: DenominatedRunStats | null = null;
  const carryOut = new Map<string, bigint>();

  if (denomination) {
    const d = planDenominatedRun(
      payable.map((r) => ({ id: r.employeeId, amount: r.amount, carryIn: r.carryIn ?? 0n })),
      denomination.chunkSize,
      { mode: denomination.mode },
      max,
    );
    denomStats = d.stats;
    if (denomination.mode === "carry") for (const r of d.recipients) carryOut.set(r.id, r.carryOut);
    derivationInput = d.lines.map((l) => ({ id: l.id, amount: l.amount, metaAddressURI: meta.get(l.id)! }));
  } else {
    derivationInput = payable.map((r) => ({ id: r.employeeId, amount: r.amount, metaAddressURI: r.metaAddressURI }));
  }
  if (derivationInput.length === 0) throw new Error("Nobody to pay in this run");

  const lines = derivePayRun({
    recipients: derivationInput,
    ...(opts.randomEphemeralKey ? { randomEphemeralKey: opts.randomEphemeralKey } : {}),
  });
  return finishPlan(lines, names, payable.length, denomination, denomStats, carryOut, max);
}

// ---------------------------------------------------------------------------
// Persisted records

export type LineRecord = { employeeId: string; name: string; amount: bigint; stealthAddress: Address };

export type StepStatus = "pending" | "signing" | "confirming" | "landed" | "failed" | "unknown";

export type ChunkRecord = {
  index: number;
  lines: LineRecord[];
  amount: bigint;
  status: StepStatus;
  txHash?: Hash;
  /** EIP-5792 batch id. */
  callsId?: string;
  error?: string;
};

export type ApproveRecord = {
  amount: bigint;
  status: StepStatus | "skipped";
  txHash?: Hash;
  error?: string;
};

export type Attempt = {
  index: number;
  startedAt: number;
  approve?: ApproveRecord;
  chunks: ChunkRecord[];
};

export type RunPath = "batch" | "disperse" | "safe-export";

export type RunRecord = {
  id: string;
  createdAt: number;
  /** Optional employer-chosen title (CK's editable run title), e.g. "September payroll". */
  label?: string;
  chainId: number;
  path: RunPath;
  token: Address;
  payer?: Address;
  stealthDisperse?: Address;
  safeAddress?: Address;
  denomination: Denomination | null;
  /** Carry mode: per-employee balance after this run, committed when it fully lands. */
  carryOut: Record<string, bigint>;
  carryCommitted: boolean;
  /** Employees left out of the run and why (blocked pin change, resolve error, paused). */
  excluded: { employeeId: string; name: string; reason: string }[];
  attempts: Attempt[];
};

export function attemptFromPlan(plan: RunPlan, index: number, startedAt: number): Attempt {
  return {
    index,
    startedAt,
    chunks: plan.chunks.map((c, i) => ({
      index: i,
      amount: c.reduce((s, l) => s + l.amount, 0n),
      status: "pending",
      lines: c.map((l) => ({
        employeeId: l.recipientId,
        name: plan.names.get(l.recipientId) ?? l.recipientId,
        amount: l.amount,
        stealthAddress: l.stealthAddress,
      })),
    })),
  };
}

export function latestAttempt(run: RunRecord): Attempt {
  const a = run.attempts[run.attempts.length - 1];
  if (!a) throw new Error("Run has no attempts");
  return a;
}

export type RunStatus = "exported" | "in-progress" | "complete" | "needs-check" | "partial" | "failed";

const IN_FLIGHT: readonly StepStatus[] = ["signing", "confirming"];

export function runStatus(run: RunRecord): RunStatus {
  if (run.path === "safe-export") return "exported";
  const a = latestAttempt(run);
  const steps = [...a.chunks.map((c) => c.status), ...(a.approve && a.approve.status !== "skipped" ? [a.approve.status] : [])];
  if (steps.some((s) => IN_FLIGHT.includes(s))) return "in-progress";
  if (steps.some((s) => s === "unknown")) return "needs-check";
  if (a.chunks.every((c) => c.status === "landed")) return "complete";
  const anyLanded = run.attempts.some((x) => x.chunks.some((c) => c.status === "landed"));
  if (a.chunks.every((c) => c.status === "pending") && !a.chunks.some((c) => c.error) && !a.approve?.error) {
    return anyLanded ? "partial" : "in-progress";
  }
  return anyLanded ? "partial" : "failed";
}

export type Obligation = { employeeId: string; name: string; amount: bigint };

/** Lines of the latest attempt that definitively did not land (failed or never sent). */
export function remainingObligations(run: RunRecord): Obligation[] {
  const a = latestAttempt(run);
  return a.chunks
    .filter((c) => c.status === "failed" || c.status === "pending")
    .flatMap((c) => c.lines.map((l) => ({ employeeId: l.employeeId, name: l.name, amount: l.amount })));
}

export type RetryBlock = { ok: true } | { ok: false; reason: string };

/** A retry is only safe when nothing is in flight or unresolved; otherwise it could double-pay. */
export function canRetry(run: RunRecord): RetryBlock {
  if (run.path === "safe-export") return { ok: false, reason: "Safe exports are executed in Safe{Wallet}" };
  const status = runStatus(run);
  if (status === "in-progress") return { ok: false, reason: "Transactions are still in flight" };
  if (status === "needs-check") {
    return { ok: false, reason: "Some transactions have an unknown outcome. Check them before retrying." };
  }
  if (remainingObligations(run).length === 0) return { ok: false, reason: "Everything in this run landed" };
  return { ok: true };
}

/**
 * Re-derives the unpaid lines with FRESH ephemeral keys and stealth addresses, sorts
 * them globally and re-chunks. Amounts are kept line for line (no re-denomination),
 * and each line pays the employee's CURRENT pin, which the caller re-verified.
 */
export function planRetry(
  obligations: readonly Obligation[],
  pinnedMeta: ReadonlyMap<string, string>,
  opts: PlanOptions = {},
): RunPlan {
  const max = opts.maxLinesPerTx ?? MAX_LINES_PER_TX;
  if (obligations.length === 0) throw new Error("Nothing left to pay");
  const names = new Map(obligations.map((o) => [o.employeeId, o.name]));
  const lines = derivePayRun({
    recipients: obligations.map((o) => {
      const meta = pinnedMeta.get(o.employeeId);
      if (!meta) throw new Error(`${o.name} is not payable right now`);
      return { id: o.employeeId, amount: o.amount, metaAddressURI: meta };
    }),
    ...(opts.randomEphemeralKey ? { randomEphemeralKey: opts.randomEphemeralKey } : {}),
  });
  return finishPlan(lines, names, names.size, null, null, new Map(), max);
}

export type ReportRow = {
  employeeId: string;
  name: string;
  paid: bigint;
  outstanding: bigint;
  lines: (LineRecord & { txHash?: Hash; status: StepStatus })[];
};

/** Names → amounts for the employer, across every attempt. */
export function runReport(run: RunRecord): ReportRow[] {
  const rows = new Map<string, ReportRow>();
  const row = (id: string, name: string) => {
    let r = rows.get(id);
    if (!r) rows.set(id, (r = { employeeId: id, name, paid: 0n, outstanding: 0n, lines: [] }));
    return r;
  };
  run.attempts.forEach((a, ai) => {
    const latest = ai === run.attempts.length - 1;
    for (const c of a.chunks) {
      for (const l of c.lines) {
        const r = row(l.employeeId, l.name);
        if (c.status === "landed") {
          r.paid += l.amount;
          r.lines.push({ ...l, status: c.status, ...(c.txHash ? { txHash: c.txHash } : {}) });
        } else if (latest || run.path === "safe-export") {
          if (run.path !== "safe-export") r.outstanding += l.amount;
          r.lines.push({ ...l, status: c.status, ...(c.txHash ? { txHash: c.txHash } : {}) });
        }
      }
    }
  });
  return [...rows.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function runTotals(run: RunRecord): { planned: bigint; paid: bigint; outstanding: bigint } {
  const rows = runReport(run);
  const paid = rows.reduce((s, r) => s + r.paid, 0n);
  const outstanding = rows.reduce((s, r) => s + r.outstanding, 0n);
  const planned = run.attempts[0]?.chunks.reduce((s, c) => s + c.amount, 0n) ?? 0n;
  return { planned, paid, outstanding };
}

/** Max run label length; longer input is cut. */
export const MAX_RUN_LABEL = 80;

/** Trimmed, length-capped label, or undefined when blank (then the run is not labelled). */
export function normalizeRunLabel(input: string | undefined): string | undefined {
  const t = (input ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_RUN_LABEL);
  return t ? t : undefined;
}

/** Display title: the label when set, else the fallback (pay path and date). */
export function runTitle(run: Pick<RunRecord, "label">, fallback: string): string {
  return run.label ?? fallback;
}
