/**
 * Exit planner math (pure). Every stealth address is its own leg, bridged to itself and deposited on
 * its own; nothing is combined before the pool. Estimates are worst case (the high forward fee), so a
 * leg shown as eligible clears the pool minimum even on an expensive day.
 */
import { getAddress, isAddress, type Address } from "viem";
import { EXIT_FEES } from "./config.js";
import type { ExitConfig } from "./types.js";

const USDC = 1_000_000n;
const ceilDiv = (a: bigint, b: bigint) => (a + b - 1n) / b;

export type LegEstimate = {
  stealthAddress: Address;
  amount: bigint;
  eligible: boolean;
  /** Why the leg can't exit (below the pool minimum after fees). */
  reason?: string;
  /** The smallest balance that clears the pool minimum after bridge and gas fees. */
  minAmount: bigint;
  gas: bigint; // paymaster gas, both chains
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

/** The smallest leg balance whose worst-case deposit meets the pool minimum. */
export function minLegAmount(cfg: Pick<ExitConfig, "pool">): bigint {
  const fixed = cfg.pool.minDeposit + EXIT_FEES.sourceGas + EXIT_FEES.destGas + EXIT_FEES.forwardHigh;
  // amount − amount·13/100_000 ≥ fixed  ⇒  amount ≥ fixed·100_000 / (100_000 − 13)
  return ceilDiv(fixed * 100_000n, 100_000n - EXIT_FEES.cctpProtocolPer100k);
}

function afterPool(deposit: bigint, cfg: Pick<ExitConfig, "pool">, round: boolean) {
  const vettingFee = (deposit * cfg.pool.vettingFeeBps) / 10_000n;
  const committed = deposit - vettingFee;
  const withdraw = round ? (committed / USDC) * USDC : committed;
  const relayerFee = ceilDiv(withdraw * EXIT_FEES.relayerBps, 10_000n);
  return { vettingFee, withdraw, relayerFee, leftInPool: committed - withdraw, receive: withdraw - relayerFee };
}

export function estimateLeg(
  source: { stealthAddress: Address; amount: bigint },
  cfg: Pick<ExitConfig, "pool">,
  opts: { roundWithdrawals: boolean },
): LegEstimate {
  const { amount } = source;
  const protocol = ceilDiv(amount * EXIT_FEES.cctpProtocolPer100k, 100_000n);
  const gas = EXIT_FEES.sourceGas + EXIT_FEES.destGas;
  const forwardFeeLow = EXIT_FEES.forwardLow + protocol;
  const forwardFeeHigh = EXIT_FEES.forwardHigh + protocol;
  const minAmount = minLegAmount(cfg);
  const deposit = amount - gas - forwardFeeHigh;
  const depositHigh = amount - gas - forwardFeeLow;
  const eligible = deposit >= cfg.pool.minDeposit;
  const worst = afterPool(deposit > 0n ? deposit : 0n, cfg, opts.roundWithdrawals);
  const best = afterPool(depositHigh > 0n ? depositHigh : 0n, cfg, opts.roundWithdrawals);
  return {
    stealthAddress: getAddress(source.stealthAddress),
    amount,
    eligible,
    ...(eligible
      ? {}
      : {
          reason: `Below the pool minimum: a leg needs at least ${fmt(minAmount)} USDC to deposit ${fmt(cfg.pool.minDeposit)} USDC after bridge and gas fees.`,
        }),
    minAmount,
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

export function estimateExit(
  sources: { stealthAddress: Address; amount: bigint }[],
  cfg: Pick<ExitConfig, "pool">,
  opts: { roundWithdrawals: boolean },
): ExitEstimate {
  const legs = sources.map((s) => estimateLeg(s, cfg, opts));
  const eligible = legs.filter((l) => l.eligible);
  const sum = (f: (l: LegEstimate) => bigint) => eligible.reduce((a, l) => a + f(l), 0n);
  return {
    legs,
    eligible,
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
    if (!e.eligible) return e.reason ?? "A selected address is below the pool minimum.";
  }
  return null;
}

function fmt(v: bigint): string {
  const whole = v / USDC;
  const cents = ((v % USDC) + 9_999n) / 10_000n; // round up to the cent
  return cents >= 100n ? `${whole + 1n}.00` : `${whole}.${cents.toString().padStart(2, "0")}`;
}
