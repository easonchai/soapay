/**
 * Using ONE stealth address with a dApp (WalletConnect, D-61): signing, decoding the calls a dApp
 * asks for, the privacy check behind the approval sheet, and waiting for a submitted userOp.
 *
 * Execution itself is `executeFromStealth` (spend.ts): one userOp from one stealth address, 7702 +
 * paymaster, never combined with another address. Keys stay in memory for one call and are only
 * used to sign here; nothing in this module sends a key anywhere.
 */
import {
  decodeFunctionData,
  erc20Abi,
  getAddress,
  hexToString,
  isAddress,
  isAddressEqual,
  isHex,
  parseAbi,
  type Abi,
  type Address,
  type Hex,
  type Log,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { planSpend, type ClusterGraph, type SpendPlan } from "./guard.js";
import { SpendError, type SpendClient, type StealthCall } from "./spend.js";

// ---------------------------------------------------------------------------------------------
// Signing
// ---------------------------------------------------------------------------------------------

function stealthAccount(stealthKey: Hex, expected?: Address) {
  const account = privateKeyToAccount(stealthKey);
  if (expected && !isAddressEqual(account.address, expected)) throw new SpendError(`Soapay dapp: key does not control ${getAddress(expected)}`);
  return account;
}

/**
 * `personal_sign` (EIP-191) with a stealth key. A hex `message` is signed as raw bytes, which is what
 * `personal_sign` means by a 0x-prefixed payload; anything else is signed as UTF-8 text.
 */
export async function signMessageAsStealth(p: { stealthKey: Hex; message: string; expected?: Address }): Promise<Hex> {
  const account = stealthAccount(p.stealthKey, p.expected);
  return account.signMessage({ message: isHex(p.message) ? { raw: p.message } : p.message });
}

/** Readable text for a `personal_sign` payload: UTF-8 when it decodes cleanly, else the hex. */
export function personalMessageText(message: string): string {
  if (!isHex(message)) return message;
  try {
    const text = hexToString(message);
    // Control characters (other than whitespace) mean it's binary, e.g. a 32-byte hash.
    return /[\u0000-\u0008\u000e-\u001f\u007f�]/.test(text) ? message : text;
  } catch {
    return message;
  }
}

export type TypedDataField = { name: string; type: string };
/** An `eth_signTypedData_v4` payload (EIP-712), as dApps send it. */
export type TypedDataV4 = {
  domain: Record<string, unknown>;
  types: Record<string, TypedDataField[]>;
  primaryType: string;
  message: Record<string, unknown>;
};

/** Parses and shape-checks an `eth_signTypedData_v4` payload (a JSON string or an object). */
export function parseTypedDataV4(input: unknown): TypedDataV4 {
  let v: unknown = input;
  if (typeof v === "string") {
    try {
      v = JSON.parse(v);
    } catch {
      throw new SpendError("Soapay dapp: typed data is not valid JSON");
    }
  }
  if (!v || typeof v !== "object") throw new SpendError("Soapay dapp: typed data missing");
  const td = v as Record<string, unknown>;
  const types = td.types;
  if (!types || typeof types !== "object") throw new SpendError("Soapay dapp: typed data has no types");
  for (const [name, fields] of Object.entries(types as Record<string, unknown>)) {
    if (!Array.isArray(fields) || fields.some((f) => !f || typeof f.name !== "string" || typeof f.type !== "string"))
      throw new SpendError(`Soapay dapp: typed data type ${name} is malformed`);
  }
  if (typeof td.primaryType !== "string" || !(td.primaryType in (types as object)))
    throw new SpendError("Soapay dapp: typed data primaryType is missing from types");
  if (!td.message || typeof td.message !== "object") throw new SpendError("Soapay dapp: typed data has no message");
  const domain = td.domain && typeof td.domain === "object" ? (td.domain as Record<string, unknown>) : {};
  return { domain, types: types as Record<string, TypedDataField[]>, primaryType: td.primaryType, message: td.message as Record<string, unknown> };
}

/** JSON-RPC typed data carries big integers as decimal or hex strings; viem wants bigints. */
function normalizeValue(type: string, value: unknown, types: Record<string, TypedDataField[]>): unknown {
  const arr = /^(.*)\[(\d*)\]$/.exec(type);
  if (arr) return Array.isArray(value) ? value.map((x) => normalizeValue(arr[1]!, x, types)) : value;
  if (types[type]) return normalizeStruct(type, value, types);
  if (/^u?int\d*$/.test(type) && (typeof value === "string" || typeof value === "number")) {
    try {
      return BigInt(value);
    } catch {
      return value;
    }
  }
  return value;
}

function normalizeStruct(type: string, value: unknown, types: Record<string, TypedDataField[]>): unknown {
  if (!value || typeof value !== "object") return value;
  const out: Record<string, unknown> = { ...(value as Record<string, unknown>) };
  for (const f of types[type] ?? []) if (f.name in out) out[f.name] = normalizeValue(f.type, out[f.name], types);
  return out;
}

/** `eth_signTypedData_v4` with a stealth key. */
export async function signTypedDataAsStealth(p: { stealthKey: Hex; typedData: TypedDataV4 | string; expected?: Address }): Promise<Hex> {
  const account = stealthAccount(p.stealthKey, p.expected);
  const td = parseTypedDataV4(p.typedData);
  const domain = normalizeStruct("EIP712Domain", td.domain, {
    ...td.types,
    EIP712Domain: td.types.EIP712Domain ?? [{ name: "chainId", type: "uint256" }],
  }) as Record<string, unknown>;
  // Dynamic EIP-712 payload: viem's generic typing can't follow it, so go through a plain signature.
  const sign = account.signTypedData as unknown as (p: {
    domain: Record<string, unknown>;
    types: Record<string, TypedDataField[]>;
    primaryType: string;
    message: unknown;
  }) => Promise<Hex>;
  return sign({ domain, types: td.types, primaryType: td.primaryType, message: normalizeStruct(td.primaryType, td.message, td.types) });
}

/** Chain id named in a typed-data domain, if any. */
export function typedDataChainId(td: TypedDataV4): number | undefined {
  const c = td.domain.chainId;
  if (typeof c === "number") return c;
  if (typeof c === "bigint") return Number(c);
  if (typeof c === "string" && c.length > 0) {
    try {
      return Number(BigInt(c));
    } catch {
      return undefined;
    }
  }
  return undefined;
}

const PERMIT_TYPES = new Set(["Permit", "PermitSingle", "PermitBatch", "PermitTransferFrom", "PermitBatchTransferFrom", "PermitWitnessTransferFrom"]);

/** The spender a permit-style signature authorizes, or null when the typed data isn't a permit. */
export function typedDataPermitSpender(td: TypedDataV4): Address | null {
  if (!PERMIT_TYPES.has(td.primaryType)) return null;
  const s = td.message.spender;
  return typeof s === "string" && isAddress(s, { strict: false }) ? getAddress(s) : null;
}

// ---------------------------------------------------------------------------------------------
// Decoding the calls a dApp asks for
// ---------------------------------------------------------------------------------------------

/** ABIs the approval sheet can name: ERC-20, ERC-4626 vaults (Morpho, …), Aave v3 Pool, Permit2. */
const KNOWN_ABIS: readonly Abi[] = [
  erc20Abi,
  parseAbi([
    "function deposit(uint256 assets, address receiver) returns (uint256)",
    "function mint(uint256 shares, address receiver) returns (uint256)",
    "function withdraw(uint256 assets, address receiver, address owner) returns (uint256)",
    "function redeem(uint256 shares, address receiver, address owner) returns (uint256)",
  ]),
  parseAbi([
    "function supply(address asset, uint256 amount, address onBehalfOf, uint16 referralCode)",
    "function withdraw(address asset, uint256 amount, address to) returns (uint256)",
    "function borrow(address asset, uint256 amount, uint256 interestRateMode, uint16 referralCode, address onBehalfOf)",
    "function repay(address asset, uint256 amount, uint256 interestRateMode, address onBehalfOf) returns (uint256)",
    "function setUserUseReserveAsCollateral(address asset, bool useAsCollateral)",
  ]),
  parseAbi(["function approve(address token, address spender, uint160 amount, uint48 expiration)"]),
];

export type DecodedCall = {
  to: Address;
  value: bigint;
  data: Hex;
  /** 4-byte selector, or null for a plain call with no data. */
  selector: Hex | null;
  /** Function name when one of the known ABIs matches. */
  functionName?: string;
  /** Named arguments as display strings. */
  args?: { name: string; value: string }[];
};

function display(v: unknown): string {
  if (typeof v === "bigint") return v.toString();
  if (Array.isArray(v)) return `[${v.map(display).join(", ")}]`;
  return String(v);
}

/** Names a call from the known ABIs; unknown calls keep their selector. */
export function decodeDappCall(call: StealthCall): DecodedCall {
  const to = getAddress(call.to);
  const data = call.data ?? "0x";
  const value = call.value ?? 0n;
  const selector = data.length >= 10 ? (data.slice(0, 10) as Hex) : null;
  for (const abi of KNOWN_ABIS) {
    try {
      const d = decodeFunctionData({ abi, data });
      const item = abi.find((x) => x.type === "function" && x.name === d.functionName && x.inputs.length === (d.args?.length ?? 0));
      const inputs = item && item.type === "function" ? item.inputs : [];
      const args = (d.args ?? []).map((a, i) => ({ name: inputs[i]?.name || `arg${i}`, value: display(a) }));
      return { to, value, data, selector, functionName: d.functionName, args };
    } catch {
      // not this ABI
    }
  }
  return { to, value, data, selector };
}

export type DappTransfer = { token: Address; to: Address; amount: bigint };

/** ERC-20 `transfer` / `transferFrom` recipients in a call list: where the calls send tokens. */
export function dappTransfers(calls: readonly StealthCall[]): DappTransfer[] {
  const out: DappTransfer[] = [];
  for (const c of calls) {
    if (!c.data || c.data.length < 10) continue;
    try {
      const d = decodeFunctionData({ abi: erc20Abi, data: c.data });
      if (d.functionName === "transfer") out.push({ token: getAddress(c.to), to: getAddress(d.args[0]), amount: d.args[1] });
      else if (d.functionName === "transferFrom") out.push({ token: getAddress(c.to), to: getAddress(d.args[1]), amount: d.args[2] });
    } catch {
      // not an ERC-20 transfer
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Privacy check (the consolidation guard, applied to a dApp request)
// ---------------------------------------------------------------------------------------------

export type DappPrivacyWarningCode = "own-stealth" | "identifiable";
export type DappPrivacyWarning = { code: DappPrivacyWarningCode; address: Address; message: string };

export type DappPrivacyCheck = {
  /** Addresses the request names that would link this stealth address to you or to another of yours. */
  warnings: DappPrivacyWarning[];
  /** Token transfers in the calls, each with the guard's plan for sending from `from` to that recipient. */
  transfers: { transfer: DappTransfer; plan: SpendPlan | null }[];
  /**
   * True when approving creates a link the Send guard would block (an identifiable destination, or
   * another of your stealth addresses). The UI must require an explicit override.
   */
  blocked: boolean;
};

export type DappPrivacyInput = {
  graph: ClusterGraph;
  /** The one stealth address exposed to this dApp. */
  from: Address;
  /** Every stealth address the user controls (the ledger), in case the graph doesn't list some. */
  ownStealth?: readonly Address[];
  calls?: readonly StealthCall[];
  typedData?: TypedDataV4;
  message?: string;
  override?: boolean;
};

const norm = (a: string) => a.toLowerCase();

/**
 * Checks a dApp request against the consolidation guard. Token transfers go through `planSpend`
 * exactly like Send. Any other place the request names an address (calldata such as Aave's
 * `onBehalfOf`, a typed-data field, a signed message) is matched against your other stealth
 * addresses and every identifiable address (labelled main-wallet / exchange / coworker-known, or in
 * an identified cluster). Addresses already linked to `from` add no new link and are skipped.
 */
export function checkDappPrivacy(p: DappPrivacyInput): DappPrivacyCheck {
  const g = p.graph;
  const from = getAddress(p.from);
  const clusterOf = (a: Address) => g.clusterOf(a) ?? a;
  const fromCluster = clusterOf(from);
  const calls = p.calls ?? [];

  const transfers = dappTransfers(calls).map((transfer) => {
    try {
      return { transfer, plan: planSpend(g, { from: [from], to: transfer.to, ...(p.override ? { override: true } : {}) }) };
    } catch {
      // The recipient is `from` itself: no link.
      return { transfer, plan: null };
    }
  });
  const recipients = new Set(transfers.map((t) => norm(t.transfer.to)));

  // Addresses whose appearance would create a new link.
  const own = new Map<string, Address>();
  const identifiable = new Map<string, { address: Address; label?: string }>();
  const policy = new Set<string>(g.policy.identifiableLabels);
  for (const n of g.toJSON().nodes) {
    const a = getAddress(n.address);
    if (norm(a) === norm(from) || clusterOf(a) === fromCluster) continue;
    if (n.kind === "stealth") own.set(norm(a), a);
    else if ((n.label && policy.has(n.label)) || (g.has(a) && g.cluster(clusterOf(a)).identified))
      identifiable.set(norm(a), { address: a, ...(n.label ? { label: n.label } : {}) });
  }
  for (const s of p.ownStealth ?? []) {
    const a = getAddress(s);
    if (norm(a) !== norm(from) && clusterOf(a) !== fromCluster) own.set(norm(a), a);
  }

  const haystack = [
    ...calls.flatMap((c) => [c.to, c.data ?? ""]),
    p.typedData ? JSON.stringify(p.typedData, (_k, v) => (typeof v === "bigint" ? v.toString() : v)) : "",
    p.message ?? "",
  ]
    .join("|")
    .toLowerCase();
  const named = (a: string) => haystack.includes(a.slice(2));

  const warnings: DappPrivacyWarning[] = [];
  for (const [k, a] of own) {
    if (recipients.has(k) || !named(k)) continue;
    warnings.push({
      code: "own-stealth",
      address: a,
      message: `This request names ${a}, another of your payment addresses. Approving links the two.`,
    });
  }
  for (const [k, { address, label }] of identifiable) {
    if (recipients.has(k) || !named(k)) continue;
    warnings.push({
      code: "identifiable",
      address,
      message: `This request names ${address}${label ? `, which you labelled ${label}` : ", which is linked to you"}. Approving ties this payment address to you.`,
    });
  }

  const transferBlocked = transfers.some((t) => t.plan?.decision === "block");
  const blocked = (transferBlocked || warnings.length > 0 || transfers.some((t) => t.plan?.wouldMerge)) && !p.override;
  return { warnings, transfers, blocked };
}

// ---------------------------------------------------------------------------------------------
// Waiting for a submitted userOp
// ---------------------------------------------------------------------------------------------

export type StealthInclusion = {
  success: boolean;
  userOpHash: Hex;
  /** The bundle transaction that carried the userOp (EntryPoint.handleOps), not a tx from the stealth address. */
  txHash: Hex;
  blockHash: Hex;
  blockNumber: bigint;
  gasUsed: bigint;
  /** Logs emitted by this userOp only (not the whole bundle). */
  logs: Log[];
  reason?: string;
};

/** Waits for a userOp from `executeFromStealth(..., { wait: false })` to land. */
export async function waitForStealthExecution(client: SpendClient, userOpHash: Hex, opts: { timeout?: number } = {}): Promise<StealthInclusion> {
  const r = await client.bundlerClient.waitForUserOperationReceipt({ hash: userOpHash, ...(opts.timeout !== undefined ? { timeout: opts.timeout } : {}) });
  return {
    success: r.success,
    userOpHash,
    txHash: r.receipt.transactionHash,
    blockHash: r.receipt.blockHash,
    blockNumber: r.receipt.blockNumber,
    gasUsed: r.actualGasUsed,
    logs: r.logs,
    ...(r.reason ? { reason: r.reason } : {}),
  };
}
