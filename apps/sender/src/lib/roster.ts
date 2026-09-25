// Enrollment and pin checks (CLAUDE.md threat model: ENS is only a reference
// identifier). A name is resolved ONCE at enrollment and its ERC-6538 meta-address
// is pinned. Before every run the name is re-resolved; if it now points elsewhere
// the employee's line is BLOCKED until the employer explicitly re-approves.
// Stealth addresses are never stored for reuse: each run derives fresh ones.
import type { Address } from "viem";
import { pinnedMetaChanged, SoapayNameError, type ResolvedStealthMeta } from "@soapay/sdk";
import type { WorldIdLookup, WorldIdStatus } from "./worldid.js";

export type Resolver = (ensName: string) => Promise<ResolvedStealthMeta>;

export type PinEvent = {
  metaAddressURI: string;
  registrant: Address;
  at: number;
  reason: "enrolled" | "re-approved";
  worldId?: WorldIdStatus;
};

export type PendingChange = {
  metaAddressURI: string;
  registrant: Address;
  detectedAt: number;
  worldId: WorldIdStatus;
};

export type Employee = {
  id: string;
  /** Normalized ENS name. */
  ensName: string;
  label?: string;
  /** Salary per run, USDC base units. */
  amount: bigint;
  /** Pinned at enrollment (or last explicit re-approval). The only meta-address ever paid. */
  pin: { metaAddressURI: string; registrant: Address; pinnedAt: number };
  /** Set when a re-resolve returned a different meta-address; blocks payment. */
  pendingChange?: PendingChange;
  pinHistory: PinEvent[];
  /** Carry-mode denomination balance, base units (positive = still owed). */
  carry: bigint;
  active: boolean;
};

export type PinCheck =
  | { status: "ok"; resolved: ResolvedStealthMeta; checkedAt: number }
  | { status: "changed"; resolved: ResolvedStealthMeta; checkedAt: number }
  | { status: "error"; code: string; message: string; checkedAt: number };

export class EnrollmentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EnrollmentError";
  }
}

export function describeResolveError(e: unknown): { code: string; message: string } {
  if (e instanceof SoapayNameError) {
    const msg: Record<string, string> = {
      NameNotFound: "No Soapay records on this name. Ask the employee to finish onboarding.",
      NotRegistered: "The name's registrant has no stealth keys in the ERC-6538 registry.",
      MetaMismatch: "The name's stealth record disagrees with the ERC-6538 registry. Don't pay until this is fixed.",
    };
    return { code: e.code, message: msg[e.code] ?? e.message };
  }
  const m = e instanceof Error ? e.message : String(e);
  return { code: "Network", message: `Couldn't resolve the name: ${m.split("\n")[0]}` };
}

function newId(): string {
  return crypto.randomUUID();
}

/** Resolves once and pins. Rejects names already on the roster. */
export async function enrollEmployee(
  resolve: Resolver,
  input: { ensName: string; amount: bigint; label?: string },
  roster: readonly Employee[],
  now = Date.now(),
): Promise<Employee> {
  if (input.amount <= 0n) throw new EnrollmentError("Amount must be more than 0");
  if (roster.some((e) => e.ensName === input.ensName)) {
    throw new EnrollmentError(`${input.ensName} is already on the roster`);
  }
  const resolved = await resolve(input.ensName);
  return {
    id: newId(),
    ensName: input.ensName,
    ...(input.label ? { label: input.label } : {}),
    amount: input.amount,
    pin: { metaAddressURI: resolved.metaAddressURI, registrant: resolved.registrant, pinnedAt: now },
    pinHistory: [{ metaAddressURI: resolved.metaAddressURI, registrant: resolved.registrant, at: now, reason: "enrolled" }],
    carry: 0n,
    active: true,
  };
}

export async function checkPin(resolve: Resolver, e: Employee, now = Date.now()): Promise<PinCheck> {
  try {
    const resolved = await resolve(e.ensName);
    return {
      status: pinnedMetaChanged(e.pin.metaAddressURI, resolved.metaAddressURI) ? "changed" : "ok",
      resolved,
      checkedAt: now,
    };
  } catch (err) {
    return { status: "error", ...describeResolveError(err), checkedAt: now };
  }
}

/** Re-resolves every employee with bounded concurrency. */
export async function verifyRoster(
  resolve: Resolver,
  employees: readonly Employee[],
  opts: { concurrency?: number; onProgress?: (done: number, total: number) => void; now?: number } = {},
): Promise<Map<string, PinCheck>> {
  const out = new Map<string, PinCheck>();
  const queue = [...employees];
  let done = 0;
  const worker = async () => {
    for (let e = queue.shift(); e; e = queue.shift()) {
      out.set(e.id, await checkPin(resolve, e, opts.now));
      opts.onProgress?.(++done, employees.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(opts.concurrency ?? 4, employees.length) }, worker));
  return out;
}

/**
 * Records detected changes on the roster (so the warning persists across reloads).
 * A change to yet another meta-address replaces the pending one and resets its World ID state.
 */
export async function recordChanges(
  employees: readonly Employee[],
  checks: ReadonlyMap<string, PinCheck>,
  lookup: WorldIdLookup,
  now = Date.now(),
): Promise<Employee[]> {
  return Promise.all(
    employees.map(async (e) => {
      const c = checks.get(e.id);
      if (c?.status !== "changed") return e;
      if (e.pendingChange && !pinnedMetaChanged(e.pendingChange.metaAddressURI, c.resolved.metaAddressURI)) {
        return e;
      }
      const worldId = await lookup({ ensName: e.ensName, metaAddressURI: c.resolved.metaAddressURI }).catch(
        (): WorldIdStatus => ({ state: "unknown" }),
      );
      return {
        ...e,
        pendingChange: {
          metaAddressURI: c.resolved.metaAddressURI,
          registrant: c.resolved.registrant,
          detectedAt: now,
          worldId,
        },
      };
    }),
  );
}

export type Payability = { payable: true } | { payable: false; reason: "inactive" | "unchecked" | "changed" | "error"; message: string };

/** The run gate. Only a fresh "ok" check against the pin, with no unresolved change, pays. */
export function payability(e: Employee, check: PinCheck | undefined): Payability {
  if (!e.active) return { payable: false, reason: "inactive", message: "Paused on the roster" };
  if (e.pendingChange || check?.status === "changed") {
    return {
      payable: false,
      reason: "changed",
      message: "Meta-address changed since enrollment: possible salary redirect. Re-approve to pay.",
    };
  }
  if (!check) return { payable: false, reason: "unchecked", message: "Not re-verified for this run" };
  if (check.status === "error") return { payable: false, reason: "error", message: check.message };
  return { payable: true };
}

export class ReapprovalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReapprovalError";
  }
}

/**
 * Explicit employer re-approval of a pending change. Re-resolves first and only pins
 * the exact meta-address the employer reviewed; if the name moved again, it refuses.
 * If the name points back to the old pin, the warning is cleared and the pin kept.
 */
export async function reapproveChange(resolve: Resolver, e: Employee, now = Date.now()): Promise<Employee> {
  const pending = e.pendingChange;
  if (!pending) throw new ReapprovalError("Nothing to re-approve");
  const current = await resolve(e.ensName);
  if (!pinnedMetaChanged(e.pin.metaAddressURI, current.metaAddressURI)) {
    const { pendingChange: _p, ...rest } = e;
    return rest;
  }
  if (pinnedMetaChanged(pending.metaAddressURI, current.metaAddressURI)) {
    throw new ReapprovalError("The name changed again since you reviewed it. Review the new value first.");
  }
  const { pendingChange: _p, ...rest } = e;
  return {
    ...rest,
    pin: { metaAddressURI: current.metaAddressURI, registrant: current.registrant, pinnedAt: now },
    pinHistory: [
      ...e.pinHistory,
      { metaAddressURI: current.metaAddressURI, registrant: current.registrant, at: now, reason: "re-approved", worldId: pending.worldId },
    ],
  };
}

export function displayName(e: Pick<Employee, "ensName" | "label">): string {
  return e.label ? `${e.label} (${e.ensName})` : e.ensName;
}
