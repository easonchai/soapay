/** Per-leg timeline for display (pure): which steps are done, which is live, and each step's tx. */
import type { ExitLeg, ExitLegStatus } from "./types.js";

export type StepState = "done" | "active" | "todo" | "error";
export type TxChain = "source" | "dest";

export type TimelineStep = {
  status: ExitLegStatus;
  title: string;
  hint?: string;
  state: StepState;
  tx?: { hash: string; chain: TxChain };
};

const HAPPY: ExitLegStatus[] = ["burning", "awaiting-mint", "minted", "depositing", "pending-asp", "approved", "withdrawing", "done"];
const DECLINED: ExitLegStatus[] = ["burning", "awaiting-mint", "minted", "depositing", "pending-asp", "declined", "refunded"];

export const STEP_TITLES: Record<ExitLegStatus, string> = {
  planned: "Queued",
  burning: "Burning USDC on the source chain",
  "awaiting-mint": "Awaiting mint",
  minted: "Minted on the destination chain",
  depositing: "Depositing into the pool",
  "pending-asp": "Pending approval",
  approved: "Approved",
  withdrawing: "Withdrawing through the relayer",
  done: "Done",
  declined: "Declined by the pool's screening",
  refunded: "Refunded",
  failed: "Failed",
};

const HINTS: Partial<Record<ExitLegStatus, string>> = {
  "awaiting-mint": "Circle attests the burn, then its forwarding service mints. Seconds to minutes.",
  "pending-asp": "The pool's screening (ASP) usually takes 10–12 minutes on testnet.",
  approved: "The deposit is in the approved set and can be withdrawn.",
  declined: "Screening didn't approve this deposit. It's returned to the same stealth address (ragequit).",
  refunded: "Back at the stealth address on the destination chain, publicly. Nothing reached your destination.",
};

function txFor(leg: ExitLeg, s: ExitLegStatus): TimelineStep["tx"] {
  const t = leg.txs;
  if (s === "burning" && t.burn) return { hash: t.burn, chain: "source" };
  if (s === "minted" && t.mint) return { hash: t.mint, chain: "dest" };
  if (s === "depositing" && t.deposit) return { hash: t.deposit, chain: "dest" };
  if (s === "withdrawing" && t.withdraw) return { hash: t.withdraw, chain: "dest" };
  if (s === "refunded" && t.refund) return { hash: t.refund, chain: "dest" };
  return undefined;
}

/** How far a failed leg got, from the txs it recorded. */
function failedAt(leg: ExitLeg): number {
  const t = leg.txs;
  if (t.withdraw) return HAPPY.indexOf("withdrawing");
  if (t.deposit) return HAPPY.indexOf("pending-asp");
  if (t.mint) return HAPPY.indexOf("depositing");
  if (t.burn) return HAPPY.indexOf("awaiting-mint");
  return 0;
}

export function timelineOf(leg: ExitLeg): TimelineStep[] {
  const declined = leg.status === "declined" || leg.status === "refunded" || Boolean(leg.txs.refund);
  const path = declined ? DECLINED : HAPPY;
  let at: number;
  if (leg.status === "planned") at = -1;
  else if (leg.status === "failed") at = failedAt(leg);
  else at = path.indexOf(leg.status);
  const terminal = leg.status === "done" || leg.status === "refunded";
  return path.map((s, i) => {
    let state: StepState = i < at ? "done" : i === at ? "active" : "todo";
    if (i === at && terminal) state = "done";
    if (i === at && leg.status === "failed") state = "error";
    if (i === at && leg.status === "declined") state = "error";
    const hint = HINTS[s];
    const tx = txFor(leg, s);
    return { status: s, title: STEP_TITLES[s], state, ...(hint ? { hint } : {}), ...(tx ? { tx } : {}) };
  });
}

/** Short status label for a leg header. */
export function legLabel(leg: ExitLeg): string {
  return STEP_TITLES[leg.status];
}
