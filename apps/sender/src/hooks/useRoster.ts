// Roster actions: enroll (resolve once, pin), CSV import, re-verify every pin,
// explicit re-approval of a changed meta-address, pause, amount edits, and in dev
// mock mode a simulated key rotation. UI-agnostic.
import { useCallback, useState } from "react";
import { notAPayeeName, parseRosterCsv, normalizeEnsName, type CsvIssue } from "../lib/csv.js";
import { tryParseUsdc } from "../lib/amount.js";
import {
  describeResolveError,
  enrollEmployee,
  payability,
  reapproveChange,
  recordChanges,
  verifyRoster,
  type Employee,
  type Payability,
  type PinCheck,
} from "../lib/roster.js";
import { useStore } from "./store.js";

export type RosterRow = { employee: Employee; check: PinCheck | undefined; payability: Payability };

export type ImportResult = { added: number; issues: CsvIssue[] };

export type RosterState = {
  rows: RosterRow[];
  busy: boolean;
  error: string | null;
  verifyProgress: { done: number; total: number } | null;
  enroll(input: { ensName: string; amount: string; label?: string }): Promise<boolean>;
  importCsv(text: string): Promise<ImportResult>;
  verifyAll(): Promise<void>;
  reapprove(id: string): Promise<void>;
  setActive(id: string, active: boolean): Promise<void>;
  setAmount(id: string, amount: string): Promise<boolean>;
  remove(id: string): Promise<void>;
  /** Dev mock mode only: rotate the demo keys behind a name. */
  simulateRotation: ((ensName: string, attest: boolean) => Promise<void>) | null;
  clearError(): void;
};

export function useRoster(): RosterState {
  const { employees, updateEmployees, services } = useStore();
  const [checks, setChecks] = useState<Map<string, PinCheck>>(new Map());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [verifyProgress, setVerifyProgress] = useState<{ done: number; total: number } | null>(null);

  const guard = useCallback(async <T,>(fn: () => Promise<T>, fallback: T): Promise<T> => {
    setBusy(true);
    setError(null);
    try {
      return await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return fallback;
    } finally {
      setBusy(false);
    }
  }, []);

  const enroll = useCallback(
    (input: { ensName: string; amount: string; label?: string }) =>
      guard(async () => {
        const name = normalizeEnsName(input.ensName);
        if (!name) throw new Error(notAPayeeName(input.ensName));
        const amount = tryParseUsdc(input.amount);
        if (!amount.ok) throw new Error(amount.error);
        let e: Employee;
        try {
          e = await enrollEmployee(
            services.resolve,
            { ensName: name, amount: amount.value, ...(input.label?.trim() ? { label: input.label.trim() } : {}) },
            employees,
          );
        } catch (err) {
          if (err instanceof Error && err.name === "EnrollmentError") throw err;
          throw new Error(describeResolveError(err).message);
        }
        await updateEmployees((list) => [...list, e]);
        return true;
      }, false),
    [employees, guard, services.resolve, updateEmployees],
  );

  const importCsv = useCallback(
    (text: string) =>
      guard(async (): Promise<ImportResult> => {
        const { rows, issues } = parseRosterCsv(text);
        const added: Employee[] = [];
        const all = [...issues];
        for (const r of rows) {
          try {
            added.push(
              await enrollEmployee(services.resolve, { ensName: r.ensName, amount: r.amount, ...(r.label ? { label: r.label } : {}) }, [
                ...employees,
                ...added,
              ]),
            );
          } catch (err) {
            const msg = err instanceof Error && err.name === "EnrollmentError" ? err.message : describeResolveError(err).message;
            all.push({ line: r.line, message: `${r.ensName}: ${msg}` });
          }
        }
        if (added.length) await updateEmployees((list) => [...list, ...added]);
        return { added: added.length, issues: all.sort((a, b) => a.line - b.line) };
      }, { added: 0, issues: [] }),
    [employees, guard, services.resolve, updateEmployees],
  );

  const verifyAll = useCallback(
    () =>
      guard(async () => {
        setVerifyProgress({ done: 0, total: employees.length });
        const c = await verifyRoster(services.resolve, employees, { onProgress: (done, total) => setVerifyProgress({ done, total }) });
        const next = await recordChanges(employees, c, services.lookupAttestation);
        await updateEmployees(() => next);
        setChecks(c);
        setVerifyProgress(null);
      }, undefined),
    [employees, guard, services, updateEmployees],
  );

  const reapprove = useCallback(
    (id: string) =>
      guard(async () => {
        const e = employees.find((x) => x.id === id);
        if (!e) return;
        const next = await reapproveChange(services.resolve, e);
        await updateEmployees((list) => list.map((x) => (x.id === id ? next : x)));
        // The old check compared against the old pin; drop it so the row re-verifies.
        setChecks((m) => {
          const n = new Map(m);
          n.delete(id);
          return n;
        });
      }, undefined),
    [employees, guard, services.resolve, updateEmployees],
  );

  const setActive = useCallback(
    (id: string, active: boolean) => guard(() => updateEmployees((l) => l.map((e) => (e.id === id ? { ...e, active } : e))), undefined),
    [guard, updateEmployees],
  );

  const setAmount = useCallback(
    (id: string, amount: string) =>
      guard(async () => {
        const v = tryParseUsdc(amount);
        if (!v.ok) throw new Error(v.error);
        if (v.value === 0n) throw new Error("Amount must be more than 0");
        await updateEmployees((l) => l.map((e) => (e.id === id ? { ...e, amount: v.value } : e)));
        return true;
      }, false),
    [guard, updateEmployees],
  );

  const remove = useCallback(
    (id: string) => guard(() => updateEmployees((l) => l.filter((e) => e.id !== id)), undefined),
    [guard, updateEmployees],
  );

  const mock = services.mock;
  const simulateRotation = mock
    ? (ensName: string, attest: boolean) =>
        guard(async () => {
          await mock.rotate(ensName, attest);
        }, undefined)
    : null;

  return {
    rows: employees.map((e) => ({ employee: e, check: checks.get(e.id), payability: payability(e, checks.get(e.id)) })),
    busy,
    error,
    verifyProgress,
    enroll,
    importCsv,
    verifyAll,
    reapprove,
    setActive,
    setAmount,
    remove,
    simulateRotation,
    clearError: () => setError(null),
  };
}
