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
import { isTerminal, loadLeg, storeLeg, type ExitLeg, type ExitPrivacy, type ExitRecord } from "../features/exit/types.js";
import { useServices } from "../services/ServicesProvider.js";
import { stealthKeyFor } from "../spend/flow.js";
import { errorMessage } from "../ui/kit.js";
import { useUnlocked } from "../vault/VaultProvider.js";
import { chainState, type VaultData } from "../vault/types.js";
import { useChain, useKeyRing } from "./useChain.js";
import { useWallet } from "./useWallet.js";

export const DEFAULT_PRIVACY: ExitPrivacy = { randomDelay: true, roundWithdrawals: true };

export type ExitView = { record: ExitRecord; legs: ExitLeg[]; finished: boolean };

export type StartExit = { sources: Address[]; destination: string; privacy: ExitPrivacy };

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
  estimate(selected: Address[], privacy: ExitPrivacy): ExitEstimate | null;
  start(input: StartExit): Promise<{ id: string } | { error: string }>;
  /** Skip the rest of the random delay and withdraw on the next tick. */
  withdrawNow(exitId: string, legId: string): Promise<void>;
  /** Re-run a failed leg's current step. */
  retry(exitId: string, legId: string): Promise<void>;
  /** Run one polling round now. */
  tick(): Promise<void>;
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

  const updateExits = useCallback(
    (fn: (r: ExitRecord[]) => ExitRecord[]) =>
      update((d) => {
        const cs = chainState(d, chainId);
        return { ...d, chains: { ...d.chains, [String(chainId)]: { ...cs, exits: fn(cs.exits ?? []) } } };
      }),
    [update, chainId],
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

  const tick = useCallback(async () => {
    if (!service.ready || running.current) return;
    running.current = true;
    try {
      await tickExits({
        records: exitsOf(dataRef.current, chainId),
        service,
        keysFor,
        now: Date.now,
        ...(random ? { random } : {}),
        save,
        onError,
      });
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

  const busy = useMemo(
    () => new Set(records.flatMap((r) => r.legs).filter((l) => l.status !== "failed").map((l) => l.stealthAddress.toLowerCase())),
    [records],
  );

  const sources = useMemo(
    () =>
      [...wallet.balances.entries()]
        .filter(([a]) => !busy.has(a.toLowerCase()))
        .map(([stealthAddress, amount]) => ({ stealthAddress, amount }))
        .sort((a, b) => (a.amount === b.amount ? 0 : a.amount < b.amount ? 1 : -1)),
    [wallet.balances, busy],
  );

  const estimate = useCallback(
    (selected: Address[], privacy: ExitPrivacy) => {
      if (!service.config) return null;
      const set = new Set(selected.map((a) => a.toLowerCase()));
      return estimateExit(
        sources.filter((s) => set.has(s.stealthAddress.toLowerCase())),
        service.config,
        { roundWithdrawals: privacy.roundWithdrawals },
      );
    },
    [service.config, sources],
  );

  const start = useCallback(
    async (input: StartExit): Promise<{ id: string } | { error: string }> => {
      if (!service.ready || !service.config) return { error: service.unavailableReason ?? "Exit isn't available." };
      const cfg = service.config;
      const all = estimateExit(sources, cfg, { roundWithdrawals: input.privacy.roundWithdrawals });
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
        await update((d) => {
          const first = d.profile.nextExitPoolIndex ?? 0;
          const plan = service.planExit({ sources: legSources, destination, firstPoolIndex: first });
          const now = Date.now();
          id = `exit-${now.toString(36)}`;
          const record: ExitRecord = {
            id,
            createdAt: now,
            sourceChainId: cfg.source,
            destChainId: cfg.dest,
            destination,
            privacy: input.privacy,
            legs: plan.legs.map(storeLeg),
            holdUntil: {},
          };
          const cs = chainState(d, chainId);
          const maxIndex = Math.max(first - 1, ...plan.legs.map((l) => l.poolIndex));
          return {
            ...d,
            profile: { ...d.profile, nextExitPoolIndex: maxIndex + 1 },
            chains: { ...d.chains, [String(chainId)]: { ...cs, exits: [...(cs.exits ?? []), record] } },
          };
        });
        return { id };
      } catch (e) {
        return { error: errorMessage(e) };
      }
    },
    [service, sources, wallet.balances, state.matches, update, chainId],
  );

  const withdrawNow = useCallback(
    async (exitId: string, legId: string) => {
      await save(exitId, legId, { holdUntil: Date.now() });
      await tick();
    },
    [save, tick],
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
    start,
    withdrawNow,
    retry,
    tick,
  };
  return <ExitContext.Provider value={api}>{children}</ExitContext.Provider>;
}

export function useExit(): ExitApi {
  const x = useContext(ExitContext);
  if (!x) throw new Error("useExit outside ExitProvider");
  return x;
}
