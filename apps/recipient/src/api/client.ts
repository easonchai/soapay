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
  /** World ID proof (IDKit), passed through to the API's HumanVerifier. */
  proof?: unknown;
};
export type RegisterResult = { txHash: Hex; status: string; idempotent?: boolean };

export type NameClaimBody = {
  label: string;
  registrant: Address;
  metaAddress: string;
  /** uint256 unix seconds as a decimal string. */
  deadline: string;
  signature: Hex;
  proof?: unknown;
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
