/**
 * Pluggable adapters (D-29). Each interface names one integration point an app or CLI can swap out;
 * the default implementations are thin wrappers over what the SDK already does, so existing callers
 * see no behaviour change.
 *
 * - NameResolver: identifier → pinned meta-address (ENSv2 names, raw meta-addresses, ERC-6538 lookups).
 * - AnnouncementSource: where announcements come from (Soapay API index, or RPC getLogs).
 * - Signer: where the recipient's keys come from (recovery phrase, or an EOA signature).
 * - KeyStorage: where apps persist (already encrypted) key material. In-memory default only.
 * - Relayer: how an ERC-6538 registration reaches the chain (the Soapay API /register, or self-submit).
 */
import { getAddress, isAddress, type Address, type Hash, type Hex } from "viem";
import { formatMetaAddressURI, keysFromMnemonic, keysFromWalletSignature, parseMetaAddress, SIGN_MESSAGE, type SoapayKeys } from "./keys.js";
import { resolveStealthMeta, type EnsTextReader } from "./names.js";
import {
  buildRegisterKeysOnBehalfCall,
  erc6538RegistryMinimalAbi,
  ERC6538_REGISTRY,
  getRegistryNonce,
  signRegisterKeysOnBehalf,
  type RegistryReader,
} from "./registration.js";
import { fetchAnnouncements, fetchAnnouncementsRpc, type AnnouncementRecord, type FetchLike, type LogsClient } from "./scan.js";

// ---------------------------------------------------------------------------------------------
// NameResolver

export type ResolvedMeta = {
  /** Canonical `st:eth:0x…` URI. Pin this (CLAUDE.md: resolve once at enrollment). */
  metaAddressURI: string;
  /** The ERC-6538 registrant, when the source knows it. */
  registrant?: Address;
  /** Which resolver answered (`ens`, `meta-address`, `erc6538`, or a custom name). */
  source: string;
};

export type NameResolver = {
  readonly name: string;
  /** Cheap syntactic check: does this resolver handle this kind of identifier? */
  canResolve(identifier: string): boolean;
  /** Resolves or throws (e.g. NameNotFound / NotRegistered / MetaMismatch for ENS). */
  resolve(identifier: string): Promise<ResolvedMeta>;
};

/** ENS names via `resolveStealthMeta` (text record cross-checked against ERC-6538 on the payment chain). */
export function ensNameResolver(params: { ensClient: EnsTextReader; baseClient: RegistryReader; registry?: Address }): NameResolver {
  return {
    name: "ens",
    canResolve: (id) => /\.[a-z]{2,}$/i.test(id.trim()) && !id.trim().toLowerCase().startsWith("st:"),
    async resolve(id) {
      const args: Parameters<typeof resolveStealthMeta>[0] = { ensClient: params.ensClient, baseClient: params.baseClient, name: id };
      if (params.registry) args.registry = params.registry;
      const r = await resolveStealthMeta(args);
      return { metaAddressURI: r.metaAddressURI, registrant: r.registrant, source: "ens" };
    },
  };
}

function isMetaAddress(id: string): boolean {
  try {
    parseMetaAddress(id);
    return true;
  } catch {
    return false;
  }
}

/** Identifiers that already are meta-addresses (`st:eth:0x…` or raw 66-byte hex). No network. */
export function metaAddressResolver(): NameResolver {
  return {
    name: "meta-address",
    canResolve: isMetaAddress,
    async resolve(id) {
      return { metaAddressURI: formatMetaAddressURI(parseMetaAddress(id)), source: "meta-address" };
    },
  };
}

/** Plain `0x` addresses looked up in the ERC-6538 registry (scheme 1). */
export function erc6538Resolver(params: { client: RegistryReader; registry?: Address }): NameResolver {
  return {
    name: "erc6538",
    canResolve: (id) => isAddress(id.trim(), { strict: false }),
    async resolve(id) {
      const registrant = getAddress(id.trim());
      const raw = (await params.client.readContract({
        address: params.registry ?? ERC6538_REGISTRY,
        abi: erc6538RegistryMinimalAbi,
        functionName: "stealthMetaAddressOf",
        args: [registrant, 1n],
      })) as Hex;
      if (!raw || raw === "0x") throw new Error(`Soapay: ${registrant} has no ERC-6538 entry`);
      return { metaAddressURI: formatMetaAddressURI(parseMetaAddress(raw)), registrant, source: "erc6538" };
    },
  };
}

export class NoResolverError extends Error {
  readonly identifier: string;
  readonly errors: { resolver: string; error: unknown }[];
  constructor(identifier: string, errors: { resolver: string; error: unknown }[]) {
    const detail = errors.length === 0 ? "no resolver handles it" : errors.map((e) => `${e.resolver}: ${e.error instanceof Error ? e.error.message : String(e.error)}`).join("; ");
    super(`Soapay: cannot resolve "${identifier}": ${detail}`);
    this.name = "NoResolverError";
    this.identifier = identifier;
    this.errors = errors;
  }
}

/**
 * Tries each resolver that `canResolve` the identifier, in order, and returns the first success.
 * Resolver errors are collected; if none succeeds, throws NoResolverError with all of them.
 */
export function compositeResolver(resolvers: readonly NameResolver[]): NameResolver {
  return {
    name: `composite(${resolvers.map((r) => r.name).join(",")})`,
    canResolve: (id) => resolvers.some((r) => r.canResolve(id)),
    async resolve(id) {
      const errors: { resolver: string; error: unknown }[] = [];
      for (const r of resolvers) {
        if (!r.canResolve(id)) continue;
        try {
          return await r.resolve(id);
        } catch (error) {
          errors.push({ resolver: r.name, error });
        }
      }
      throw new NoResolverError(id, errors);
    },
  };
}

// ---------------------------------------------------------------------------------------------
// AnnouncementSource

export type AnnouncementRange = { fromBlock?: bigint; toBlock?: bigint };

export type AnnouncementSource = {
  readonly name: string;
  /** Scheme-1 announcements in the range, ordered by (blockNumber, logIndex). */
  fetch(range?: AnnouncementRange): Promise<AnnouncementRecord[]>;
};

/** The Soapay API index (`GET /announcements`). Malformed items are skipped, as in `fetchAnnouncements`. */
export function apiAnnouncementSource(params: { apiUrl: string; fetch?: FetchLike; limit?: number; maxPages?: number }): AnnouncementSource {
  return {
    name: "api",
    async fetch(range = {}) {
      const args: Parameters<typeof fetchAnnouncements>[0] = { apiUrl: params.apiUrl };
      if (params.fetch) args.fetch = params.fetch;
      if (params.limit !== undefined) args.limit = params.limit;
      if (params.maxPages !== undefined) args.maxPages = params.maxPages;
      if (range.fromBlock !== undefined) args.fromBlock = range.fromBlock;
      if (range.toBlock !== undefined) args.toBlock = range.toBlock;
      return (await fetchAnnouncements(args)).announcements;
    },
  };
}

/**
 * RPC getLogs over the Announcer (`fetchAnnouncementsRpc`). `fromBlock` defaults to `startBlock`
 * (use the registered chain's `announcerStartBlock`); `toBlock` defaults to the latest block.
 */
export function rpcAnnouncementSource(params: {
  client: LogsClient & { getBlockNumber(): Promise<bigint> };
  startBlock?: bigint;
  chunkSize?: number;
  concurrency?: number;
  announcer?: Address;
}): AnnouncementSource {
  return {
    name: "rpc",
    async fetch(range = {}) {
      const args: Parameters<typeof fetchAnnouncementsRpc>[0] = {
        client: params.client,
        fromBlock: range.fromBlock ?? params.startBlock ?? 0n,
        toBlock: range.toBlock ?? (await params.client.getBlockNumber()),
      };
      if (params.chunkSize !== undefined) args.chunkSize = params.chunkSize;
      if (params.concurrency !== undefined) args.concurrency = params.concurrency;
      if (params.announcer) args.announcer = params.announcer;
      return fetchAnnouncementsRpc(args);
    },
  };
}

/** Tries sources in order (e.g. API first, RPC fallback); throws the last error if all fail. */
export function fallbackAnnouncementSource(sources: readonly AnnouncementSource[]): AnnouncementSource {
  return {
    name: `fallback(${sources.map((s) => s.name).join(",")})`,
    async fetch(range) {
      let last: unknown = new Error("Soapay: no announcement sources");
      for (const s of sources) {
        try {
          return await s.fetch(range);
        } catch (e) {
          last = e;
        }
      }
      throw last;
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Signer (key source)

export type Signer = {
  readonly kind: string;
  /** Derives the recipient's keys. Secrets stay in the caller's process. */
  getKeys(): Promise<SoapayKeys>;
};

/** Recovery-phrase keys (the default key source). */
export function phraseSigner(mnemonic: string, passphrase?: string): Signer {
  return { kind: "phrase", getKeys: async () => keysFromMnemonic(mnemonic, passphrase) };
}

/**
 * Keys from a plain-EOA signature over `SIGN_MESSAGE`, with every guard of `keysFromWalletSignature`
 * (plain EOA only; with `confirm`, the wallet signs twice and both must match).
 */
export function eoaSignatureSigner(params: {
  address: Address;
  getCode(address: Address): Promise<Hex | undefined>;
  signMessage(message: string): Promise<Hex>;
  confirm?: boolean;
}): Signer {
  return {
    kind: "eoa-signature",
    async getKeys() {
      const code = await params.getCode(params.address);
      const signature = await params.signMessage(SIGN_MESSAGE);
      const confirmSignature = params.confirm ? await params.signMessage(SIGN_MESSAGE) : undefined;
      return keysFromWalletSignature({ address: params.address, code, signature, confirmSignature });
    },
  };
}

// ---------------------------------------------------------------------------------------------
// KeyStorage

/**
 * Where an app keeps key material between sessions. Values are opaque strings: apps must encrypt
 * before `set` (the recipient app stores a passphrase-encrypted vault). Spending keys never leave the
 * client, so implementations must be local (IndexedDB, keychain, an encrypted file), never a server.
 */
export type KeyStorage = {
  get(id: string): Promise<string | null>;
  set(id: string, value: string): Promise<void>;
  delete(id: string): Promise<void>;
  list(): Promise<string[]>;
};

/** Process-memory storage for tests, CLIs and short-lived agents. Lost on exit. */
export function memoryKeyStorage(initial: Record<string, string> = {}): KeyStorage {
  const m = new Map(Object.entries(initial));
  return {
    get: async (id) => m.get(id) ?? null,
    set: async (id, value) => {
      m.set(id, value);
    },
    delete: async (id) => {
      m.delete(id);
    },
    list: async () => [...m.keys()],
  };
}

// ---------------------------------------------------------------------------------------------
// Relayer

export type RegistrationRequest = { registrant: Address; metaAddress: Hex; signature: Hex };
export type RegistrationReceipt = { txHash: Hash; status?: string };

export type Relayer = {
  readonly kind: string;
  submit(req: RegistrationRequest): Promise<RegistrationReceipt>;
};

/** `fetch` subset for POSTs (the SDK compiles without DOM types). */
export type PostFetch = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string },
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

/** The Soapay API relayer: `POST /register {registrant, metaAddress, signature}` → `{txHash, status}`. */
export function apiRelayer(params: { apiUrl: string; fetch?: PostFetch }): Relayer {
  return {
    kind: "api",
    async submit(req) {
      const doFetch = params.fetch ?? (globalThis as { fetch?: PostFetch }).fetch;
      if (!doFetch) throw new Error("Soapay: no fetch available");
      const res = await doFetch(`${params.apiUrl.replace(/\/+$/, "")}/register`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ registrant: req.registrant, metaAddress: formatMetaAddressURI(req.metaAddress), signature: req.signature }),
      });
      const body = (await res.json().catch(() => null)) as { txHash?: unknown; status?: unknown; error?: { message?: unknown } } | null;
      if (!res.ok || !body || typeof body.txHash !== "string") {
        const msg = typeof body?.error?.message === "string" ? body.error.message : `HTTP ${res.status}`;
        throw new Error(`Soapay: POST /register failed: ${msg}`);
      }
      const out: RegistrationReceipt = { txHash: body.txHash as Hash };
      if (typeof body.status === "string") out.status = body.status;
      return out;
    },
  };
}

/** Self-submit: the caller's own wallet sends `registerKeysOnBehalf` and pays the gas. */
export function selfSubmitRelayer(params: {
  wallet: { sendTransaction(tx: { to: Address; data: Hex }): Promise<Hash> };
  registry?: Address;
}): Relayer {
  return {
    kind: "self",
    async submit(req) {
      const call = buildRegisterKeysOnBehalfCall({
        stealthMetaAddress: req.metaAddress,
        registrant: req.registrant,
        signature: req.signature,
        ...(params.registry ? { registry: params.registry } : {}),
      });
      return { txHash: await params.wallet.sendTransaction(call) };
    },
  };
}

/**
 * Signs `registerKeysOnBehalf` with the registrant key and hands it to `relayer`. Reads the registry
 * nonce first. The registrant key only authorises registration; it holds no funds.
 */
export async function registerWithRelayer(params: {
  keys: Pick<SoapayKeys, "registrantKey" | "registrantAddress" | "metaAddressURI">;
  chainId: number;
  client: RegistryReader;
  relayer: Relayer;
  registry?: Address;
}): Promise<RegistrationReceipt> {
  const registry = params.registry ?? ERC6538_REGISTRY;
  const nonce = await getRegistryNonce(params.client, params.keys.registrantAddress, registry);
  const signature = await signRegisterKeysOnBehalf({
    metaAddressURI: params.keys.metaAddressURI,
    chainId: params.chainId,
    nonce,
    registry,
    registrantKey: params.keys.registrantKey,
  });
  return params.relayer.submit({
    registrant: params.keys.registrantAddress,
    metaAddress: parseMetaAddress(params.keys.metaAddressURI),
    signature,
  });
}
