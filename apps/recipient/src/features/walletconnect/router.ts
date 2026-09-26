/**
 * WalletConnect request router (D-61): one dApp request → one action on the session's ONE stealth
 * address. Framework-free and WalletKit-free, so it is unit-tested directly; the controller wires it
 * to WalletKit and the app wires `deps` to the SDK (execution, signing, privacy check).
 *
 * Every state-changing or signing request goes through `deps.approve` (the approval sheet). Nothing
 * is signed or sent unless it returns `approved`, and a request the privacy guard blocks also needs
 * the explicit override.
 */
import {
  decodeDappCall,
  parseTypedDataV4,
  personalMessageText,
  typedDataChainId,
  typedDataPermitSpender,
  type DappPrivacyCheck,
  type DecodedCall,
  type StealthCall,
  type StealthInclusion,
  type TypedDataV4,
} from "@soapay/sdk";
import { formatEther, getAddress, isAddress, isAddressEqual, isHex, numberToHex, type Address, type Hex } from "viem";
import { RPC, RpcError, SUPPORTED_METHODS } from "./rpc.js";

export type DappInfo = { name: string; url: string };
/** The session a request arrived on: its single exposed address and chain. */
export type SessionContext = { topic: string; address: Address; chainId: number; dapp: DappInfo };
export type WcRequest = { method: string; params?: unknown };

export type ApprovalKind = "transaction" | "calls" | "message" | "typed-data";
export type ApprovalRequest = {
  kind: ApprovalKind;
  method: string;
  dapp: DappInfo;
  address: Address;
  chainId: number;
  calls?: DecodedCall[];
  message?: { text: string; raw: string };
  typedData?: TypedDataV4;
  /** Non-privacy cautions for the sheet (permit signatures, other-chain signatures, ignored capabilities). */
  notes: string[];
  privacy: DappPrivacyCheck;
};
export type ApprovalDecision = { approved: boolean; override?: boolean };

export type ExecutionHandle = { userOpHash: Hex; included: Promise<StealthInclusion> };
export type PrivacyInput = { from: Address; calls?: readonly StealthCall[]; typedData?: TypedDataV4; message?: string; override?: boolean };

export interface RouterDeps {
  approve(req: ApprovalRequest): Promise<ApprovalDecision>;
  checkPrivacy(input: PrivacyInput): DappPrivacyCheck;
  /** Submits ONE userOp from `from` (7702 + paymaster) and resolves once the bundler accepted it. */
  execute(from: Address, calls: StealthCall[]): Promise<ExecutionHandle>;
  signMessage(from: Address, message: string): Promise<Hex>;
  signTypedData(from: Address, typedData: TypedDataV4): Promise<Hex>;
  bundles: CallsStore;
  /** After a userOp lands successfully: record the links it made (guard graph). */
  onExecuted?(from: Address, calls: readonly StealthCall[], privacy: DappPrivacyCheck): void;
  newId?(): string;
}

// ---------------------------------------------------------------------------------------------
// EIP-5792 call bundles
// ---------------------------------------------------------------------------------------------

/** EIP-5792 status codes: 100 pending, 200 confirmed, 400 failed off-chain, 500 reverted on-chain. */
export type CallsBundle = {
  id: string;
  chainId: number;
  from: Address;
  userOpHash: Hex;
  status: 100 | 200 | 400 | 500;
  inclusion?: StealthInclusion;
  error?: string;
};

export class CallsStore {
  private readonly bundles = new Map<string, CallsBundle>();
  has(id: string): boolean {
    return this.bundles.has(id.toLowerCase());
  }
  get(id: string): CallsBundle | undefined {
    return this.bundles.get(id.toLowerCase());
  }
  set(b: CallsBundle): void {
    this.bundles.set(b.id.toLowerCase(), b);
  }
  update(id: string, patch: Partial<CallsBundle>): void {
    const b = this.get(id);
    if (b) this.set({ ...b, ...patch });
  }
}

function randomId(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return `0x${[...bytes].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
}

// ---------------------------------------------------------------------------------------------
// Param parsing
// ---------------------------------------------------------------------------------------------

const invalid = (m: string) => new RpcError(RPC.invalidParams, m);

function asArray(params: unknown): unknown[] {
  return Array.isArray(params) ? params : params === undefined ? [] : [params];
}

function parseValue(v: unknown): bigint {
  if (v === undefined || v === null || v === "" || v === "0x") return 0n;
  if (typeof v === "string" || typeof v === "number" || typeof v === "bigint") {
    try {
      return BigInt(v);
    } catch {
      /* fall through */
    }
  }
  throw invalid("value must be a hex quantity");
}

function noValue(value: bigint): void {
  if (value !== 0n)
    throw invalid(
      `Soapay payment addresses hold no ETH, so they can't send value (this asks for ${formatEther(value)} ETH). Use the dApp's USDC / token route instead.`,
    );
}

function checkFrom(from: unknown, session: SessionContext): void {
  if (from === undefined || from === null) return;
  if (typeof from !== "string" || !isAddress(from, { strict: false }) || !isAddressEqual(from, session.address))
    throw new RpcError(RPC.unauthorized, `This session only exposes ${session.address}`);
}

function parseChainId(v: unknown): number | undefined {
  if (v === undefined || v === null) return undefined;
  try {
    return Number(BigInt(v as string));
  } catch {
    throw invalid("chainId must be a hex quantity");
  }
}

function toCall(raw: unknown, what: string): StealthCall {
  if (!raw || typeof raw !== "object") throw invalid(`${what} missing`);
  const c = raw as Record<string, unknown>;
  if (typeof c.to !== "string" || !isAddress(c.to, { strict: false })) throw invalid(`${what} needs a "to" address (contract deployment isn't supported)`);
  const data = (c.data ?? c.input ?? "0x") as unknown;
  if (typeof data !== "string" || !isHex(data)) throw invalid(`${what} data must be hex`);
  const value = parseValue(c.value);
  noValue(value);
  return { to: getAddress(c.to), data: data as Hex, value: 0n };
}

/** Capabilities we accept; any other non-optional capability is refused (EIP-5792 5700). */
function checkCapabilities(caps: unknown, notes: string[]): void {
  if (!caps || typeof caps !== "object") return;
  for (const [name, val] of Object.entries(caps as Record<string, unknown>)) {
    if (name === "paymasterService") {
      notes.push("The dApp offered its own gas sponsor; Soapay uses its own gas path instead.");
      continue;
    }
    if (name === "atomic") continue;
    if (val && typeof val === "object" && (val as { optional?: unknown }).optional === true) continue;
    throw new RpcError(RPC.unsupportedCapability, `Unsupported capability: ${name}`);
  }
}

// ---------------------------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------------------------

/** Capabilities advertised per chain (wallet_getCapabilities). */
export function capabilitiesFor(chainId: number) {
  return { [numberToHex(chainId)]: { atomic: { status: "supported" }, paymasterService: { supported: true } } };
}

async function approveOrThrow(deps: RouterDeps, req: ApprovalRequest, recheck: () => DappPrivacyCheck): Promise<DappPrivacyCheck> {
  const decision = await deps.approve(req);
  if (!decision.approved) throw new RpcError(RPC.userRejected, "User rejected the request.");
  if (!req.privacy.blocked) return req.privacy;
  if (!decision.override) throw new RpcError(RPC.userRejected, "Blocked by the Soapay privacy guard.");
  return recheck();
}

/** Resolves a dApp request to its JSON-RPC result, or throws an `RpcError`. */
export async function routeRequest(req: WcRequest, session: SessionContext, deps: RouterDeps): Promise<unknown> {
  const params = asArray(req.params);
  const base = { dapp: session.dapp, address: session.address, chainId: session.chainId, method: req.method };

  switch (req.method) {
    case "eth_accounts":
    case "eth_requestAccounts":
      return [session.address];

    case "eth_chainId":
      return numberToHex(session.chainId);

    case "wallet_switchEthereumChain": {
      const target = parseChainId((params[0] as { chainId?: unknown } | undefined)?.chainId);
      if (target === session.chainId) return null;
      throw new RpcError(
        RPC.unrecognizedChain,
        `This session is on chain ${session.chainId}. Change the network in Soapay Settings and reconnect to use chain ${target ?? "?"}.`,
      );
    }

    case "wallet_getCapabilities": {
      checkFrom(params[0], session);
      const wanted = Array.isArray(params[1]) ? params[1].map((c) => parseChainId(c)) : undefined;
      return wanted && !wanted.includes(session.chainId) ? {} : capabilitiesFor(session.chainId);
    }

    case "eth_sendTransaction": {
      const tx = params[0] as Record<string, unknown> | undefined;
      if (!tx || typeof tx !== "object") throw invalid("transaction missing");
      checkFrom(tx.from, session);
      const txChain = parseChainId(tx.chainId);
      if (txChain !== undefined && txChain !== session.chainId) throw new RpcError(RPC.unsupportedChain, `This session is on chain ${session.chainId}, not ${txChain}`);
      const calls = [toCall(tx, "transaction")];
      const privacy = deps.checkPrivacy({ from: session.address, calls });
      const approved = await approveOrThrow(
        deps,
        { ...base, kind: "transaction", calls: calls.map(decodeDappCall), notes: [], privacy },
        () => deps.checkPrivacy({ from: session.address, calls, override: true }),
      );
      const handle = await deps.execute(session.address, calls);
      const inc = await handle.included;
      if (!inc.success) throw new RpcError(RPC.internal, `The transaction reverted${inc.reason ? ` (${inc.reason})` : ""}; nothing changed. Bundle tx ${inc.txHash}.`);
      deps.onExecuted?.(session.address, calls, approved);
      return inc.txHash;
    }

    case "wallet_sendCalls": {
      const p = params[0] as Record<string, unknown> | undefined;
      if (!p || typeof p !== "object") throw invalid("wallet_sendCalls params missing");
      checkFrom(p.from, session);
      const chain = parseChainId(p.chainId);
      if (chain !== session.chainId) throw new RpcError(RPC.unsupportedChain, `This session is on chain ${session.chainId}, not ${chain ?? "?"}`);
      if (!Array.isArray(p.calls) || p.calls.length === 0) throw invalid("calls must be a non-empty array");
      const notes: string[] = [];
      checkCapabilities(p.capabilities, notes);
      const calls = p.calls.map((c, i) => {
        checkCapabilities((c as { capabilities?: unknown } | null)?.capabilities, notes);
        return toCall(c, `call ${i}`);
      });
      const id = typeof p.id === "string" && p.id.length > 0 ? p.id : (deps.newId ?? randomId)();
      if (deps.bundles.has(id)) throw new RpcError(RPC.duplicateId, `Duplicate call bundle id ${id}`);
      const privacy = deps.checkPrivacy({ from: session.address, calls });
      const approved = await approveOrThrow(
        deps,
        { ...base, kind: "calls", calls: calls.map(decodeDappCall), notes: [...new Set(notes)], privacy },
        () => deps.checkPrivacy({ from: session.address, calls, override: true }),
      );
      // Submission errors (paymaster refusal, simulation revert) go straight back to the dApp.
      const handle = await deps.execute(session.address, calls);
      deps.bundles.set({ id, chainId: session.chainId, from: session.address, userOpHash: handle.userOpHash, status: 100 });
      handle.included.then(
        (inc) => {
          deps.bundles.update(id, { status: inc.success ? 200 : 500, inclusion: inc });
          if (inc.success) deps.onExecuted?.(session.address, calls, approved);
        },
        (e: unknown) => deps.bundles.update(id, { status: 400, error: e instanceof Error ? e.message : String(e) }),
      );
      return { id };
    }

    case "wallet_getCallsStatus": {
      const id = params[0];
      const b = typeof id === "string" ? deps.bundles.get(id) : undefined;
      // Bundles are only visible to the address that sent them.
      if (!b || !isAddressEqual(b.from, session.address)) throw new RpcError(RPC.unknownBundle, "Unknown call bundle id");
      const inc = b.inclusion;
      return {
        version: "2.0.0",
        id: b.id,
        chainId: numberToHex(b.chainId),
        status: b.status,
        atomic: true,
        ...(inc
          ? {
              receipts: [
                {
                  logs: inc.logs.map((l) => ({ address: l.address, data: l.data, topics: l.topics })),
                  status: inc.success ? "0x1" : "0x0",
                  blockHash: inc.blockHash,
                  blockNumber: numberToHex(inc.blockNumber),
                  gasUsed: numberToHex(inc.gasUsed),
                  transactionHash: inc.txHash,
                },
              ],
            }
          : {}),
      };
    }

    case "personal_sign": {
      // [message, address]; a few dApps send [address, message].
      let [message, from] = params as [unknown, unknown];
      if (typeof message === "string" && isAddress(message, { strict: false }) && isAddressEqual(message, session.address) && typeof from === "string" && !isAddress(from, { strict: false }))
        [message, from] = [from, message];
      if (typeof message !== "string") throw invalid("personal_sign message must be a string");
      checkFrom(from, session);
      const text = personalMessageText(message);
      const privacy = deps.checkPrivacy({ from: session.address, message: `${message}|${text}` });
      await approveOrThrow(deps, { ...base, kind: "message", message: { text, raw: message }, notes: [], privacy }, () =>
        deps.checkPrivacy({ from: session.address, message: `${message}|${text}`, override: true }),
      );
      return deps.signMessage(session.address, message);
    }

    case "eth_signTypedData_v4": {
      const [from, raw] = params;
      checkFrom(from, session);
      let typedData: TypedDataV4;
      try {
        typedData = parseTypedDataV4(raw);
      } catch (e) {
        throw invalid(e instanceof Error ? e.message.replace(/^Soapay dapp: /, "") : "invalid typed data");
      }
      const notes: string[] = [];
      const sigChain = typedDataChainId(typedData);
      if (sigChain !== undefined && sigChain !== session.chainId) notes.push(`This signature is for chain ${sigChain}, not the chain this session is on (${session.chainId}).`);
      const spender = typedDataPermitSpender(typedData);
      if (spender) notes.push(`This is a permit: it lets ${spender} move tokens from this address without another approval.`);
      const privacy = deps.checkPrivacy({ from: session.address, typedData });
      await approveOrThrow(deps, { ...base, kind: "typed-data", typedData, notes, privacy }, () =>
        deps.checkPrivacy({ from: session.address, typedData, override: true }),
      );
      return deps.signTypedData(session.address, typedData);
    }

    default:
      throw new RpcError(RPC.unsupportedMethod, `Soapay doesn't support ${req.method}`);
  }
}

export const isSupportedMethod = (m: string) => (SUPPORTED_METHODS as readonly string[]).includes(m);
