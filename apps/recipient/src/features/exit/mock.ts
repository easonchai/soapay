/**
 * Fake exit SDK for VITE_MOCK_API. Each `advance` moves a leg one step once it has sat in its status
 * long enough (timers compressed; the ~10–12 min approval is ~15 s). Stateless apart from the leg
 * itself, so a reload resumes exactly like the real SDK would.
 *
 * The leg with pool index 1 (the second leg this vault ever exits) is declined, to show the refund path.
 */
import { getAddress, keccak256, toHex, type Hash } from "viem";
import { TESTNET_EXIT_CONFIG } from "./config.js";
import type { ExitService } from "./sdk.js";
import type { ExitLeg, ExitLegStatus } from "./types.js";

export const MOCK_DECLINED_POOL_INDEX = 1;

/** How long a leg sits in each status before the mock moves it on (ms). */
export const MOCK_DURATIONS: Record<ExitLegStatus, number> = {
  planned: 0,
  burning: 3_000,
  "awaiting-mint": 4_000,
  minted: 1_500,
  depositing: 3_000,
  "pending-asp": 15_000,
  approved: 1_000,
  withdrawing: 3_000,
  declined: 3_000,
  done: Infinity,
  refunded: Infinity,
  failed: Infinity,
};

const fakeHash = (seed: string): Hash => keccak256(toHex(seed));

function step(leg: ExitLeg, declineIndex: number, now: number): ExitLeg {
  const at = (status: ExitLegStatus, txs: Partial<ExitLeg["txs"]> = {}): ExitLeg => ({
    ...leg,
    status,
    txs: { ...leg.txs, ...txs },
    updatedAt: now,
  });
  const h = (what: string) => fakeHash(`${leg.id}:${what}`);
  switch (leg.status) {
    case "planned":
      return at("burning", { burn: h("burn") });
    case "burning":
      return at("awaiting-mint");
    case "awaiting-mint":
      return at("minted", { mint: h("mint") });
    case "minted":
      return at("depositing", { deposit: h("deposit") });
    case "depositing":
      return at("pending-asp");
    case "pending-asp":
      return at(leg.poolIndex === declineIndex ? "declined" : "approved");
    case "approved":
      return at("withdrawing", { withdraw: h("withdraw") });
    case "withdrawing":
      return at("done");
    case "declined":
      return at("refunded", { refund: h("refund") });
    default:
      return leg;
  }
}

export function createMockExitService(
  opts: {
    durations?: Partial<Record<ExitLegStatus, number>>;
    declineIndex?: number;
    pollMs?: number;
    delayRangeMs?: readonly [number, number];
    now?: () => number;
  } = {},
): ExitService {
  const durations = { ...MOCK_DURATIONS, ...opts.durations };
  const declineIndex = opts.declineIndex ?? MOCK_DECLINED_POOL_INDEX;
  const now = opts.now ?? Date.now;
  return {
    mock: true,
    ready: true,
    config: TESTNET_EXIT_CONFIG,
    pollMs: opts.pollMs ?? 1_000,
    // The random delay after approval, compressed from hours to seconds.
    delayRangeMs: opts.delayRangeMs ?? [4_000, 10_000],
    planExit({ sources, destination, firstPoolIndex }) {
      const t = now();
      const legs: ExitLeg[] = sources.map((s, i) => ({
        id: `leg-${t.toString(36)}-${i}-${s.stealthAddress.slice(2, 8).toLowerCase()}`,
        stealthAddress: getAddress(s.stealthAddress),
        amount: s.amount.toString(),
        destination: getAddress(destination),
        source: TESTNET_EXIT_CONFIG.source,
        dest: TESTNET_EXIT_CONFIG.dest,
        status: "planned",
        txs: {},
        poolIndex: firstPoolIndex + i,
        updatedAt: t,
        withdrawals: [],
      }));
      return { legs, warnings: [] };
    },
    async advance(leg) {
      const t = now();
      if (t - leg.updatedAt < durations[leg.status]) return leg;
      return step(leg, declineIndex, t);
    },
  };
}
