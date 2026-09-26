/**
 * Soapay API client (docs/mvp-spec.md §4). Only public data and signatures go over the wire: the
 * registrant signs locally, the relayer submits. Spending and viewing keys are never sent.
 */
import type { Address, Hex } from "viem";

export type ApiFetch = (input: string, init?: RequestInit) => Promise<Response>;

export class ApiError extends Error {
  override name = "ApiError";
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export type RegisterBody = {
  registrant: Address;
  metaAddress: string;
  signature: Hex;
};
export type RegisterResult = { txHash: Hex; status: string; idempotent?: boolean };

export type NameClaimBody = {
  label: string;
  registrant: Address;
  metaAddress: string;
  /** uint256 unix seconds as a decimal string. */
  deadline: string;
  signature: Hex;
  /** Optional World ID Selfie Check session result (§5), unchanged from IDKit. Only on a new name. */
  worldIdSession?: unknown;
  /** Invite code (0x, 32 bytes) for a label the employer reserved (§7). */
  inviteCode?: Hex;
};

/** GET /invites/:codeHash (docs/mvp-spec.md §7). */
export type InviteRecord = {
  label: string;
  employer: Address;
  org?: string | null;
  /** Unix seconds (number or decimal string). */
  expiresAt: number | string;
  status: "pending" | "claimed" | "expired";
  name?: string;
};

/**
 * POST /names/:label/session: attach a World ID session to an existing name. `signature` is the
 * registrant's EIP-712 AttachSession (SDK `attachSessionTypedData`).
 */
export type AttachSessionBody = {
  deadline: string;
  signature: Hex;
  worldIdResult: unknown;
};
export type AttachSessionResult = {
  label: string;
  sessionId: string;
  attachedAt: number;
  /** Unix seconds. A late-attached session can back a rotation only from here (72 h cooldown by default). */
  rotationAllowedFrom: number;
};

/** POST /names/:label/rotation (docs/mvp-spec.md §2.1). */
export type RotationBody = {
  newMeta: string;
  /** uint256 unix seconds as a decimal string. */
  deadline: string;
  /** EIP-712 RotationClaim signed by the registrant key. */
  registrantSig: Hex;
  /** `proveSession` result for the enrolled session (signal = rotateSignal(label, newMeta, deadline)). */
  worldIdResult?: unknown;
  /**
   * ERC-6538 `registerKeysOnBehalf` signature by the same registrant for `newMeta` (current registry
   * nonce). The API relays it on Base in the same World-ID-gated request (docs/mvp-spec.md §2.1 step 3),
   * so the registry cross-check in `resolveStealthMeta` keeps passing after the ENS record changes.
   */
  registerSig: Hex;
};
/** apps/api routes/rotation.ts response. */
export type RotationResult = {
  attester?: Address;
  attestation?: { label: string; oldMeta: string; newMeta: string; verifiedAt: string; signature: Hex };
  /** The relayed ERC-6538 re-registration on Base. */
  registry?: unknown;
  /** Sepolia gas top-up for the registrant's setText. */
  topup?: { status: string; txHash?: Hex };
  idempotent?: boolean;
};
export type NameRecord = {
  label: string;
  name: string;
  registrant: Address;
  metaAddress: string;
  deadline: string;
  txHash: Hex | null;
  createdAt: string | number;
  updatedAt: string | number;
};

function base(apiUrl: string): string {
  return apiUrl.replace(/\/+$/, "");
}

async function parse<T>(res: Response): Promise<T> {
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    // non-JSON body
  }
  if (!res.ok) {
    const err = (body as { error?: { code?: string; message?: string } } | null)?.error;
    throw new ApiError(res.status, err?.code ?? `http_${res.status}`, err?.message ?? friendlyStatus(res.status));
  }
  return body as T;
}

function friendlyStatus(status: number): string {
  if (status === 429) return "Too many requests. Wait a minute and try again.";
  if (status >= 500) return "The Soapay API had a problem. Try again shortly.";
  return `Request failed (${status}).`;
}

async function call<T>(fetchFn: ApiFetch, url: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetchFn(url, init);
  } catch {
    throw new ApiError(0, "network", "Can't reach the Soapay API. Check your connection or the API URL in Settings.");
  }
  return parse<T>(res);
}

const json = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

export function createApi(apiUrl: string, fetchFn: ApiFetch = (i, init) => fetch(i, init)) {
  const root = base(apiUrl);
  return {
    register: (body: RegisterBody) => call<RegisterResult>(fetchFn, `${root}/register`, json(body)),
    claimName: (body: NameClaimBody) => call<NameRecord>(fetchFn, `${root}/names`, json(body)),
    attachSession: (label: string, body: AttachSessionBody) =>
      call<AttachSessionResult>(fetchFn, `${root}/names/${encodeURIComponent(label)}/session`, json(body)),
    rotate: (label: string, body: RotationBody) =>
      call<RotationResult>(fetchFn, `${root}/names/${encodeURIComponent(label)}/rotation`, json(body)),
    /** null when no invite has this code hash. */
    async getInvite(codeHash: Hex): Promise<InviteRecord | null> {
      try {
        return await call<InviteRecord>(fetchFn, `${root}/invites/${codeHash}`);
      } catch (e) {
        if (e instanceof ApiError && e.status === 404) return null;
        throw e;
      }
    },
    /** null when the label is free. */
    async getName(label: string): Promise<NameRecord | null> {
      try {
        return await call<NameRecord>(fetchFn, `${root}/names/${encodeURIComponent(label)}`);
      } catch (e) {
        if (e instanceof ApiError && e.status === 404) return null;
        throw e;
      }
    },
  };
}

export type Api = ReturnType<typeof createApi>;
