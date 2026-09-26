/**
 * Session proposals → approved namespaces, with the one rule that matters for privacy: a session
 * exposes EXACTLY ONE stealth address on the app's active chain (D-61). Never more.
 */
import { getAddress, isAddress, type Address } from "viem";
import { SESSION_EVENTS, SUPPORTED_METHODS, WC_REASON } from "./rpc.js";

export type ProposalNamespace = { chains?: string[]; methods?: string[]; events?: string[] };
export type Proposal = {
  requiredNamespaces?: Record<string, ProposalNamespace>;
  optionalNamespaces?: Record<string, ProposalNamespace>;
};
export type Namespace = { chains: string[]; accounts: string[]; methods: string[]; events: string[] };

export class ProposalError extends Error {
  override name = "ProposalError";
  constructor(
    readonly reason: { code: number; message: string },
    message: string,
  ) {
    super(message);
  }
}

/** `eip155:8453` → 8453 (null when not an EIP-155 chain). */
export function chainIdOf(caip2: string): number | null {
  const m = /^eip155:(\d+)$/.exec(caip2);
  return m ? Number(m[1]) : null;
}

function chainsOf(key: string, ns: ProposalNamespace | undefined): string[] {
  return key.includes(":") ? [key] : (ns?.chains ?? []);
}

/**
 * Builds the approval for a proposal. Required namespaces must all be EIP-155 on `chainId`; a dApp
 * that names EIP-155 chains but not `chainId` is refused (it couldn't talk to us). Methods and events
 * a dApp *requires* are echoed so WalletConnect accepts the session; unsupported ones are refused
 * per request with 4200.
 */
export function buildSessionNamespaces(proposal: Proposal, opts: { chainId: number; address: Address; chainName?: string }): Record<string, Namespace> {
  if (!isAddress(opts.address, { strict: false })) throw new Error("buildSessionNamespaces: invalid address");
  const chain = `eip155:${opts.chainId}`;
  const label = opts.chainName ?? chain;
  const required = Object.entries(proposal.requiredNamespaces ?? {});
  const optional = Object.entries(proposal.optionalNamespaces ?? {});

  const methods = new Set<string>(SUPPORTED_METHODS);
  const events = new Set<string>(SESSION_EVENTS);
  for (const [key, ns] of required) {
    if (key !== "eip155" && !key.startsWith("eip155:"))
      throw new ProposalError(WC_REASON.unsupportedNamespaceKey, `This dApp requires ${key.split(":")[0]}; Soapay only supports Base.`);
    const other = chainsOf(key, ns).filter((c) => c !== chain);
    if (other.length > 0)
      throw new ProposalError(WC_REASON.unsupportedChains, `This dApp requires ${other.join(", ")}; Soapay is on ${label} (${chain}).`);
    for (const m of ns?.methods ?? []) methods.add(m);
    for (const e of ns?.events ?? []) events.add(e);
  }
  const named = [...required, ...optional].filter(([k]) => k === "eip155" || k.startsWith("eip155:")).flatMap(([k, ns]) => chainsOf(k, ns));
  if (named.length > 0 && !named.includes(chain))
    throw new ProposalError(WC_REASON.unsupportedChains, `This dApp doesn't support ${label}. Soapay only connects on the chain it's set to.`);

  return {
    eip155: {
      chains: [chain],
      accounts: [`${chain}:${getAddress(opts.address)}`],
      methods: [...methods],
      events: [...events],
    },
  };
}

export type SessionAccount = { address: Address; chainId: number };

/**
 * The one account a session exposes. Throws if a session somehow carries more than one address
 * (or none): requests on such a session are refused, never answered.
 */
export function sessionAccount(namespaces: Record<string, { accounts: string[] }>): SessionAccount {
  const accounts = Object.values(namespaces).flatMap((n) => n.accounts);
  const parsed = accounts.map((a) => {
    const [ns, id, addr] = a.split(":");
    if (ns !== "eip155" || !id || !addr || !isAddress(addr, { strict: false })) throw new Error(`Unsupported session account ${a}`);
    return { address: getAddress(addr), chainId: Number(id) };
  });
  const addresses = new Set(parsed.map((p) => p.address));
  const chains = new Set(parsed.map((p) => p.chainId));
  if (addresses.size !== 1 || chains.size !== 1) throw new Error("A session must expose exactly one address on one chain");
  return parsed[0]!;
}
