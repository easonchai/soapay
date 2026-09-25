/**
 * `spend`: send received USDC out of the agent's stealth addresses.
 *
 * Sources come from the guard's `suggestSources` (fewest cluster merges), fees are quoted per
 * address through the bundler + USDC paymaster, and the consolidation guard's `planSpend`
 * decides: `block` is final (the agent has no override), `warn` is shown in the plan. Every
 * spend needs a dry run and a confirm. One userOp per source address, never combined.
 *
 * To an address: `spendMany` (each source sends its part to that address).
 * To a name: each source part goes to its OWN fresh stealth address of the recipient, with an
 * ERC-5564 announcement in the same userOp, so the recipient finds it and no two parts share
 * a destination.
 */
import { encodeFunctionData, getAddress, isAddress, type Address, type Hex } from "viem";
import {
  SCHEME_ID,
  ANNOUNCER_ADDRESS,
  SpendManyError,
  announcerAbi,
  applySpend,
  buildMetadata57,
  buildTransferCall,
  derivePayRun,
  planSpend,
  suggestSources,
  type AnnouncementRecord,
  type ClusterGraph,
  type GuardWarning,
  type SpendPlan,
} from "@soapay/sdk";
import type { Ctx } from "../context.js";
import { checkAllowlist } from "../guardrails.js";
import { loadGraph, update } from "../state.js";
import { errorMessage, formatUsdc, parseUsdc, ToolError } from "../util.js";
import { resolvePinned } from "./identity.js";
import { collect, stealthKeyFor } from "./receive.js";

export type SpendInput = { to?: string | undefined; amount?: string | number | undefined; dry_run?: boolean | undefined; confirm?: string | undefined };

type Part = {
  source: Address;
  amount: bigint;
  fee: bigint;
  announcement: AnnouncementRecord;
  /** Name spends only: the recipient's fresh stealth address for this part. */
  dest?: { stealthAddress: Address; ephemeralPublicKey: Hex; viewTag: number };
};

type SpendPlanData = { mode: "address" | "name"; to: Address | null; name: string | null; amount: bigint; parts: Part[] };

const RANK = { allow: 0, warn: 1, block: 2 } as const;

/** Splits `amount` across sources in order; each source pays its own fee from its own balance. */
function allocate(sources: { address: Address; fee: bigint; maxSendable: bigint }[], amount: bigint) {
  const parts: { address: Address; amount: bigint; fee: bigint }[] = [];
  let remaining = amount;
  for (const s of sources) {
    if (remaining === 0n || s.maxSendable <= 0n) continue;
    const take = s.maxSendable < remaining ? s.maxSendable : remaining;
    parts.push({ address: s.address, amount: take, fee: s.fee });
    remaining -= take;
  }
  return { parts, sufficient: remaining === 0n };
}

function guardPlans(graph: ClusterGraph, plan: SpendPlanData): SpendPlan[] {
  if (plan.mode === "address") return [planSpend(graph, { from: plan.parts.map((p) => p.source), to: plan.to! })];
  return plan.parts.map((p) => planSpend(graph, { from: [p.source], to: p.dest!.stealthAddress }));
}

function summarize(plans: SpendPlan[]) {
  const decision = plans.reduce<SpendPlan["decision"]>((d, p) => (RANK[p.decision] > RANK[d] ? p.decision : d), "allow");
  const seen = new Set<string>();
  const warnings: GuardWarning[] = [];
  for (const w of plans.flatMap((p) => p.warnings)) {
    if (!seen.has(w.code + w.message)) warnings.push(w), seen.add(w.code + w.message);
  }
  const reason = plans.find((p) => p.decision === decision)?.reason ?? "";
  return { decision, reason, warnings };
}

export async function spend(ctx: Ctx, input: SpendInput) {
  if (input.confirm) return confirmSpend(ctx, input.confirm);
  if (!input.to || input.amount === undefined) throw new ToolError("invalid_input", "give `to` and `amount` for a dry run, or `confirm: <planId>`");
  const now = ctx.now();
  const amount = parseUsdc(input.amount);
  ctx.caps.check(amount, now);

  let mode: SpendPlanData["mode"];
  let to: Address | null = null;
  let name: string | null = null;
  let meta: string | null = null;
  if (isAddress(input.to, { strict: false })) {
    checkAllowlist(ctx.config.payeeAllowlist, { address: input.to });
    mode = "address";
    to = getAddress(input.to);
  } else {
    const r = await resolvePinned(ctx, input.to);
    mode = "name";
    name = r.name;
    meta = r.metaAddressURI;
  }

  const { holdings, graph } = await collect(ctx);
  const byAddr = new Map(holdings.map((h) => [h.stealthAddress.toLowerCase(), h]));
  const balances = Object.fromEntries(holdings.map((h) => [h.stealthAddress, h.balance]));
  const available = holdings.reduce((s, h) => s + h.balance, 0n);
  if (available < amount) throw new ToolError("insufficient_funds", `received balance is ${formatUsdc(available)} USDC, short of ${formatUsdc(amount)}`);

  // Fee quotes need the destination; for a name any address stands in (same calls, same cost class).
  const quoteTo = to ?? ctx.payer ?? ("0x000000000000000000000000000000000000dEaD" as Address);
  const quotes = new Map<string, { address: Address; fee: bigint; maxSendable: bigint }>();
  let target = amount;
  let alloc: ReturnType<typeof allocate> | undefined;
  for (let round = 0; round < 3; round++) {
    const sug = suggestSources(graph, balances, target);
    if (!sug.sufficient) break;
    for (const a of sug.from) {
      if (quotes.has(a.toLowerCase())) continue;
      const h = byAddr.get(a.toLowerCase())!;
      try {
        const q = await ctx.chain.quoteSpend(stealthKeyFor(ctx, h.announcement), quoteTo);
        quotes.set(a.toLowerCase(), { address: a, fee: q.fee, maxSendable: q.maxSendable });
      } catch (e) {
        throw new ToolError("quote_failed", `fee quote failed for ${a}: ${errorMessage(e)}`);
      }
    }
    alloc = allocate(sug.from.map((a) => quotes.get(a.toLowerCase())!), amount);
    if (alloc.sufficient) break;
    target = amount + sug.from.reduce((s, a) => s + quotes.get(a.toLowerCase())!.fee, 0n);
  }
  if (!alloc?.sufficient) throw new ToolError("insufficient_funds", `not enough received USDC to send ${formatUsdc(amount)} plus fees`);

  const parts: Part[] = alloc.parts.map((p) => ({ source: p.address, amount: p.amount, fee: p.fee, announcement: byAddr.get(p.address.toLowerCase())!.announcement }));
  if (mode === "name") {
    const lines = derivePayRun({ recipients: parts.map((p, i) => ({ id: String(i), metaAddressURI: meta!, amount: p.amount })) });
    for (const l of lines) {
      parts[Number(l.recipientId)]!.dest = { stealthAddress: l.stealthAddress, ephemeralPublicKey: l.ephemeralPublicKey, viewTag: l.viewTag };
    }
  }
  const data: SpendPlanData = { mode, to, name, amount, parts };
  const g = summarize(guardPlans(graph, data));
  const fees = parts.reduce((s, p) => s + p.fee, 0n);
  const summary = {
    decision: g.decision,
    reason: g.reason,
    warnings: g.warnings,
    to: name ?? to,
    amountUsdc: formatUsdc(amount),
    maxFeesUsdc: formatUsdc(fees),
    parts: parts.map((p) => ({
      from: p.source,
      amountUsdc: formatUsdc(p.amount),
      maxFeeUsdc: formatUsdc(p.fee),
      ...(p.dest ? { toStealthAddress: p.dest.stealthAddress } : {}),
    })),
    userOps: parts.length,
  };
  if (g.decision === "block") {
    ctx.log.warn("spend: blocked by the consolidation guard", { to: name ?? to });
    return {
      ...summary,
      planId: null,
      note: "Blocked by the consolidation guard. The agent cannot override this; only the owner can, outside this server.",
    };
  }
  const { planId, expiresAt } = ctx.plans.create("spend", data, now);
  return {
    ...summary,
    planId,
    expiresAt,
    confirmWith: { confirm: planId },
    note:
      g.decision === "warn"
        ? "The guard warns about this spend (see warnings). Nothing was sent. Confirm only if the warnings are acceptable."
        : "Nothing was sent. Call spend again with { confirm: planId } within 10 minutes to execute.",
  };
}

async function confirmSpend(ctx: Ctx, planId: string) {
  const now = ctx.now();
  const plan = ctx.plans.take<SpendPlanData>(planId, "spend", now);
  const graph = loadGraph(ctx.state.read());
  // The graph may have changed since the dry run: re-check, and never send a block.
  const guard = guardPlans(graph, plan);
  if (guard.some((p) => p.decision === "block")) {
    throw new ToolError("guard_block", "the consolidation guard now blocks this spend; nothing was sent", { reason: summarize(guard).reason });
  }
  ctx.caps.consume(plan.amount, now);

  const results: { from: Address; amountUsdc: string; userOpHash?: Hex; txHash?: Hex | undefined; status: "sent" | "failed" | "not_sent"; error?: string }[] = [];
  const done: number[] = [];
  if (plan.mode === "address") {
    const spends = plan.parts.map((p) => ({ stealthKey: stealthKeyFor(ctx, p.announcement), to: plan.to!, amount: p.amount }));
    try {
      const out = await ctx.chain.spendMany(spends);
      out.forEach((r, i) => (done.push(i), results.push({ from: r.from, amountUsdc: formatUsdc(r.amount), userOpHash: r.userOpHash, txHash: r.txHash, status: "sent" })));
    } catch (e) {
      const completed = e instanceof SpendManyError ? e.completed : [];
      completed.forEach((r, i) => (done.push(i), results.push({ from: r.from, amountUsdc: formatUsdc(r.amount), userOpHash: r.userOpHash, txHash: r.txHash, status: "sent" })));
      const failed = e instanceof SpendManyError ? e.failedIndex : completed.length;
      plan.parts.slice(completed.length).forEach((p, i) =>
        results.push({
          from: p.source,
          amountUsdc: formatUsdc(p.amount),
          status: completed.length + i === failed ? "failed" : "not_sent",
          ...(completed.length + i === failed ? { error: errorMessage(e instanceof SpendManyError ? e.cause : e) } : {}),
        }),
      );
    }
  } else {
    const sleep = ctx.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
    for (let i = 0; i < plan.parts.length; i++) {
      const p = plan.parts[i]!;
      if (results.some((r) => r.status === "failed")) {
        results.push({ from: p.source, amountUsdc: formatUsdc(p.amount), status: "not_sent" });
        continue;
      }
      if (i > 0 && ctx.spendDelayMs) await sleep(ctx.spendDelayMs + Math.floor(Math.random() * ctx.spendDelayMs));
      const d = p.dest!;
      const calls = [
        buildTransferCall(ctx.chain.usdc, d.stealthAddress, p.amount),
        {
          to: ANNOUNCER_ADDRESS,
          value: 0n,
          data: encodeFunctionData({
            abi: announcerAbi,
            functionName: "announce",
            args: [BigInt(SCHEME_ID), d.stealthAddress, d.ephemeralPublicKey, buildMetadata57({ viewTag: d.viewTag, token: ctx.chain.usdc, amount: p.amount })],
          }),
        },
      ];
      try {
        const r = await ctx.chain.execute({ stealthKey: stealthKeyFor(ctx, p.announcement), calls, feeTokenSpend: p.amount });
        done.push(i);
        results.push({ from: r.from, amountUsdc: formatUsdc(p.amount), userOpHash: r.userOpHash, txHash: r.txHash, status: "sent" });
      } catch (e) {
        results.push({ from: p.source, amountUsdc: formatUsdc(p.amount), status: "failed", error: errorMessage(e) });
      }
    }
  }

  // Record what actually went out, so later spends see the new links.
  if (done.length) {
    if (plan.mode === "address") applySpend(graph, planSpend(graph, { from: done.map((i) => plan.parts[i]!.source), to: plan.to! }));
    else for (const i of done) applySpend(graph, planSpend(graph, { from: [plan.parts[i]!.source], to: plan.parts[i]!.dest!.stealthAddress }));
    update(ctx.state, (d) => void (d.guard = graph.toJSON()));
  }
  const ok = results.every((r) => r.status === "sent");
  ctx.log.info("spend: done", { ok, userOps: done.length });
  return { ok, to: plan.name ?? plan.to, amountUsdc: formatUsdc(plan.amount), results };
}
