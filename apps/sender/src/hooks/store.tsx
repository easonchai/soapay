// App state: the encrypted vault (roster + run history), config and services, and the
// run controller that executes attempts and persists every step. UI-agnostic: pages
// read state and call actions; nothing here renders markup except the provider.
//
// Encrypted backup (D-62): the vault is locked with the wallet's signature by default and synced,
// encrypted, to the API under the wallet's address (lib/backup.ts), so logging in from a new or
// cleared browser restores it.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useAccount, useConfig } from "wagmi";
import { signMessage } from "wagmi/actions";
import type { Address } from "viem";
import { httpBackupClient, type BackupClient } from "@soapay/sdk";
import type { AppConfig } from "../config.js";
import { executeAttempt, normalizeInterrupted } from "../lib/execute.js";
import { runStatus, type RunPlan, type RunRecord, type RunStatus } from "../lib/run.js";
import type { Employee } from "../lib/roster.js";
import type { InvitedEmployee } from "../lib/invites.js";
import type { Services } from "../lib/services.js";
import { idbKV, probeWalletKey, Vault, VaultError, type KV, type VaultMode, type WalletSigner } from "../lib/vault.js";
import { backupNow, findBackup, readSync, writeSync, type BackupOutcome, type FoundBackup, type SyncState } from "../lib/backup.js";
import { wagmiExecDeps } from "../lib/wallet.js";
import { demoExecDeps, demoLedger } from "../lib/demoChain.js";
import { demoEmployees, demoRuns } from "../lib/demoSeed.js";
import { DEMO_WALLET } from "../lib/wagmi.js";

const ROSTER = "roster";
const RUNS = "runs";
const INVITES = "invites";

/** Bursts of important changes (a CSV enrolment, several invites) collapse into one wallet prompt. */
export const BACKUP_DEBOUNCE_MS = 2_000;
/**
 * Automatic backups cost a wallet prompt each, and the invite poller and "Resolve names" rewrite the
 * roster every few seconds (timestamps), so automatic backups run at most this often. Changes in
 * between stay "waiting" in Settings; "Back up now" is never throttled.
 */
export const AUTO_BACKUP_MIN_INTERVAL_MS = 10 * 60_000;

/** Structural equality for vault records (amounts are bigints, which JSON can't serialize by default). */
const sameRecords = (a: unknown, b: unknown) => {
  const enc = (v: unknown) => JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? `${x}n` : x));
  return enc(a) === enc(b);
};
/** A pay run is "recorded" once it reaches one of these. */
const RECORDED: readonly RunStatus[] = ["complete", "partial", "failed", "exported"];

/** "restore": no vault in this browser, but the connected wallet has an encrypted backup. */
export type VaultPhase = "loading" | "new" | "restore" | "locked" | "ready";

/** Whether the vault can be locked with the connected wallet's signature. */
export type WalletLock = "available" | "unavailable" | "hidden";

export type BackupState = {
  /** The API is configured and this isn't demo or dev-mock mode. */
  enabled: boolean;
  /** The vault's lock can be re-derived elsewhere (wallet or passphrase; not a device key). */
  supported: boolean;
  sync: SyncState;
  busy: boolean;
  /** The last attempt in this session. */
  last: BackupOutcome | null;
  /** navigator.storage.persisted(): null when unknown or unsupported. */
  persisted: boolean | null;
};

export type RestoreOffer = { mode: "wallet" | "passphrase"; version: number; updatedAt: number; address: Address };

export type Store = {
  app: AppConfig;
  services: Services;
  phase: VaultPhase;
  vaultMode: VaultMode | null;
  walletLock: WalletLock;
  /** Set in the "restore" phase. */
  restoreOffer: RestoreOffer | null;
  /** A failed backup lookup on an empty browser (the gate shows it; creating a vault still works). */
  restoreCheckError: string | null;
  employees: Employee[];
  /** Pending invites (docs/mvp-spec.md §7), codes included; vault only. */
  invites: InvitedEmployee[];
  runs: RunRecord[];
  /** Run ids with an attempt executing in this tab. */
  executing: ReadonlySet<string>;
  backup: BackupState;
  createVault(mode: VaultMode, passphrase?: string): Promise<void>;
  unlock(passphrase?: string): Promise<void>;
  /** Restores the found backup (wallet signature, or the passphrase for a passphrase vault). */
  restore(passphrase?: string): Promise<void>;
  /** Ignore the found backup and set up a new vault (its first backup replaces the old one). */
  startFresh(): void;
  /** One backup now (one wallet prompt). Replaces a newer backup only after a reported conflict. */
  backupNow(): Promise<BackupOutcome>;
  /** Device-key vault → wallet-signature lock, so it can be backed up. */
  enableWalletLock(): Promise<void>;
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

/** Demo and dev-mock wallets can't sign, and those modes never call the API. */
function realWallets(app: AppConfig): boolean {
  return !app.demo && !app.mockEns;
}

const NOT_DETERMINISTIC =
  "Your wallet signs differently each time (typical of passkey smart wallets), so it can't lock the vault. " +
  "Choose a passphrase instead: your data is still backed up, and restoring it in another browser asks for the passphrase.";

export function StoreProvider(props: {
  app: AppConfig;
  services: Services;
  kv?: KV;
  /** Test seam: the backup API client (null = off). Default: the API at VITE_API_URL, off in demo/mock. */
  backupClient?: BackupClient | null;
  /** Test seam: the wallet signer (null = none). Default: the connected wagmi account. */
  signer?: WalletSigner | null;
  children: ReactNode;
}) {
  const { app, services } = props;
  // Demo mode keeps its vault in a separate IndexedDB database, so sample data never mixes with a real roster.
  const kv = useMemo(() => props.kv ?? (app.demo ? idbKV("soapay-sender-demo") : idbKV()), [props.kv, app.demo]);
  const wagmiConfig = useConfig();
  const { address } = useAccount();
  const client = useMemo<BackupClient | null>(
    () => (props.backupClient !== undefined ? props.backupClient : realWallets(app) && app.apiUrl ? httpBackupClient(app.apiUrl) : null),
    [props.backupClient, app],
  );
  const wagmiSigner = useMemo<WalletSigner | null>(
    () => (address && realWallets(app) ? { address, signMessage: (message) => signMessage(wagmiConfig, { account: address, message }) } : null),
    [address, app, wagmiConfig],
  );
  const signer = props.signer !== undefined ? props.signer : wagmiSigner;
  const signerRef = useRef(signer);
  signerRef.current = signer;
  const walletAddress = signer?.address;

  const [phase, setPhase] = useState<VaultPhase>("loading");
  const [vaultMode, setVaultMode] = useState<VaultMode | null>(null);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [invites, setInvites] = useState<InvitedEmployee[]>([]);
  const [runs, setRuns] = useState<RunRecord[]>([]);
  const [executing, setExecuting] = useState<ReadonlySet<string>>(new Set());
  const [found, setFound] = useState<FoundBackup | null>(null);
  const [restoreCheckError, setRestoreCheckError] = useState<string | null>(null);
  const [nonDeterministic, setNonDeterministic] = useState(false);
  const [sync, setSync] = useState<SyncState>({ version: 0, dirty: false });
  const [busy, setBusy] = useState(false);
  const [last, setLast] = useState<BackupOutcome | null>(null);
  const [persisted, setPersisted] = useState<boolean | null>(null);

  const vault = useRef<Vault | null>(null);
  const employeesRef = useRef<Employee[]>([]);
  const invitesRef = useRef<InvitedEmployee[]>([]);
  const runsRef = useRef<RunRecord[]>([]);
  const dirtyRef = useRef(false);
  const lastRef = useRef<BackupOutcome | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pendingBackup = useRef(false);
  /** When the last automatic backup started (ms); throttles AUTO_BACKUP_MIN_INTERVAL_MS. */
  const lastAutoBackup = useRef(0);
  const executingCount = useRef(0);
  const persistAsked = useRef(false);
  // Serialize writes so an older snapshot never lands after a newer one.
  const writes = useRef<Promise<void>>(Promise.resolve());

  const backupOn = !!client;
  const persist = useCallback(
    (slot: string, value: unknown) => {
      const v = vault.current;
      if (!v) return Promise.reject(new VaultError("NoVault", "The vault is locked"));
      const next = writes.current.then(async () => {
        await v.write(slot, value);
        // Remember that something isn't backed up yet (shown in Settings, survives reloads).
        if (backupOn && v.syncable && !dirtyRef.current) {
          dirtyRef.current = true;
          setSync(await writeSync(kv, { dirty: true }));
        }
      });
      writes.current = next.catch(() => undefined);
      return next;
    },
    [backupOn, kv],
  );

  // What's in this browser, and (when empty) whether the connected wallet has a backup.
  useEffect(() => {
    let live = true;
    void (async () => {
      const s = await Vault.status(kv);
      if (!live) return;
      if (s.exists) {
        setVaultMode(s.mode);
        setPhase((p) => (p === "ready" ? p : "locked"));
        return;
      }
      if (vault.current) return;
      setRestoreCheckError(null);
      if (client && walletAddress) {
        setPhase("loading");
        try {
          const b = await findBackup(client, walletAddress);
          if (!live) return;
          if (b) {
            setFound(b);
            setPhase("restore");
            return;
          }
        } catch (e) {
          if (!live) return;
          setRestoreCheckError(`Couldn't check for a backup of this wallet: ${(e as Error).message}`);
        }
      }
      setFound(null);
      setPhase("new");
    })().catch(() => live && setPhase("new"));
    return () => {
      live = false;
    };
  }, [kv, client, walletAddress]);

  const askPersistence = useCallback(() => {
    if (persistAsked.current) return;
    persistAsked.current = true;
    const storage = typeof navigator !== "undefined" ? navigator.storage : undefined;
    if (!storage?.persist) return;
    // Best effort: ask the browser not to evict the vault under storage pressure.
    void (async () => {
      try {
        const already = storage.persisted ? await storage.persisted() : false;
        setPersisted(already || (await storage.persist()));
      } catch {
        setPersisted(null);
      }
    })();
  }, []);

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
      const s = await readSync(kv);
      dirtyRef.current = s.dirty;
      setSync(s);
      setFound(null);
      setVaultMode(v.mode);
      setPhase("ready");
      askPersistence();
    },
    [app, kv, askPersistence],
  );

  const setOutcome = useCallback((o: BackupOutcome) => {
    lastRef.current = o;
    setLast(o);
  }, []);

  const runBackup = useCallback(
    async (replace: boolean): Promise<BackupOutcome> => {
      const v = vault.current;
      if (!client || !v) return { status: "error", message: "Backups are off" };
      pendingBackup.current = false;
      clearTimeout(timer.current);
      setBusy(true);
      try {
        await writes.current;
        const out = await backupNow({ vault: v, kv, client, signer: signerRef.current, replace });
        if (vault.current === v) {
          if (out.status === "saved") dirtyRef.current = false;
          setSync(await readSync(kv));
          setOutcome(out);
        }
        return out;
      } finally {
        setBusy(false);
      }
    },
    [client, kv, setOutcome],
  );

  /** Queue one backup (debounced); held while a pay run executes, so its prompts aren't interleaved. */
  const scheduleBackup = useCallback(() => {
    if (!client || !vault.current?.syncable) return;
    pendingBackup.current = true;
    clearTimeout(timer.current);
    const wait = Math.max(BACKUP_DEBOUNCE_MS, lastAutoBackup.current + AUTO_BACKUP_MIN_INTERVAL_MS - Date.now());
    timer.current = setTimeout(() => {
      if (executingCount.current > 0) return; // executeRun re-schedules when it finishes
      lastAutoBackup.current = Date.now();
      void runBackup(false);
    }, wait);
  }, [client, runBackup]);

  useEffect(() => () => clearTimeout(timer.current), []);

  /** New vaults sync to the connected wallet; after "Start fresh" the next backup replaces the old one. */
  const seedSync = useCallback(
    async (remoteVersion: number | undefined) => {
      await writeSync(kv, {
        ...(walletAddress ? { owner: walletAddress } : {}),
        version: remoteVersion ?? 0,
        dirty: false,
      });
    },
    [kv, walletAddress],
  );

  const createVault = useCallback(
    async (mode: VaultMode, passphrase?: string) => {
      let v: Vault;
      if (mode === "wallet") {
        const s = signerRef.current;
        if (!s) throw new VaultError("NoWallet", "Connect your wallet to lock the vault with it");
        // Sign twice: only a wallet that signs the same way every time can re-derive the key.
        const probe = await probeWalletKey(s, app.chainId);
        if (!probe.deterministic) {
          setNonDeterministic(true);
          throw new VaultError("NotDeterministic", NOT_DETERMINISTIC);
        }
        v = await Vault.create(kv, "wallet", undefined, { wallet: { address: s.address, chainId: app.chainId, signature: probe.signature } });
      } else {
        v = await Vault.create(kv, mode, passphrase);
      }
      let remoteVersion = found?.version;
      if (remoteVersion === undefined && client && walletAddress) remoteVersion = (await client.get(walletAddress).catch(() => null))?.version;
      await seedSync(remoteVersion);
      await load(v);
    },
    [app.chainId, kv, found, client, walletAddress, seedSync, load],
  );

  const unlock = useCallback(
    async (passphrase?: string) => {
      const s = await Vault.status(kv);
      await load(await Vault.unlock(kv, s.exists && s.mode === "wallet" ? (signerRef.current ?? undefined) : passphrase));
    },
    [kv, load],
  );

  const restore = useCallback(
    async (passphrase?: string) => {
      if (!found) throw new VaultError("NoVault", "No backup to restore");
      const v = await Vault.restore(kv, found.ciphertext, found.info.mode === "wallet" ? (signerRef.current ?? undefined) : passphrase);
      await writeSync(kv, { owner: found.address, version: found.version, lastBackupAt: found.updatedAt * 1000, dirty: false });
      await load(v);
    },
    [kv, found, load],
  );

  const startFresh = useCallback(() => setPhase("new"), []);

  const enableWalletLock = useCallback(async () => {
    const v = vault.current;
    const s = signerRef.current;
    if (!v) throw new VaultError("NoVault", "The vault is locked");
    if (!s) throw new VaultError("NoWallet", "Connect your wallet first");
    const probe = await probeWalletKey(s, app.chainId);
    if (!probe.deterministic) {
      setNonDeterministic(true);
      throw new VaultError("NotDeterministic", NOT_DETERMINISTIC);
    }
    await writes.current;
    const next = await v.rekey("wallet", undefined, { wallet: { address: s.address, chainId: app.chainId, signature: probe.signature } });
    vault.current = next;
    setVaultMode("wallet");
    const cur = await readSync(kv);
    let remoteVersion = cur.version;
    if (client) remoteVersion = Math.max(remoteVersion, (await client.get(s.address).catch(() => null))?.version ?? 0);
    setSync(await writeSync(kv, { owner: s.address, version: remoteVersion, dirty: true }));
    dirtyRef.current = true;
    scheduleBackup();
  }, [app.chainId, kv, client, scheduleBackup]);

  const lock = useCallback(() => {
    clearTimeout(timer.current);
    pendingBackup.current = false;
    vault.current = null;
    employeesRef.current = [];
    invitesRef.current = [];
    runsRef.current = [];
    setEmployees([]);
    setInvites([]);
    setRuns([]);
    setLast(null);
    setPhase("locked");
  }, []);
  const destroyVault = useCallback(async () => {
    clearTimeout(timer.current);
    pendingBackup.current = false;
    vault.current = null;
    await Vault.destroy(kv);
    setEmployees([]);
    setInvites([]);
    setRuns([]);
    setVaultMode(null);
    setSync({ version: 0, dirty: false });
    setLast(null);
    setPhase("new");
  }, [kv]);

  const updateEmployees = useCallback(
    async (fn: (e: Employee[]) => Employee[]) => {
      const prev = employeesRef.current;
      const next = fn(prev);
      if (sameRecords(next, prev)) return;
      employeesRef.current = next;
      setEmployees(next);
      await persist(ROSTER, next);
      // Enrolled, re-pinned or edited recipients: an important moment to back up.
      scheduleBackup();
    },
    [persist, scheduleBackup],
  );

  const updateInvites = useCallback(
    async (fn: (i: InvitedEmployee[]) => InvitedEmployee[]) => {
      const prev = invitesRef.current;
      const next = fn(prev);
      if (sameRecords(next, prev)) return;
      invitesRef.current = next;
      setInvites(next);
      await persist(INVITES, next);
      scheduleBackup();
    },
    [persist, scheduleBackup],
  );

  const upsertRun = useCallback(
    async (run: RunRecord) => {
      const cur = runsRef.current;
      const prev = cur.find((r) => r.id === run.id);
      const next = prev ? cur.map((r) => (r.id === run.id ? run : r)) : [run, ...cur];
      runsRef.current = next;
      setRuns(next);
      await persist(RUNS, next);
      // A pay run was recorded (reached a final state): back up once, not on every step.
      const status = runStatus(run);
      if (RECORDED.includes(status) && (!prev || runStatus(prev) !== status)) scheduleBackup();
    },
    [persist, scheduleBackup],
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
      executingCount.current++;
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
        executingCount.current--;
        if (executingCount.current === 0 && pendingBackup.current) scheduleBackup();
        setExecuting((s) => {
          const n = new Set(s);
          n.delete(run.id);
          return n;
        });
      }
    },
    [app, commitCarry, upsertRun, wagmiConfig, scheduleBackup],
  );

  const walletLock: WalletLock = !realWallets(app) || !signer ? "hidden" : nonDeterministic ? "unavailable" : "available";
  const restoreOffer: RestoreOffer | null =
    phase === "restore" && found ? { mode: found.info.mode, version: found.version, updatedAt: found.updatedAt, address: found.address } : null;

  const value: Store = {
    app,
    services,
    phase,
    vaultMode,
    walletLock,
    restoreOffer,
    restoreCheckError,
    employees,
    invites,
    runs,
    executing,
    backup: { enabled: backupOn, supported: vaultMode !== null && vaultMode !== "device", sync, busy, last, persisted },
    createVault,
    unlock,
    restore,
    startFresh,
    backupNow: () => runBackup(lastRef.current?.status === "conflict"),
    enableWalletLock,
    lock,
    destroyVault,
    updateEmployees,
    updateInvites,
    upsertRun,
    executeRun,
  };
  return <Ctx.Provider value={value}>{props.children}</Ctx.Provider>;
}
