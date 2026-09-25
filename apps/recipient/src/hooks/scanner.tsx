import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ScanAborted } from "../scan/pool.js";
import { mergeScanResult, runScan, type ScanOutcome, type ScanPhase } from "../scan/scanner.js";
import { useServices } from "../services/ServicesProvider.js";
import { errorMessage } from "../ui/kit.js";
import { useChain, useScanKeys } from "./useChain.js";

export type ScannerApi = {
  running: boolean;
  phase: ScanPhase | null;
  error: string | null;
  last: (Omit<ScanOutcome, "state"> & { at: number }) | null;
  /** Incremental scan from the last scanned block. `full` rebuilds from the Announcer deploy block. */
  scan(opts?: { full?: boolean }): Promise<void>;
  cancel(): void;
};

const ScannerContext = createContext<ScannerApi | null>(null);

/**
 * Owns the one scan that may run at a time. Scans once on mount (i.e. on unlock), then on demand.
 * Results are folded into the latest vault state (mergeScanResult), so labels and spends made while
 * the scan ran are kept.
 */
export function ScannerProvider({ children, autoScan = true }: { children: ReactNode; autoScan?: boolean }) {
  const svc = useServices();
  const { chainId, settings, state, updateChain } = useChain();
  const keys = useScanKeys();
  const [running, setRunning] = useState(false);
  const [phase, setPhase] = useState<ScanPhase | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [last, setLast] = useState<ScannerApi["last"]>(null);
  const abort = useRef<AbortController | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;

  const scan = useCallback(
    async (opts: { full?: boolean } = {}) => {
      // One live scan at a time. An aborted one (e.g. StrictMode's effect re-run) doesn't block a new one.
      if (abort.current && !abort.current.signal.aborted) return;
      const ctrl = new AbortController();
      abort.current = ctrl;
      setRunning(true);
      setError(null);
      try {
        const outcome = await runScan(
          stateRef.current,
          {
            chainId,
            apiUrl: settings.apiUrl,
            useRpc: settings.useRpcAnnouncements,
            fetch: svc.fetch,
            client: svc.client,
            pool: svc.pool,
            keys,
            signal: ctrl.signal,
            onPhase: setPhase,
          },
          opts,
        );
        if (ctrl.signal.aborted) return;
        await updateChain((latest) => mergeScanResult(latest, outcome.state));
        const { state: _s, ...rest } = outcome;
        setLast({ ...rest, at: Date.now() });
        if (outcome.balanceError) setError(`Balances not refreshed: ${outcome.balanceError}`);
      } catch (e) {
        if (!(e instanceof ScanAborted) && !(e instanceof DOMException && e.name === "AbortError")) setError(errorMessage(e));
      } finally {
        if (abort.current === ctrl) {
          abort.current = null;
          setRunning(false);
          setPhase(null);
        }
      }
    },
    [chainId, settings.apiUrl, settings.useRpcAnnouncements, svc, keys, updateChain],
  );

  const cancel = useCallback(() => abort.current?.abort(), []);

  useEffect(() => {
    if (autoScan) void scan();
    return () => abort.current?.abort();
    // Scan once per provider mount (unlock) and when the key set or chain changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoScan, chainId, keys]);

  const api = useMemo<ScannerApi>(() => ({ running, phase, error, last, scan, cancel }), [running, phase, error, last, scan, cancel]);
  return <ScannerContext.Provider value={api}>{children}</ScannerContext.Provider>;
}

export function useScanner(): ScannerApi {
  const s = useContext(ScannerContext);
  if (!s) throw new Error("useScanner outside ScannerProvider");
  return s;
}

/** One-line description of a scan phase, for any UI. */
export function describePhase(p: ScanPhase | null): string {
  if (!p) return "";
  switch (p.phase) {
    case "head":
      return "Reading the chain head…";
    case "fetching":
      return `Fetching announcements (${p.fetched.toLocaleString()}, ${p.detail})`;
    case "scanning":
      return `Checking ${p.progress.scanned.toLocaleString()} of ${p.progress.total.toLocaleString()} announcements`;
    case "balances":
      return `Reading balances of ${p.addresses} address${p.addresses === 1 ? "" : "es"}`;
    case "done":
      return "Done";
  }
}
