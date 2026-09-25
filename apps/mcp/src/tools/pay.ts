/**
 * `pay`: one pay run through StealthDisperse, as apps/sender does for EOAs. Dry run → plan;
 * `confirm: planId` → exact-total approve, wait until the allowance is visible, then one
 * `pay` per ≤350-line chunk. Lines are derived at plan time (fresh ephemeral key per line,
 * sorted globally by stealth address); ephemeral private keys never leave derivePayRun.
 */
import { formatEther, type Address, type Hash } from "viem";
import { derivePayRun, encodeStealthDisperseCalls, estimatePayRunGas, pinnedMetaChanged, type PayRunLine } from "@soapay/sdk";
import type { Ctx } from "../context.js";
import { normalizeName } from "../guardrails.js";
import { errorMessage, formatUsdc, parseUsdc, ToolError } from "../util.js";
import { requirePayer, resolve, resolvePinned } from "./identity.js";

export type PayInput = {
  payments?: { name: string; amount: string | number }[] | undefined;
  dry_run?: boolean | undefined;
  confirm?: string | undefined;
};

type PayPlan = {
  payer: Address;
  token: Address;
  stealthDisperse: Address;
  lines: PayRunLine[];
  total: bigint;
  pins: Record<string, string>;
};

export async function pay(ctx: Ctx, input: PayInput) {
  if (input.confirm) return confirmPay(ctx, input.confirm);
  if (!input.payments?.length) throw new ToolError("invalid_input", "give `payments` for a dry run, or `confirm: <planId>`");
  const payer = requirePayer(ctx);
  const now = ctx.now();

  const wanted = input.payments.map((p) => ({ name: normalizeName(p.name), amount: parseUsdc(p.amount) }));
  const total = wanted.reduce((s, p) => s + p.amount, 0n);
  ctx.caps.check(total, now);

  const pins: Record<string, string> = {};
  for (const name of new Set(wanted.map((p) => p.name))) pins[name] = (await resolvePinned(ctx, name)).metaAddressURI;

  const lines = derivePayRun({ recipients: wanted.map((p) => ({ id: p.name, metaAddressURI: pins[p.name]!, amount: p.amount })) });
  const est = estimatePayRunGas(lines);
  const [usdc, eth, allowance, gasPrice] = await Promise.all([
    ctx.chain.usdcBalance(payer).catch(() => null),
    ctx.chain.ethBalance(payer).catch(() => null),
    ctx.chain.allowance(payer, ctx.config.stealthDisperse).catch(() => null),
    ctx.chain.gasPrice().catch(() => null),
  ]);
  // Approve (~50k) plus the run; a planning estimate, not a quote.
  const gas = est.totalGas + 50_000n;
  const costWei = gasPrice === null ? null : gas * gasPrice;
  const warnings: string[] = [];
  if (usdc !== null && usdc < total) warnings.push(`payer holds ${formatUsdc(usdc)} USDC, short of ${formatUsdc(total)}`);
  if (eth !== null && costWei !== null && eth < costWei) warnings.push(`payer holds ${formatEther(eth)} ETH, likely short of gas (~${formatEther(costWei)})`);
  if (new Set(wanted.map((p) => p.name)).size < 10) {
    warnings.push("fewer than ~10 recipients: amounts alone may identify people to co-recipients");
  }

  const plan: PayPlan = { payer, token: ctx.chain.usdc, stealthDisperse: ctx.config.stealthDisperse, lines, total, pins };
  const { planId, expiresAt } = ctx.plans.create("pay", plan, now);
  ctx.log.info("pay: planned", { lines: lines.length, total: formatUsdc(total) });
  return {
    planId,
    expiresAt,
    confirmWith: { confirm: planId },
    totalUsdc: formatUsdc(total),
    lineCount: lines.length,
    txCount: est.txCount + (allowance === total ? 0 : 1),
    lines: lines.map((l) => ({ name: l.recipientId, amountUsdc: formatUsdc(l.amount), stealthAddress: l.stealthAddress })),
    gas: { estimate: gas.toString(), gasPriceWei: gasPrice?.toString() ?? null, costEth: costWei === null ? null : formatEther(costWei) },
    payer: {
      address: payer,
      usdc: usdc === null ? null : formatUsdc(usdc),
      eth: eth === null ? null : formatEther(eth),
      allowanceUsdc: allowance === null ? null : formatUsdc(allowance),
    },
    guardrails: { remainingTodayUsdc: formatUsdc(ctx.caps.remainingToday(now)) },
    warnings,
    note: "Nothing was sent. Call pay again with { confirm: planId } within 10 minutes to execute.",
  };
}

type Step = { step: string; status: "landed" | "failed" | "unknown" | "skipped" | "not_sent"; txHash?: Hash; error?: string };

async function confirmPay(ctx: Ctx, planId: string) {
  const now = ctx.now();
  const plan = ctx.plans.take<PayPlan>(planId, "pay", now);
  requirePayer(ctx);

  // The meta-addresses must still be the pinned ones.
  for (const [name, meta] of Object.entries(plan.pins)) {
    const r = await resolve(ctx, name);
    if (pinnedMetaChanged(meta, r.metaAddressURI)) {
      throw new ToolError("pin_changed", `${name} changed its meta-address since the plan was made; nothing was paid`);
    }
  }
  ctx.caps.consume(plan.total, now);

  const enc = encodeStealthDisperseCalls({ stealthDisperse: plan.stealthDisperse, token: plan.token, lines: plan.lines });
  const steps: Step[] = [];
  const sleep = ctx.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const result = (ok: boolean) => ({
    ok,
    planId,
    totalUsdc: formatUsdc(plan.total),
    lineCount: plan.lines.length,
    steps,
    ...(ok ? {} : { note: "Stopped at the first failure; later chunks were not sent. Check `steps` before retrying with a new plan." }),
  });

  // Exact-total approval (never max); skipped only when the allowance already equals the total.
  const current = await ctx.chain.allowance(plan.payer, plan.stealthDisperse).catch(() => null);
  if (current === plan.total) steps.push({ step: "approve", status: "skipped" });
  else {
    const s = await send(ctx, "approve", enc.approve);
    steps.push(s);
    if (s.status !== "landed") return result(false);
    // Load-balanced RPCs can lag: wait until the allowance is visible before `pay`.
    for (let i = 0; i < 10; i++) {
      const seen = await ctx.chain.allowance(plan.payer, plan.stealthDisperse).catch(() => null);
      if (seen === null || seen >= plan.total) break;
      await sleep(1_500);
    }
  }
  for (let i = 0; i < enc.pays.length; i++) {
    const s = await send(ctx, `pay ${i + 1}/${enc.pays.length} (${enc.chunkSizes[i]} lines)`, enc.pays[i]!);
    steps.push(s);
    if (s.status !== "landed") {
      for (let j = i + 1; j < enc.pays.length; j++) steps.push({ step: `pay ${j + 1}/${enc.pays.length}`, status: "not_sent" });
      return result(false);
    }
  }
  ctx.log.info("pay: done", { lines: plan.lines.length, total: formatUsdc(plan.total) });
  return result(true);
}

async function send(ctx: Ctx, step: string, call: { to: Address; data: `0x${string}` }): Promise<Step> {
  let hash: Hash;
  try {
    hash = await ctx.chain.sendTransaction(call);
  } catch (e) {
    return { step, status: "failed", error: errorMessage(e) };
  }
  try {
    const s = await ctx.chain.waitForReceipt(hash);
    return s === "success" ? { step, status: "landed", txHash: hash } : { step, status: "failed", txHash: hash, error: "reverted" };
  } catch (e) {
    return { step, status: "unknown", txHash: hash, error: errorMessage(e) };
  }
}
