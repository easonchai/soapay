/**
 * Guardrails that sit in front of every value-moving tool:
 * - per-call and per-day USDC caps (the day counter persists in the state file);
 * - an optional payee allowlist of names;
 * - single-use plans that expire (dry-run → confirm).
 */
import { randomBytes } from "node:crypto";
import { normalize } from "viem/ens";
import type { McpConfig } from "./config.js";
import { update, type StateStore } from "./state.js";
import { formatUsdc, ToolError } from "./util.js";

export function utcDay(nowSeconds: number): string {
  return new Date(nowSeconds * 1000).toISOString().slice(0, 10);
}

export class Caps {
  constructor(
    private readonly config: Pick<McpConfig, "maxPerCallUsdc" | "maxPerDayUsdc">,
    private readonly state: StateStore,
  ) {}

  spentToday(now: number): bigint {
    const s = this.state.read().spend;
    return s.day === utcDay(now) ? BigInt(s.usdc) : 0n;
  }

  remainingToday(now: number): bigint {
    const left = this.config.maxPerDayUsdc - this.spentToday(now);
    return left > 0n ? left : 0n;
  }

  /** Throws `cap_per_call` / `cap_per_day` if `amount` doesn't fit. */
  check(amount: bigint, now: number, opts: { daily?: boolean } = {}): void {
    if (amount > this.config.maxPerCallUsdc) {
      throw new ToolError(
        "cap_per_call",
        `${formatUsdc(amount)} USDC is over the per-call cap of ${formatUsdc(this.config.maxPerCallUsdc)} USDC (MAX_PER_CALL_USDC)`,
      );
    }
    if (opts.daily !== false && amount > this.remainingToday(now)) {
      throw new ToolError(
        "cap_per_day",
        `${formatUsdc(amount)} USDC is over today's remaining ${formatUsdc(this.remainingToday(now))} USDC (MAX_PER_DAY_USDC)`,
      );
    }
  }

  /** Checks, then counts `amount` against today. Call right before broadcasting. */
  consume(amount: bigint, now: number): void {
    this.check(amount, now);
    const day = utcDay(now);
    update(this.state, (d) => {
      const prev = d.spend.day === day ? BigInt(d.spend.usdc) : 0n;
      d.spend = { day, usdc: (prev + amount).toString() };
    });
  }
}

export function normalizeName(name: string): string {
  try {
    const n = normalize(name.trim());
    if (!n.includes(".")) throw new Error();
    return n;
  } catch {
    throw new ToolError("invalid_name", `"${name}" is not a valid ENS name`);
  }
}

export function checkAllowlist(allowlist: readonly string[] | null, target: { name?: string; address?: string }): void {
  if (!allowlist) return;
  if (target.name && allowlist.includes(target.name)) return;
  throw new ToolError(
    "not_allowlisted",
    target.name
      ? `${target.name} is not in PAYEE_ALLOWLIST`
      : "PAYEE_ALLOWLIST is set, so only allowlisted names can receive funds (not raw addresses)",
  );
}

type Plan<T> = { id: string; kind: string; data: T; expiresAt: number };

/** Dry-run plans: in memory only, single-use, expiring. A restart invalidates every plan. */
export class PlanStore {
  private readonly plans = new Map<string, Plan<unknown>>();
  private readonly used = new Set<string>();
  constructor(private readonly ttlSeconds: number) {}

  create<T>(kind: string, data: T, now: number): { planId: string; expiresAt: string } {
    for (const [id, p] of this.plans) if (p.expiresAt <= now) this.plans.delete(id);
    const id = `${kind}_${randomBytes(12).toString("hex")}`;
    const expiresAt = now + this.ttlSeconds;
    this.plans.set(id, { id, kind, data, expiresAt });
    return { planId: id, expiresAt: new Date(expiresAt * 1000).toISOString() };
  }

  /** Returns the plan and burns it. Throws plan_unknown / plan_used / plan_expired / plan_kind. */
  take<T>(id: string, kind: string, now: number): T {
    if (this.used.has(id)) throw new ToolError("plan_used", "this plan was already confirmed; plans are single-use. Make a new dry run.");
    const p = this.plans.get(id);
    if (!p) throw new ToolError("plan_unknown", "no such plan (plans live in memory and expire after 10 minutes)");
    if (p.kind !== kind) throw new ToolError("plan_kind", `plan ${id} is a ${p.kind} plan, not ${kind}`);
    this.plans.delete(id);
    this.used.add(id);
    if (p.expiresAt <= now) throw new ToolError("plan_expired", "the plan expired; make a new dry run");
    return p.data as T;
  }
}
