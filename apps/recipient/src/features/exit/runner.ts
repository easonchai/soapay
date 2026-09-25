/**
 * The exit runner, framework-free. One `tickExits` call advances every active leg by at most one SDK
 * step and saves each leg the moment it changes, so a reload or lock loses nothing: the next tick
 * (after unlock) picks up from the stored leg. `useExit` just calls this on an interval.
 */
import type { AdvanceOptions, ExitKeys, ExitService } from "./sdk.js";
import { isTerminal, legChanged, loadLeg, storeLeg, type ExitLeg, type ExitRecord, type StoredExitLeg } from "./types.js";

export type LegAction = "advance" | "hold" | "schedule" | "idle";

/**
 * - idle: finished (done / refunded / failed; a failed leg only moves on an explicit retry)
 * - schedule: just approved with the random delay on, and no withdrawal time picked yet
 * - hold: approved, waiting out the random delay
 * - advance: call the SDK
 */
export function nextAction(leg: ExitLeg, record: Pick<ExitRecord, "privacy" | "holdUntil">, now: number): LegAction {
  if (isTerminal(leg.status)) return "idle";
  if (leg.status === "approved" && record.privacy.randomDelay) {
    const until = record.holdUntil[leg.id];
    if (until === undefined) return "schedule";
    if (now < until) return "hold";
  }
  return "advance";
}

export function pickDelay(range: readonly [number, number], random: () => number = Math.random): number {
  const [lo, hi] = range;
  return Math.round(lo + (hi - lo) * random());
}

export type LegPatch = { leg?: StoredExitLeg; holdUntil?: number | null };

/** Applies a patch to one leg of one exit (pure). */
export function patchRecords(records: ExitRecord[], exitId: string, legId: string, patch: LegPatch): ExitRecord[] {
  return records.map((r) => {
    if (r.id !== exitId) return r;
    const legs = patch.leg ? r.legs.map((l) => (l.id === legId ? patch.leg! : l)) : r.legs;
    let holdUntil = r.holdUntil;
    if (patch.holdUntil === null) {
      const { [legId]: _gone, ...rest } = r.holdUntil;
      holdUntil = rest;
    } else if (patch.holdUntil !== undefined) {
      holdUntil = { ...r.holdUntil, [legId]: patch.holdUntil };
    }
    return { ...r, legs, holdUntil };
  });
}

export async function tickExits(p: {
  records: ExitRecord[];
  service: ExitService;
  keysFor: (leg: ExitLeg) => ExitKeys;
  now: () => number;
  random?: () => number;
  save: (exitId: string, legId: string, patch: LegPatch) => Promise<void>;
  onError?: (legId: string, message: string | null) => void;
}): Promise<void> {
  for (const record of p.records) {
    const opts: AdvanceOptions = { destination: record.destination, roundWithdrawals: record.privacy.roundWithdrawals };
    for (const stored of record.legs) {
      const leg = loadLeg(stored);
      const action = nextAction(leg, record, p.now());
      if (action === "idle" || action === "hold") continue;
      if (action === "schedule") {
        await p.save(record.id, leg.id, { holdUntil: p.now() + pickDelay(p.service.delayRangeMs, p.random) });
        continue;
      }
      try {
        const next = await p.service.advance(leg, p.keysFor(leg), opts);
        p.onError?.(leg.id, null);
        if (!legChanged(leg, next)) continue;
        const patch: LegPatch = { leg: storeLeg(next) };
        // Pick the withdrawal time in the same write as the approval.
        if (next.status === "approved" && record.privacy.randomDelay && record.holdUntil[leg.id] === undefined) {
          patch.holdUntil = p.now() + pickDelay(p.service.delayRangeMs, p.random);
        }
        await p.save(record.id, leg.id, patch);
      } catch (e) {
        // Transient (RPC, bundler, relayer): keep the leg as is and try again next tick.
        p.onError?.(leg.id, e instanceof Error ? e.message : String(e));
      }
    }
  }
}

/** Legs still moving, across all exits. */
export function activeLegs(records: ExitRecord[]): StoredExitLeg[] {
  return records.flatMap((r) => r.legs.filter((l) => !isTerminal(l.status)));
}
