/**
 * Exit planner math (pure). Every stealth address is its own leg, bridged to itself and deposited on
 * its own; nothing is combined before the pool. The leg minimum and the gas and forward-fee figures
 * come from the SDK (`exitLegMinimum`, the same arithmetic the step machine spends by), so a leg
 * shown as eligible clears the pool minimum even on an expensive day.
 */
import { exitLegMinimum } from "@soapay/sdk";
import { getAddress, isAddress, type Address } from "viem";
import { EXIT_FEES } from "./config.js";
import type { ExitConfig } from "./types.js";

const USDC = 1_000_000n;
const ceilDiv = (a: bigint, b: bigint) => (a + b - 1n) / b;

export type LegEstimate = {
  stealthAddress: Address;
  amount: bigint;
  eligible: boolean;
  /** Why the leg can't exit (below the minimum after fees). */
  reason?: string;
  /** The smallest balance that clears the pool minimum after bridge and gas fees. */
  minAmount: bigint;
  /** How much more this address needs to reach `minAmount` (0 when eligible). */
  shortBy: bigint;
  /**
   * Paymaster gas reserve, both chains: the prefund the paymaster pulls before each userOp, plus the
   * 10% headroom the SDK keeps. The unused part is refunded to the stealth address, where it stays.
   */
  gas: bigint;
  forwardFeeLow: bigint;
  forwardFeeHigh: bigint; // incl. the CCTP protocol fee
  deposit: bigint; // worst case, into the pool
  vettingFee: bigint; // pool entry fee (1%)
  withdraw: bigint; // what leaves the pool (rounded when requested)
  relayerFee: bigint; // 0.1% of the withdrawal
  leftInPool: bigint; // change left in the pool by a round withdrawal
  receive: bigint; // at the destination, worst case
  receiveHigh: bigint; // at the destination with the low forward fee
};

export type ExitEstimate = {
  legs: LegEstimate[];
  eligible: LegEstimate[];
  /** The leg minimum (same for every leg). */
  minAmount: bigint;
  /** The pool's own minimum deposit. */
  minDeposit: bigint;
  totals: {
    amount: bigint;
    gas: bigint;
    forwardFeeLow: bigint;
    forwardFeeHigh: bigint;
    vettingFee: bigint;
    relayerFee: bigint;
    leftInPool: bigint;
    receive: bigint;
    receiveHigh: bigint;
  };
};

/**
 * The smallest leg balance that reaches the pool: its minimum deposit + the CCTP fee + the
 * Forwarding Service fee + both paymaster prefunds (docs/exit-research.md; SDK `exitLegMinimum`).
 */
export function minLegAmount(cfg: ExitConfig): bigint {
  return exitLegMinimum(cfg).minimum;
}

function afterPool(deposit: bigint, cfg: Pick<ExitConfig, "pool">, round: boolean) {
  const vettingFee = (deposit * cfg.pool.vettingFeeBps) / 10_000n;
  const committed = deposit - vettingFee;
  const withdraw = round ? (committed / USDC) * USDC : committed;
  const relayerFee = ceilDiv(withdraw * EXIT_FEES.relayerBps, 10_000n);
  return { vettingFee, withdraw, relayerFee, leftInPool: committed - withdraw, receive: withdraw - relayerFee };
}

/** The per-leg "below the minimum" message: what's needed, what's held, and how much to add. */
export function belowMinimumReason(amount: bigint, minAmount: bigint, cfg: Pick<ExitConfig, "pool">): string {
  return (
    `Below the exit minimum: a leg needs at least ${fmtUsdcUp(minAmount)} USDC (the pool's ${fmtUsdcUp(cfg.pool.minDeposit)} USDC ` +
    `minimum deposit plus bridge fees and gas); this address holds ${fmtUsdcDown(amount)}. Add ${fmtUsdcUp(minAmount - amount)} USDC to exit it.`
  );
}

export function estimateLeg(source: { stealthAddress: Address; amount: bigint }, cfg: ExitConfig, opts: { roundWithdrawals: boolean }): LegEstimate {
  const { amount } = source;
  const min = exitLegMinimum(cfg);
  const minAmount = min.minimum;
  const gas = min.breakdown.sourceGas + min.breakdown.destGas;
  // Same arithmetic as the SDK step machine: the burn is what's left after the source gas reserve.
  const burn = amount > min.breakdown.sourceGas ? amount - min.breakdown.sourceGas : 0n;
  const protocol = ceilDiv(burn * EXIT_FEES.cctpProtocolPer100k, 100_000n);
  const forwardFeeLow = EXIT_FEES.forwardLow + protocol;
  const forwardFeeHigh = min.breakdown.forwardFee + protocol;
  const eligible = amount >= minAmount;
  const deposit = amount - gas - forwardFeeHigh - cfg.ragequitReserve;
  const depositHigh = amount - gas - forwardFeeLow - cfg.ragequitReserve;
  const worst = afterPool(deposit > 0n ? deposit : 0n, cfg, opts.roundWithdrawals);
  const best = afterPool(depositHigh > 0n ? depositHigh : 0n, cfg, opts.roundWithdrawals);
  return {
    stealthAddress: getAddress(source.stealthAddress),
    amount,
    eligible,
    ...(eligible ? {} : { reason: belowMinimumReason(amount, minAmount, cfg) }),
    minAmount,
    shortBy: eligible ? 0n : minAmount - amount,
    gas,
    forwardFeeLow,
    forwardFeeHigh,
    deposit: eligible ? deposit : 0n,
    vettingFee: eligible ? worst.vettingFee : 0n,
    withdraw: eligible ? worst.withdraw : 0n,
    relayerFee: eligible ? worst.relayerFee : 0n,
    leftInPool: eligible ? worst.leftInPool : 0n,
    receive: eligible ? worst.receive : 0n,
    receiveHigh: eligible ? best.receive : 0n,
  };
}

export function estimateExit(sources: { stealthAddress: Address; amount: bigint }[], cfg: ExitConfig, opts: { roundWithdrawals: boolean }): ExitEstimate {
  const legs = sources.map((s) => estimateLeg(s, cfg, opts));
  const eligible = legs.filter((l) => l.eligible);
  const sum = (f: (l: LegEstimate) => bigint) => eligible.reduce((a, l) => a + f(l), 0n);
  return {
    legs,
    eligible,
    minAmount: minLegAmount(cfg),
    minDeposit: cfg.pool.minDeposit,
    totals: {
      amount: sum((l) => l.amount),
      gas: sum((l) => l.gas),
      forwardFeeLow: sum((l) => l.forwardFeeLow),
      forwardFeeHigh: sum((l) => l.forwardFeeHigh),
      vettingFee: sum((l) => l.vettingFee),
      relayerFee: sum((l) => l.relayerFee),
      leftInPool: sum((l) => l.leftInPool),
      receive: sum((l) => l.receive),
      receiveHigh: sum((l) => l.receiveHigh),
    },
  };
}

/**
 * The planner-level message when nothing can exit: every address is below the leg minimum. Null
 * when at least one leg is eligible or there is nothing to exit.
 */
export function noEligibleMessage(est: Pick<ExitEstimate, "legs" | "eligible" | "minAmount">): string | null {
  if (est.legs.length === 0 || est.eligible.length > 0) return null;
  const largest = est.legs.reduce((m, l) => (l.amount > m ? l.amount : m), 0n);
  return (
    `None of your addresses can exit yet. Each exit leg needs at least ${fmtUsdcUp(est.minAmount)} USDC on one stealth address ` +
    `(the pool's minimum deposit plus bridge fees and gas); your largest holds ${fmtUsdcDown(largest)} USDC. ` +
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
