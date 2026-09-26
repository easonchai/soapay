// App state: the encrypted vault (roster + run history), config and services, and the
// run controller that executes attempts and persists every step. UI-agnostic: pages
// read state and call actions; nothing here renders markup except the provider.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useConfig } from "wagmi";
import type { Address } from "viem";
import type { AppConfig } from "../config.js";
import { executeAttempt, normalizeInterrupted } from "../lib/execute.js";
import { runStatus, type RunPlan, type RunRecord } from "../lib/run.js";
import type { Employee } from "../lib/roster.js";
import type { InvitedEmployee } from "../lib/invites.js";
import type { Services } from "../lib/services.js";
import { idbKV, Vault, VaultError, type KV, type VaultMode } from "../lib/vault.js";
import { wagmiExecDeps } from "../lib/wallet.js";
import { demoExecDeps, demoLedger } from "../lib/demoChain.js";
import { demoEmployees, demoRuns } from "../lib/demoSeed.js";
import { DEMO_WALLET } from "../lib/wagmi.js";

const ROSTER = "roster";
const RUNS = "runs";
const INVITES = "invites";

export type VaultPhase = "loading" | "new" | "locked" | "ready";

export type Store = {
  app: AppConfig;
  services: Services;
  phase: VaultPhase;
  vaultMode: VaultMode | null;
  employees: Employee[];
  /** Pending invites (docs/mvp-spec.md §7), codes included; vault only. */
  invites: InvitedEmployee[];
  runs: RunRecord[];
  /** Run ids with an attempt executing in this tab. */
  executing: ReadonlySet<string>;
  createVault(mode: VaultMode, passphrase?: string): Promise<void>;
  unlock(passphrase?: string): Promise<void>;
  lock(): void;
  destroyVault(): Promise<void>;
  updateEmployees(fn: (e: Employee[]) => Employee[]): Promise<void>;
  updateInvites(fn: (i: InvitedEmployee[]) => InvitedEmployee[]): Promise<void>;
  upsertRun(run: RunRecord): Promise<void>;
  /** Executes one attempt; resolves when it stops (landed, failed or unknown). */
  executeRun(run: RunRecord, attemptIndex: number, plan: RunPlan, payer: Address): Promise<RunRecord>;
};

const Ctx = createContext<Store | null>(null);

export function useStore(): Store {
  const s = useContext(Ctx);
  if (!s) throw new Error("useStore outside StoreProvider");
  return s;
}

export function StoreProvider(props: { app: AppConfig; services: Services; kv?: KV; children: ReactNode }) {
  const { app, services } = props;
  // Demo mode keeps its vault in a separate IndexedDB database, so sample data never mixes with a real roster.
  const kv = useMemo(() => props.kv ?? (app.demo ? idbKV("soapay-sender-demo") : idbKV()), [props.kv, app.demo]);
  const wagmiConfig = useConfig();
  const [phase, setPhase] = useState<VaultPhase>("loading");
  const [vaultMode, setVaultMode] = useState<VaultMode | null>(null);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [invites, setInvites] = useState<InvitedEmployee[]>([]);
  const [runs, setRuns] = useState<RunRecord[]>([]);
  const [executing, setExecuting] = useState<ReadonlySet<string>>(new Set());

  const vault = useRef<Vault | null>(null);
  const employeesRef = useRef<Employee[]>([]);
  const invitesRef = useRef<InvitedEmployee[]>([]);
  const runsRef = useRef<RunRecord[]>([]);
  // Serialize writes so an older snapshot never lands after a newer one.
  const writes = useRef<Promise<void>>(Promise.resolve());
  const persist = useCallback((slot: string, value: unknown) => {
    const v = vault.current;
    if (!v) return Promise.reject(new VaultError("NoVault", "The vault is locked"));
    const next = writes.current.then(() => v.write(slot, value));
    writes.current = next.catch(() => undefined);
    return next;
  }, []);

  useEffect(() => {
    Vault.status(kv)
      .then((s) => {
        setVaultMode(s.exists ? s.mode : null);
        setPhase(s.exists ? "locked" : "new");
      })
      .catch(() => setPhase("new"));
  }, [kv]);

  const load = useCallback(
    async (v: Vault) => {
      vault.current = v;
      const roster = (await v.read<Employee[]>(ROSTER)) ?? [];
      const inv = (await v.read<InvitedEmployee[]>(INVITES)) ?? [];
      // After a reload nothing executes: in-flight steps become "unknown" (recheck them).
      let stored = ((await v.read<RunRecord[]>(RUNS)) ?? []).map(normalizeInterrupted);
      // Demo: an empty vault is seeded with sample employees and two completed payrolls.
      if (app.demo && roster.length === 0 && stored.length === 0) {
        roster.push(...demoEmployees());
        stored = demoRuns(app, roster, DEMO_WALLET, demoLedger);
        await v.write(ROSTER, roster);
      }
      employeesRef.current = roster;
      invitesRef.current = inv;
      runsRef.current = stored;
      setEmployees(roster);
      setInvites(inv);
      setRuns(stored);
      await v.write(RUNS, stored);
      setVaultMode(v.mode);
      setPhase("ready");
    },
    [app],
  );

  const createVault = useCallback(async (mode: VaultMode, passphrase?: string) => load(await Vault.create(kv, mode, passphrase)), [kv, load]);
  const unlock = useCallback(async (passphrase?: string) => load(await Vault.unlock(kv, passphrase)), [kv, load]);
  const lock = useCallback(() => {
    vault.current = null;
    employeesRef.current = [];
    invitesRef.current = [];
    runsRef.current = [];
    setEmployees([]);
    setInvites([]);
    setRuns([]);
    setPhase("locked");
  }, []);
  const destroyVault = useCallback(async () => {
    vault.current = null;
    await Vault.destroy(kv);
    setEmployees([]);
    setInvites([]);
    setRuns([]);
    setVaultMode(null);
    setPhase("new");
  }, [kv]);

  const updateEmployees = useCallback(
    async (fn: (e: Employee[]) => Employee[]) => {
      const next = fn(employeesRef.current);
      employeesRef.current = next;
      setEmployees(next);
      await persist(ROSTER, next);
    },
    [persist],
  );

  const updateInvites = useCallback(
    async (fn: (i: InvitedEmployee[]) => InvitedEmployee[]) => {
      const next = fn(invitesRef.current);
      invitesRef.current = next;
      setInvites(next);
      await persist(INVITES, next);
    },
    [persist],
  );

  const upsertRun = useCallback(
    async (run: RunRecord) => {
      const cur = runsRef.current;
      const next = cur.some((r) => r.id === run.id) ? cur.map((r) => (r.id === run.id ? run : r)) : [run, ...cur];
      runsRef.current = next;
      setRuns(next);
      await persist(RUNS, next);
    },
    [persist],
  );

  const commitCarry = useCallback(
    async (run: RunRecord) => {
      if (run.carryCommitted || run.denomination?.mode !== "carry" || runStatus(run) !== "complete") return run;
      await updateEmployees((list) => list.map((e) => (e.id in run.carryOut ? { ...e, carry: run.carryOut[e.id]! } : e)));
      const done = { ...run, carryCommitted: true };
      await upsertRun(done);
      return done;
    },
    [updateEmployees, upsertRun],
  );

  const executeRun = useCallback(
    async (run: RunRecord, attemptIndex: number, plan: RunPlan, payer: Address) => {
      setExecuting((s) => new Set(s).add(run.id));
      try {
        await upsertRun(run);
        const final = await executeAttempt({
          run,
          attemptIndex,
          plan,
          payer,
          deps: app.demo
            ? demoExecDeps({ usdc: app.usdc, chunks: run.attempts.find((a) => a.index === attemptIndex)?.chunks ?? [] })
            : wagmiExecDeps(wagmiConfig, app),
          onChange: (r) => void upsertRun(r),
        });
        await upsertRun(final);
        return await commitCarry(final);
      } finally {
        setExecuting((s) => {
          const n = new Set(s);
          n.delete(run.id);
          return n;
        });
      }
    },
    [app, commitCarry, upsertRun, wagmiConfig],
  );

  const value: Store = {
    app,
    services,
    phase,
    vaultMode,
    employees,
    invites,
    runs,
    executing,
    createVault,
    unlock,
    lock,
    destroyVault,
    updateEmployees,
    updateInvites,
    upsertRun,
    executeRun,
  };
  return <Ctx.Provider value={value}>{props.children}</Ctx.Provider>;
}
