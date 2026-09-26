/**
 * Exit planner math (pure). Every stealth address is its own leg, bridged to itself and deposited on
 * its own; nothing is combined before the pool. Every figure comes from the SDK (`exitLegCost`,
 * `exitLegMinimum`: the same arithmetic the step machine spends by), fed with live quotes when the
 * app has them (`fetchExitFeeQuote`: Circle Iris, the 0xbow relayer, Sepolia gas) and the route's
 * estimates otherwise. The fees are mostly fixed per leg, so small exits lose a big share: the
 * planner says so, and on testnet the relayer's own fixed fee (≈ 21.5 USDC) makes a relayed
 * withdrawal worthwhile only from ≈ 100 USDC, so a direct withdrawal is offered below that.
 */
import {
  EXIT_DIRECT_WITHDRAW_GAS,
  EXIT_HIGH_FEE_SHARE_BPS,
  exitLegCost,
  exitLegMinimum,
  relayFeeCap,
  relayFeeFor,
  type ExitFeeInputs,
  type ExitWithdrawVia,
} from "@soapay/sdk";
import { getAddress, isAddress, type Address } from "viem";
import type { ExitConfig } from "./types.js";

const USDC = 1_000_000n;

export type PlanOptions = {
  roundWithdrawals: boolean;
  /** Relayed (default) or direct from the destination wallet. */
  via?: ExitWithdrawVia;
  /** Live fee quotes; missing parts fall back to the route's estimates. */
  live?: ExitFeeInputs;
};

export type LegEstimate = {
  stealthAddress: Address;
  amount: bigint;
  eligible: boolean;
  /** Why the leg can't exit (below the minimum after fees). */
  reason?: string;
  /** The smallest balance that clears the pool minimum (and, relayed, the relayer's fee limit). */
  minAmount: bigint;
  /** How much more this address needs to reach `minAmount` (0 when eligible). */
  shortBy: bigint;
  /** Relayed only: the address is below the relayer minimum but a direct withdrawal would work. */
  directWouldWork: boolean;
  /**
   * Paymaster gas reserve, both chains: the prefund the paymaster pulls before each userOp, plus the
   * 10% headroom the SDK keeps. The unused part is refunded to the stealth address, where it stays.
   */
  gas: bigint;
  /** CCTP protocol fee + the Forwarding Service fee. */
  bridgeFee: bigint;
  deposit: bigint; // into the pool
  vettingFee: bigint; // pool entry fee (1%)
  withdraw: bigint; // what leaves the pool (rounded when requested)
  relayerFee: bigint; // 0 when direct
  /** The most the step machine lets the relayer take (it waits above this); 0 when direct. */
  relayerFeeCap: bigint;
  leftInPool: bigint; // change left in the pool by a round withdrawal
  receive: bigint; // at the destination
  totalFees: bigint;
  feeShareBps: bigint;
};

export type ExitEstimate = {
  legs: LegEstimate[];
  eligible: LegEstimate[];
  via: ExitWithdrawVia;
  /** The leg minimum (same for every leg). */
  minAmount: bigint;
  /** The leg minimum with a direct withdrawal (no relayer). */
  directMinAmount: bigint;
  /** The pool's own minimum deposit. */
  minDeposit: bigint;
  /** What the relayer charges per withdrawal for its gas (live or estimate). */
  relayGas: bigint;
  totals: {
    amount: bigint;
    gas: bigint;
    bridgeFee: bigint;
    vettingFee: bigint;
    relayerFee: bigint;
    relayerFeeCap: bigint;
    leftInPool: bigint;
    receive: bigint;
    totalFees: bigint;
  };
  /** Total fees as bps of the amount (0 when nothing is eligible). */
  feeShareBps: bigint;
  /** Fees above 15% of the amount: suggest a larger exit. */
  highFees: boolean;
};

/**
 * The smallest leg balance that reaches the pool and can leave it: its minimum deposit + the CCTP fee
 * + the Forwarding Service fee + both paymaster prefunds, and (relayed) enough for the relayer's
 * fixed fee to stay under the pool's 30% limit (SDK `exitLegMinimum`).
 */
export function minLegAmount(cfg: ExitConfig, opts: Omit<PlanOptions, "roundWithdrawals"> & { roundWithdrawals?: boolean } = {}): bigint {
  return legMinimum(cfg, { roundWithdrawals: opts.roundWithdrawals ?? false, ...opts }).minimum;
}

function legMinimum(cfg: ExitConfig, opts: PlanOptions) {
  const via = opts.via ?? "relayer";
  return exitLegMinimum(cfg, opts.live, { via, ...(opts.roundWithdrawals && via === "relayer" ? { roundTo: cfg.withdrawUnit } : {}) });
}

/** The per-leg "below the minimum" message: what's needed, what's held, and how much to add. */
export function belowMinimumReason(
  amount: bigint,
  minAmount: bigint,
  cfg: Pick<ExitConfig, "pool">,
  relay?: { relayGas: bigint; directMinAmount: bigint },
): string {
  if (relay) {
    const direct =
      amount >= relay.directMinAmount
        ? `Withdraw directly instead (your destination wallet pays a little ETH gas), or exit a larger amount.`
        : `A direct withdrawal (your destination wallet pays a little ETH gas) needs ${fmtUsdcUp(relay.directMinAmount)} USDC.`;
    return (
      `The relayer would take more than this exit is worth: it charges about ${fmtUsdcUp(relay.relayGas)} USDC per withdrawal for its gas, ` +
      `and the pool refuses a relayer fee above ${Number(cfg.pool.maxRelayFeeBps) / 100}% of the withdrawal, so a relayed exit needs at least ${fmtUsdcUp(minAmount)} USDC ` +
      `on one address; this one holds ${fmtUsdcDown(amount)}. ${direct}`
    );
  }
  return (
    `Below the exit minimum: a leg needs at least ${fmtUsdcUp(minAmount)} USDC (the pool's ${fmtUsdcUp(cfg.pool.minDeposit)} USDC ` +
    `minimum deposit plus bridge fees and gas); this address holds ${fmtUsdcDown(amount)}. Add ${fmtUsdcUp(minAmount - amount)} USDC to exit it.`
  );
}

export function estimateLeg(source: { stealthAddress: Address; amount: bigint }, cfg: ExitConfig, opts: PlanOptions): LegEstimate {
  const { amount } = source;
  const via = opts.via ?? "relayer";
  const min = legMinimum(cfg, opts);
  const directMin = via === "direct" ? min : legMinimum(cfg, { ...opts, via: "direct" });
  const c = exitLegCost(cfg, amount, {
    ...(opts.live ? { live: opts.live } : {}),
    via,
    withdrawParts: 1,
    leaveChange: opts.roundWithdrawals && via === "relayer",
  });
  const eligible = amount >= min.minimum;
  const relayGas = opts.live?.relayGas ?? cfg.estimates.relayGas;
  const largest = c.withdrawals.reduce((m, w) => (w > m ? w : m), 0n);
  const zeroIfNot = (v: bigint) => (eligible ? v : 0n);
  return {
    stealthAddress: getAddress(source.stealthAddress),
    amount,
    eligible,
    ...(eligible
      ? {}
      : { reason: belowMinimumReason(amount, min.minimum, cfg, via === "relayer" && min.relayBound ? { relayGas, directMinAmount: directMin.minimum } : undefined) }),
    minAmount: min.minimum,
    shortBy: eligible ? 0n : min.minimum - amount,
    directWouldWork: !eligible && via === "relayer" && amount >= directMin.minimum,
    gas: c.sourceGas + c.destGas,
    bridgeFee: c.cctpProtocolFee + c.forwardFee,
    deposit: zeroIfNot(c.deposit),
    vettingFee: zeroIfNot(c.vettingFee),
    withdraw: zeroIfNot(c.withdrawals.reduce((a, w) => a + w, 0n)),
    relayerFee: zeroIfNot(c.relayFee),
    relayerFeeCap: eligible && via === "relayer" && largest > 0n ? relayFeeCap(relayFeeFor(cfg, largest, opts.live)) : 0n,
    leftInPool: zeroIfNot(c.leftInPool),
    receive: zeroIfNot(c.received),
    totalFees: zeroIfNot(c.totalFees),
    feeShareBps: zeroIfNot(c.feeShareBps),
  };
}

export function estimateExit(sources: { stealthAddress: Address; amount: bigint }[], cfg: ExitConfig, opts: PlanOptions): ExitEstimate {
  const via = opts.via ?? "relayer";
  const legs = sources.map((s) => estimateLeg(s, cfg, opts));
  const eligible = legs.filter((l) => l.eligible);
  const sum = (f: (l: LegEstimate) => bigint) => eligible.reduce((a, l) => a + f(l), 0n);
  const amount = sum((l) => l.amount);
  const totalFees = sum((l) => l.totalFees);
  const feeShareBps = amount > 0n ? (totalFees * 10_000n + amount - 1n) / amount : 0n;
  return {
    legs,
    eligible,
    via,
    minAmount: legMinimum(cfg, opts).minimum,
    directMinAmount: legMinimum(cfg, { ...opts, via: "direct" }).minimum,
    minDeposit: cfg.pool.minDeposit,
    relayGas: opts.live?.relayGas ?? cfg.estimates.relayGas,
    totals: {
      amount,
      gas: sum((l) => l.gas),
      bridgeFee: sum((l) => l.bridgeFee),
      vettingFee: sum((l) => l.vettingFee),
      relayerFee: sum((l) => l.relayerFee),
      relayerFeeCap: sum((l) => l.relayerFeeCap),
      leftInPool: sum((l) => l.leftInPool),
      receive: sum((l) => l.receive),
      totalFees,
    },
    feeShareBps,
    highFees: feeShareBps > EXIT_HIGH_FEE_SHARE_BPS,
  };
}

/** ETH the destination wallet pays for a direct withdrawal (upper bound) at a gas price. */
export function directWithdrawEth(gasPriceWei: bigint): bigint {
  return EXIT_DIRECT_WITHDRAW_GAS * gasPriceWei;
}

/**
 * The planner-level message when nothing can exit: every address is below the leg minimum. Null
 * when at least one leg is eligible or there is nothing to exit.
 */
export function noEligibleMessage(est: Pick<ExitEstimate, "legs" | "eligible" | "minAmount" | "via" | "directMinAmount">): string | null {
  if (est.legs.length === 0 || est.eligible.length > 0) return null;
  const largest = est.legs.reduce((m, l) => (l.amount > m ? l.amount : m), 0n);
  if (est.via === "relayer" && est.legs.some((l) => l.directWouldWork))
    return (
      `The relayer would take more than any of these exits is worth: a relayed exit needs at least ${fmtUsdcUp(est.minAmount)} USDC on one stealth address, ` +
      `and your largest holds ${fmtUsdcDown(largest)} USDC. Withdraw directly instead: your destination wallet pays a little ETH gas, and each leg needs ${fmtUsdcUp(est.directMinAmount)} USDC.`
    );
  return (
    `None of your addresses can exit yet. Each exit leg needs at least ${fmtUsdcUp(est.minAmount)} USDC on one stealth address ` +
    `(the pool's minimum deposit plus bridge fees and gas${est.via === "relayer" ? ", and the relayer's fee" : ""}); your largest holds ${fmtUsdcDown(largest)} USDC. ` +
    `Addresses are never combined before the pool, so wait for a larger payment to one address.`
  );
}

/** Validates an exit request. Returns an error message, or null. */
export function validateExit(p: {
  destination: string;
  selected: Address[];
  estimates: LegEstimate[];
  ownAddresses: Address[];
}): string | null {
  const d = p.destination.trim();
  if (!isAddress(d, { strict: false })) return "Enter the destination as a 0x address.";
  if (p.ownAddresses.some((a) => a.toLowerCase() === d.toLowerCase())) {
    return "The destination is one of your stealth addresses. Exit to a wallet you control outside Soapay.";
  }
  if (p.selected.length === 0) return "Pick at least one stealth address to exit from.";
  const byAddr = new Map(p.estimates.map((e) => [e.stealthAddress.toLowerCase(), e]));
  for (const a of p.selected) {
    const e = byAddr.get(a.toLowerCase());
    if (!e) return `No balance for ${a}. Rescan, then try again.`;
    if (!e.eligible) return e.reason ?? "A selected address is below the exit minimum.";
  }
  return null;
}

/** USDC to 2 dp, rounded UP (a minimum must never be understated). */
export function fmtUsdcUp(v: bigint): string {
  const whole = v / USDC;
  const cents = ((v % USDC) + 9_999n) / 10_000n; // round up to the cent
  return cents >= 100n ? `${whole + 1n}.00` : `${whole}.${cents.toString().padStart(2, "0")}`;
}

/** USDC to 2 dp, rounded DOWN (a balance must never be overstated). */
export function fmtUsdcDown(v: bigint): string {
  const whole = v / USDC;
  const cents = (v % USDC) / 10_000n;
  return `${whole}.${cents.toString().padStart(2, "0")}`;
}

/** bps as a whole percent, e.g. "31%" (rounded to nearest). */
export function fmtPercent(bps: bigint): string {
  return `${(bps + 50n) / 100n}%`;
}
