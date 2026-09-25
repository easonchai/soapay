// Employer invite links (docs/mvp-spec.md §7). Framework-free.
//
// "Invite employee" generates a 32-byte code, has the connected wallet sign the Invite
// typed data, POSTs /invites (which reserves the label) and shows the link. The code is
// kept only in the encrypted vault. The roster row stays "Invited (pending)" until
// GET /invites/:codeHash says claimed; then the employee is enrolled through the NORMAL
// resolve-and-pin path (enrollEmployee), never by trusting the API's answer.
import type { Address, Hex } from "viem";
import {
  PARENT_NAME,
  buildInviteLink,
  defaultInviteExpiry,
  generateInviteCode,
  inviteCodeHash,
  isValidLabel,
  signInvite,
  type InviteSigner,
} from "@soapay/sdk";
import { normalizeEnsName } from "./csv.js";
import { describeResolveError, enrollEmployee, type Employee, type Resolver } from "./roster.js";

export type InviteApiStatus = "pending" | "claimed" | "expired";

export type InviteStatusResponse = {
  codeHash: Hex;
  label: string;
  employer: Address;
  org?: string;
  expiresAt: number;
  status: InviteApiStatus;
  name?: string;
};

export type CreateInviteBody = {
  label: string;
  employer: Address;
  codeHash: Hex;
  expiresAt: number;
  signature: Hex;
  org?: string;
};

/** The two API calls invites need. HTTP in production, in-memory in dev mock mode. */
export type InviteApi = {
  create(body: CreateInviteBody): Promise<{ codeHash: Hex; expiresAt: number }>;
  /** null when the API doesn't know the code (404). */
  get(codeHash: Hex): Promise<InviteStatusResponse | null>;
};

/** Local state of an invite on the roster (persisted in the vault, including the code). */
export type InviteState =
  | { kind: "pending" }
  /** Claimed on the API, but resolve-and-pin hasn't succeeded yet (e.g. records not written). */
  | { kind: "claimed-unverified"; message: string }
  | { kind: "expired" };

export type InvitedEmployee = {
  id: string;
  label: string;
  /** Salary per run, USDC base units, applied on enrollment. */
  amount: bigint;
  org?: string;
  /** Secret: only here (vault) and in the link. */
  code: Hex;
  codeHash: Hex;
  employer: Address;
  expiresAt: number;
  createdAt: number;
  link: string;
  state: InviteState;
  lastCheckedAt?: number;
};

export class InviteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InviteError";
  }
}

/** Maps API error bodies to a sentence an employer can act on. */
function apiMessage(status: number, body: unknown): string {
  const code = (body as { error?: { code?: string; message?: string } })?.error?.code;
  const msg = (body as { error?: { message?: string } })?.error?.message;
  const known: Record<string, string> = {
    label_taken: "That name is already taken.",
    label_reserved: "That name is already reserved by another pending invite.",
    bad_signature: "The API couldn't verify your wallet's signature.",
    rate_limited: "Too many invites right now; try again later.",
  };
  return (code && known[code]) ?? `Invite API answered ${status}${msg ? `: ${msg}` : ""}`;
}

export function httpInviteApi(apiUrl: string, opts: { timeoutMs?: number; fetchImpl?: typeof fetch } = {}): InviteApi {
  const base = apiUrl.replace(/\/+$/, "");
  const f = opts.fetchImpl ?? ((u, i) => fetch(u, i));
  const timeout = () => AbortSignal.timeout(opts.timeoutMs ?? 10_000);
  return {
    async create(body) {
      const res = await f(`${base}/invites`, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify(body),
        signal: timeout(),
      });
      const json = (await res.json().catch(() => null)) as unknown;
      if (!res.ok) throw new InviteError(apiMessage(res.status, json));
      return json as { codeHash: Hex; expiresAt: number };
    },
    async get(codeHash) {
      const res = await f(`${base}/invites/${codeHash}`, { headers: { accept: "application/json" }, signal: timeout() });
      if (res.status === 404) return null;
      if (!res.ok) throw new InviteError(`Invite API answered ${res.status}`);
      return (await res.json()) as InviteStatusResponse;
    },
  };
}

/**
 * DEV ONLY (VITE_MOCK_ENS=1): an in-memory API whose invites flip to "claimed" after
 * `claimAfterMs`. No signature checks. The mock resolver then resolves the name.
 */
export function mockInviteApi(opts: { claimAfterMs?: number; now?: () => number; parentName?: string } = {}): InviteApi & {
  expire(codeHash: Hex): void;
} {
  const now = opts.now ?? (() => Date.now());
  const claimAfter = opts.claimAfterMs ?? 4_000;
  const parent = opts.parentName ?? PARENT_NAME;
  const rows = new Map<Hex, CreateInviteBody & { createdAtMs: number; forcedExpired?: boolean }>();
  return {
    async create(body) {
      for (const r of rows.values()) {
        if (r.label === body.label && !r.forcedExpired && r.expiresAt > now() / 1000) {
          throw new InviteError("That name is already reserved by another pending invite.");
        }
      }
      rows.set(body.codeHash, { ...body, createdAtMs: now() });
      return { codeHash: body.codeHash, expiresAt: body.expiresAt };
    },
    async get(codeHash) {
      const r = rows.get(codeHash);
      if (!r) return null;
      const claimed = !r.forcedExpired && now() - r.createdAtMs >= claimAfter;
      const expired = !claimed && (r.forcedExpired || r.expiresAt <= now() / 1000);
      return {
        codeHash,
        label: r.label,
        employer: r.employer,
        ...(r.org ? { org: r.org } : {}),
        expiresAt: r.expiresAt,
        status: claimed ? "claimed" : expired ? "expired" : "pending",
        ...(claimed ? { name: `${r.label}.${parent}` } : {}),
      };
    },
    expire(codeHash) {
      const r = rows.get(codeHash);
      if (r) rows.set(codeHash, { ...r, forcedExpired: true });
    },
  };
}

export type CreateInviteInput = { label: string; amount: bigint; org?: string };

export type CreateInviteDeps = {
  api: InviteApi;
  signer: InviteSigner;
  employer: Address;
  chainId: number;
  recipientUrl: string;
  now?: number;
  /** Tests inject a fixed code. */
  code?: Hex;
};

/** Validates, signs, POSTs /invites and returns the roster row (with its link). */
export async function createInvite(
  input: CreateInviteInput,
  deps: CreateInviteDeps,
  existing: { invites: readonly InvitedEmployee[]; employees: readonly Employee[] },
): Promise<InvitedEmployee> {
  const label = input.label.trim().toLowerCase();
  if (!isValidLabel(label)) throw new InviteError("Name must be 3-32 of a-z, 0-9 and hyphens (no hyphen at the start or end)");
  if (input.amount <= 0n) throw new InviteError("Amount must be more than 0");
  const org = input.org?.trim() || undefined;
  if (org && org.length > 64) throw new InviteError("Organisation name is too long (64 characters max)");
  if (existing.invites.some((i) => i.label === label && i.state.kind !== "expired")) {
    throw new InviteError(`${label} already has a pending invite`);
  }
  if (existing.employees.some((e) => e.ensName.split(".")[0] === label && e.ensName.endsWith(`.${PARENT_NAME}`))) {
    throw new InviteError(`${label}.${PARENT_NAME} is already on the roster`);
  }
  const nowMs = deps.now ?? Date.now();
  const code = deps.code ?? generateInviteCode();
  const codeHash = inviteCodeHash(code);
  const expiresAt = defaultInviteExpiry(Math.floor(nowMs / 1000));
  const signature = await signInvite(deps.signer, { label, employer: deps.employer, codeHash, expiresAt, chainId: deps.chainId }, deps.employer);
  const res = await deps.api.create({
    label,
    employer: deps.employer,
    codeHash,
    expiresAt: Number(expiresAt),
    signature,
    ...(org ? { org } : {}),
  });
  if (res.codeHash.toLowerCase() !== codeHash) throw new InviteError("Invite API returned a different code hash");
  return {
    id: crypto.randomUUID(),
    label,
    amount: input.amount,
    ...(org ? { org } : {}),
    code,
    codeHash,
    employer: deps.employer,
    expiresAt: res.expiresAt,
    createdAt: nowMs,
    link: buildInviteLink({ recipientUrl: deps.recipientUrl, code, label, org }),
    state: { kind: "pending" },
  };
}

/** The ENS name an invite enrolls: `<label>.<parent>`, from the API when it agrees on the label. */
export function invitedEnsName(inv: Pick<InvitedEmployee, "label">, apiName?: string): string {
  const fromApi = apiName ? normalizeEnsName(apiName) : null;
  if (fromApi && fromApi.split(".")[0] === inv.label) return fromApi;
  return `${inv.label}.${PARENT_NAME}`;
}

export type PollOutcome =
  | { kind: "unchanged"; invite: InvitedEmployee }
  | { kind: "updated"; invite: InvitedEmployee }
  | { kind: "enrolled"; employee: Employee }
  /** Already on the roster (e.g. a reload between enrolling and dropping the invite): drop it. */
  | { kind: "done" };

/**
 * One poll of one invite. On "claimed" it enrolls through enrollEmployee (resolve once and
 * pin, the same checks as a manual enrollment); if that fails the invite stays on the roster
 * as "claimed-unverified" and is retried on the next poll. Never throws for API errors:
 * those leave the invite unchanged.
 */
export async function pollInvite(
  inv: InvitedEmployee,
  deps: { api: InviteApi; resolve: Resolver; roster: readonly Employee[]; now?: number },
): Promise<PollOutcome> {
  if (inv.state.kind === "expired") return { kind: "unchanged", invite: inv };
  const now = deps.now ?? Date.now();
  let res: InviteStatusResponse | null;
  try {
    res = await deps.api.get(inv.codeHash);
  } catch {
    return { kind: "unchanged", invite: inv };
  }
  if (!res || res.status === "expired" || (res.status === "pending" && res.expiresAt * 1000 <= now)) {
    return { kind: "updated", invite: { ...inv, state: { kind: "expired" }, lastCheckedAt: now } };
  }
  if (res.status === "pending") return { kind: "unchanged", invite: { ...inv, lastCheckedAt: now } };

  // Claimed: enroll with the normal resolve-and-pin verification.
  const ensName = invitedEnsName(inv, res.name);
  if (deps.roster.some((e) => e.ensName === ensName)) return { kind: "done" };
  try {
    const employee = await enrollEmployee(deps.resolve, { ensName, amount: inv.amount }, deps.roster, now);
    return { kind: "enrolled", employee };
  } catch (err) {
    const message =
      err instanceof Error && err.name === "EnrollmentError" ? err.message : describeResolveError(err).message;
    return { kind: "updated", invite: { ...inv, state: { kind: "claimed-unverified", message }, lastCheckedAt: now } };
  }
}

/** Invites that still need polling. */
export function needsPolling(inv: InvitedEmployee): boolean {
  return inv.state.kind === "pending" || inv.state.kind === "claimed-unverified";
}

export function inviteStatusText(inv: InvitedEmployee): string {
  switch (inv.state.kind) {
    case "pending":
      return "Invited (pending)";
    case "claimed-unverified":
      return `Claimed, waiting to verify: ${inv.state.message}`;
    case "expired":
      return "Invite expired";
  }
}

/**
 * Polls every invite that needs it, sequentially (so two invites for one name can't both
 * enroll). Returns an outcome per polled invite id; apply it with `applyPollOutcomes`.
 */
export async function pollInvites(
  invites: readonly InvitedEmployee[],
  deps: { api: InviteApi; resolve: Resolver; roster: readonly Employee[]; now?: number },
): Promise<Map<string, PollOutcome>> {
  const out = new Map<string, PollOutcome>();
  const roster = [...deps.roster];
  for (const inv of invites) {
    if (!needsPolling(inv)) continue;
    const o = await pollInvite(inv, { ...deps, roster });
    if (o.kind === "enrolled") roster.push(o.employee);
    out.set(inv.id, o);
  }
  return out;
}

/**
 * Applies outcomes to the CURRENT lists (which may have changed while polling): enrolled
 * and done invites leave the invite list, enrolled employees join the roster (never twice).
 */
export function applyPollOutcomes(
  invites: readonly InvitedEmployee[],
  employees: readonly Employee[],
  outcomes: ReadonlyMap<string, PollOutcome>,
): { invites: InvitedEmployee[]; employees: Employee[]; enrolled: Employee[] } {
  const nextEmployees = [...employees];
  const enrolled: Employee[] = [];
  const nextInvites: InvitedEmployee[] = [];
  for (const inv of invites) {
    const o = outcomes.get(inv.id);
    if (!o) {
      nextInvites.push(inv);
    } else if (o.kind === "enrolled") {
      if (!nextEmployees.some((e) => e.ensName === o.employee.ensName)) {
        nextEmployees.push(o.employee);
        enrolled.push(o.employee);
      }
    } else if (o.kind !== "done") {
      nextInvites.push(o.invite);
    }
  }
  return { invites: nextInvites, employees: nextEmployees, enrolled };
}
