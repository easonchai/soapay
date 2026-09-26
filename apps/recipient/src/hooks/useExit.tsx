/**
 * Compliant exit through Privacy Pools (docs/mvp-spec.md §9). `ExitProvider` runs for as long as the
 * vault is unlocked, on every screen: it polls active legs on an interval, advances each through the
 * SDK seam (features/exit/sdk.ts) and writes every change into the encrypted vault right away, so a
 * reload or lock resumes where it left off. Any UI reads `useExit()` and calls its actions.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { getAddress, type Address } from "viem";
import { estimateExit, validateExit, type ExitEstimate } from "../features/exit/planner.js";
import { activeLegs, patchRecords, tickExits, type LegPatch } from "../features/exit/runner.js";
import type { ExitKeys } from "../features/exit/sdk.js";
import { isTerminal, loadLeg, storeLeg, type ExitFeeQuote, type ExitLeg, type ExitPrivacy, type ExitRecord, type ExitWithdrawVia } from "../features/exit/types.js";
import { EXIT_QUOTE_TTL_MS } from "../features/exit/config.js";
import { connectDestinationWallet } from "../features/exit/wallet.js";
import { useServices } from "../services/ServicesProvider.js";
import { stealthKeyFor } from "../spend/flow.js";
import { errorMessage } from "../ui/kit.js";
import { useUnlocked } from "../vault/VaultProvider.js";
import { chainState, settingsOf, type VaultData } from "../vault/types.js";
import { lockedAddresses, release, windowOpensAt } from "@soapay/sdk";
import { enqueueExitLegs, isLegQueued, queueOf, queueWindow } from "../spend/queue.js";
import { useChain, useKeyRing } from "./useChain.js";
import { useWallet } from "./useWallet.js";

export const DEFAULT_PRIVACY: ExitPrivacy = { randomDelay: true, roundWithdrawals: true };

export type ExitView = { record: ExitRecord; legs: ExitLeg[]; finished: boolean };

export type StartExit = { sources: Address[]; destination: string; privacy: ExitPrivacy; withdrawVia?: ExitWithdrawVia };

/** The planner's fee inputs: a live quote once it arrives, the route's estimates until then. */
export type ExitQuoteState = { status: "loading" | "live" | "partial" | "estimate"; quote: ExitFeeQuote | null };

export type ExitApi = {
  ready: boolean;
  unavailableReason?: string;
  mock: boolean;
  /** Newest first. */
  exits: ExitView[];
  /** Stealth addresses already in an exit (in flight or finished; a failed leg frees its address). */
  busy: ReadonlySet<string>;
  /** Last transient error per leg id (cleared on the next good step). */
  errors: Readonly<Record<string, string>>;
  /** Every stealth address with a balance, as exit sources (full balance per leg). */
  sources: { stealthAddress: Address; amount: bigint }[];
  estimate(selected: Address[], privacy: ExitPrivacy, via?: ExitWithdrawVia): ExitEstimate | null;
  /** Live fee quotes for the planner (refreshed every few minutes while the provider runs). */
  quote: ExitQuoteState;
  start(input: StartExit): Promise<{ id: string } | { error: string }>;
  /** Skip the rest of the random delay and withdraw on the next tick. */
  withdrawNow(exitId: string, legId: string): Promise<void>;
  /**
   * Withdraw an approved leg directly from the destination wallet (injected, it pays ETH gas), for
   * when the relayer fee is unreasonable. Switches the leg to direct for good.
   */
  withdrawDirect(exitId: string, legId: string): Promise<void>;
  /** Re-run a failed leg's current step. */
  retry(exitId: string, legId: string): Promise<void>;
  /** Run one polling round now. */
  tick(): Promise<void>;
  /** Per leg id: when its timing-queue window opens (D-28), for legs still waiting to deposit. */
  queuedAt: Readonly<Record<string, number>>;
  /** Override: start every queued leg of this exit now (links those addresses by timing). */
  startNow(exitId: string): Promise<void>;
};

const ExitContext = createContext<ExitApi | null>(null);

const exitsOf = (d: VaultData, chainId: number): ExitRecord[] => chainState(d, chainId).exits ?? [];

export function ExitProvider({ children, random }: { children: ReactNode; random?: () => number }) {
  const v = useUnlocked();
  const svc = useServices();
  const service = svc.exit;
  const { chainId, state } = useChain();
  const ring = useKeyRing();
  const wallet = useWallet();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const dataRef = useRef(v.data);
  dataRef.current = v.data;
  const running = useRef(false);
  const { update } = v;

  const records = useMemo(() => state.exits ?? [], [state.exits]);

  // Every write refreshes dataRef at once (not on the next render), so the runner's next read, a
  // persist-before-send and "Start now" all see the state that is already in the vault.
  const write = useCallback(
    async (fn: (d: VaultData) => VaultData) => {
      const next = await update(fn);
      dataRef.current = next;
      return next;
    },
    [update],
  );

  const updateExits = useCallback(
    (fn: (r: ExitRecord[]) => ExitRecord[]) =>
      write((d) => {
        const cs = chainState(d, chainId);
        return { ...d, chains: { ...d.chains, [String(chainId)]: { ...cs, exits: fn(cs.exits ?? []) } } };
      }),
    [write, chainId],
  );

  const save = useCallback(
    async (exitId: string, legId: string, patch: LegPatch) => {
      await updateExits((r) => patchRecords(r, exitId, legId, patch));
    },
    [updateExits],
  );

  const keysFor = useCallback(
    (leg: ExitLeg): ExitKeys => ({
      stealthKey: () => stealthKeyFor(chainState(dataRef.current, chainId), ring, leg.stealthAddress),
      spendingKey: ring.all[0]!.spendingKey,
    }),
    [chainId, ring],
  );

  const onError = useCallback((legId: string, message: string | null) => {
    setErrors((e) => {
      if (message === null) {
        if (!(legId in e)) return e;
        const { [legId]: _gone, ...rest } = e;
        return rest;
      }
      return e[legId] === message ? e : { ...e, [legId]: message };
    });
  }, []);

  const again = useRef(false);
  const tick = useCallback(async () => {
    if (!service.ready) return;
    // A tick asked for while one runs (e.g. "Start now" mid-poll) runs right after it, not a poll later.
    if (running.current) {
      again.current = true;
      return;
    }
    running.current = true;
    try {
      do {
        again.current = false;
        await tickExits({
          records: exitsOf(dataRef.current, chainId),
          service,
          keysFor,
          now: Date.now,
          ...(random ? { random } : {}),
          save,
          onError,
          isQueued: (legId) => isLegQueued(queueOf(chainState(dataRef.current, chainId)), legId),
        });
      } while (again.current);
    } finally {
      running.current = false;
    }
  }, [service, chainId, keysFor, random, save, onError]);

  // Resume on mount (reload / unlock) and poll while anything is in flight.
  const hasActive = activeLegs(records).length > 0;
  useEffect(() => {
    if (!service.ready || !hasActive) return;
    void tick();
    const t = setInterval(() => void tick(), service.pollMs);
    return () => clearInterval(t);
  }, [service, hasActive, tick]);

  const queue = useMemo(() => queueOf(state), [state]);
  const busy = useMemo(
    () =>
      new Set([
        ...records.flatMap((r) => r.legs).filter((l) => l.status !== "failed").map((l) => l.stealthAddress.toLowerCase()),
        // Addresses waiting in the timing queue for a Send are taken too.
        ...lockedAddresses(queue),
      ]),
    [records, queue],
  );

  const minGapMs = queueWindow(settingsOf(v.data)).minMs;
  const queuedAt = useMemo(() => {
    const out: Record<string, number> = {};
    const w = { minMs: minGapMs, maxMs: minGapMs };
    for (const i of queue.items) if (i.kind === "exit" && i.status === "queued" && i.meta?.legId) out[i.meta.legId] = windowOpensAt(queue, i, w);
    return out;
  }, [queue, minGapMs]);

  const sources = useMemo(
    () =>
      [...wallet.balances.entries()]
        .filter(([a]) => !busy.has(a.toLowerCase()))
        .map(([stealthAddress, amount]) => ({ stealthAddress, amount }))
        .sort((a, b) => (a.amount === b.amount ? 0 : a.amount < b.amount ? 1 : -1)),
    [wallet.balances, busy],
  );

  // Live fee quotes (Iris, the relayer, Sepolia gas), refreshed while the provider runs. Until one
  // arrives (or if every source fails) the planner uses the route's estimates, and says so.
  const [quote, setQuote] = useState<ExitQuoteState>({ status: "loading", quote: null });
  useEffect(() => {
    if (!service.ready || !service.config) return;
    let alive = true;
    const load = () =>
      service
        .quoteFees()
        .then((q) => {
          if (!alive) return;
          const n = Object.values(q.sources).filter(Boolean).length;
          setQuote({ status: n === 0 ? "estimate" : n === Object.keys(q.sources).length ? "live" : "partial", quote: q });
        })
        .catch(() => alive && setQuote((s) => (s.quote ? s : { status: "estimate", quote: null })));
    void load();
    const t = setInterval(() => void load(), EXIT_QUOTE_TTL_MS);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [service]);
  const live = quote.quote?.live;

  const estimate = useCallback(
    (selected: Address[], privacy: ExitPrivacy, via: ExitWithdrawVia = "relayer") => {
      if (!service.config) return null;
      const set = new Set(selected.map((a) => a.toLowerCase()));
      return estimateExit(
        sources.filter((s) => set.has(s.stealthAddress.toLowerCase())),
        service.config,
        { roundWithdrawals: privacy.roundWithdrawals, via, ...(live ? { live } : {}) },
      );
    },
    [service.config, sources, live],
  );

  const start = useCallback(
    async (input: StartExit): Promise<{ id: string } | { error: string }> => {
      if (!service.ready || !service.config) return { error: service.unavailableReason ?? "Exit isn't available." };
      const cfg = service.config;
      const via = input.withdrawVia ?? "relayer";
      const all = estimateExit(sources, cfg, { roundWithdrawals: input.privacy.roundWithdrawals, via, ...(live ? { live } : {}) });
      const err = validateExit({
        destination: input.destination,
        selected: input.sources,
        estimates: all.legs,
        ownAddresses: [...wallet.balances.keys(), ...state.matches.map((m) => m.stealthAddress)],
      });
      if (err) return { error: err };
      const destination = getAddress(input.destination.trim());
      const picked = new Set(input.sources.map((a) => a.toLowerCase()));
      const legSources = sources.filter((s) => picked.has(s.stealthAddress.toLowerCase()));
      try {
        let id = "";
        await write((d) => {
          const first = d.profile.nextExitPoolIndex ?? 0;
          const plan = service.planExit({
            sources: legSources,
            destination,
            firstPoolIndex: first,
            withdrawVia: via,
            roundWithdrawals: input.privacy.roundWithdrawals,
            ...(live ? { live } : {}),
          });
          const now = Date.now();
          id = `exit-${now.toString(36)}`;
          const record: ExitRecord = {
            id,
            createdAt: now,
            sourceChainId: cfg.source,
            destChainId: cfg.dest,
            destination,
            privacy: input.privacy,
            ...(via === "direct" ? { withdrawVia: via } : {}),
            legs: plan.legs.map(storeLeg),
            holdUntil: {},
          };
          const cs = chainState(d, chainId);
          const maxIndex = Math.max(first - 1, ...plan.legs.map((l) => l.poolIndex));
          // Each leg's deposit waits for its own timing-queue window (D-28), like a Send.
          const q = enqueueExitLegs(queueOf(cs), id, plan.legs, {
            now,
            window: queueWindow(settingsOf(d)),
            ...(random ? { random } : {}),
          });
          return {
            ...d,
            profile: { ...d.profile, nextExitPoolIndex: maxIndex + 1 },
            chains: { ...d.chains, [String(chainId)]: { ...cs, exits: [...(cs.exits ?? []), record], queue: q } },
          };
        });
        return { id };
      } catch (e) {
        return { error: errorMessage(e) };
      }
    },
    [service, sources, wallet.balances, state.matches, write, chainId, random, live],
  );

  const startNow = useCallback(
    async (exitId: string) => {
      await write((d) => {
        const cs = chainState(d, chainId);
        const q = queueOf(cs);
        const ids = q.items.filter((i) => i.kind === "exit" && i.meta?.exitId === exitId && i.status === "queued").map((i) => i.id);
        if (ids.length === 0) return d;
        const next = release(q, ids, { now: Date.now(), window: queueWindow(settingsOf(d)), ...(random ? { random } : {}) });
        return { ...d, chains: { ...d.chains, [String(chainId)]: { ...cs, queue: next } } };
      });
      await tick();
    },
    [write, chainId, random, tick],
  );

  const withdrawNow = useCallback(
    async (exitId: string, legId: string) => {
      await save(exitId, legId, { holdUntil: Date.now() });
      await tick();
    },
    [save, tick],
  );

  const withdrawDirect = useCallback(
    async (exitId: string, legId: string) => {
      const record = exitsOf(dataRef.current, chainId).find((r) => r.id === exitId);
      const stored = record?.legs.find((l) => l.id === legId);
      if (!record || !stored) return;
      const leg = loadLeg(stored);
      try {
        const sender = await connectDestinationWallet(record.destination, record.destChainId);
        const next = await service.withdrawDirect(leg, keysFor(leg), {
          destination: record.destination,
          roundWithdrawals: record.privacy.roundWithdrawals,
          persist: (l) => save(exitId, legId, { leg: storeLeg(l) }),
        }, sender);
        onError(legId, null);
        await save(exitId, legId, { leg: storeLeg(next) });
      } catch (e) {
        onError(legId, errorMessage(e));
      }
    },
    [chainId, service, keysFor, save, onError],
  );

  const retry = useCallback(
    async (exitId: string, legId: string) => {
      const record = exitsOf(dataRef.current, chainId).find((r) => r.id === exitId);
      const stored = record?.legs.find((l) => l.id === legId);
      if (!record || !stored) return;
      try {
        const next = await service.advance(loadLeg(stored), keysFor(loadLeg(stored)), {
          destination: record.destination,
          roundWithdrawals: record.privacy.roundWithdrawals,
          persist: (l) => save(exitId, legId, { leg: storeLeg(l) }),
        });
        onError(legId, null);
        await save(exitId, legId, { leg: storeLeg(next) });
      } catch (e) {
        onError(legId, errorMessage(e));
      }
    },
    [chainId, service, keysFor, save, onError],
  );

  const exits = useMemo<ExitView[]>(
    () =>
      [...records]
        .sort((a, b) => b.createdAt - a.createdAt)
        .map((record) => {
          const legs = record.legs.map(loadLeg);
          return { record, legs, finished: legs.every((l) => isTerminal(l.status)) };
        }),
    [records],
  );

  const api: ExitApi = {
    ready: service.ready,
    ...(service.unavailableReason ? { unavailableReason: service.unavailableReason } : {}),
    mock: service.mock,
    exits,
    busy,
    errors,
    sources,
    estimate,
    quote,
    start,
    withdrawNow,
    withdrawDirect,
    retry,
    tick,
    queuedAt,
    startNow,
  };
  return <ExitContext.Provider value={api}>{children}</ExitContext.Provider>;
}

export function useExit(): ExitApi {
  const x = useContext(ExitContext);
  if (!x) throw new Error("useExit outside ExitProvider");
  return x;
}
