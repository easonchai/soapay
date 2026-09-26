// Pure pieces of `pnpm demo:ens` (examples/demo/ens.ts): name handling, meta-address splitting,
// role decoding, RPC host display and the stealth derivation wrapper. No network, so they are unit
// tested in examples/test/ens-view.test.ts.
import { derivePayRun, META_ADDRESS_URI_PREFIX, PARENT_NAME, parseMetaAddress, type PayRunLine } from "@soapay/sdk";
import { RESOLVER_ROLES } from "@soapay/sdk/ensv2";
import type { Address, Hex } from "viem";

/** `alex-demo` → `alex-demo.soapay.eth`; a full name (has a dot) is kept, lowercased. */
export function toEnsName(input: string, parent: string = PARENT_NAME): string {
  const s = input.trim().toLowerCase().replace(/\.$/, "");
  if (!s) throw new Error("a label or name is required");
  return s.includes(".") ? s : `${s}.${parent}`;
}

/**
 * The registry walk for `name`, root first: each hop asks the registry that holds `label` for the
 * next registry down. The last hop is the name's own label, whose resolver we read.
 * `alex-demo.soapay.eth` → [eth, soapay, alex-demo].
 */
export function registryPath(name: string): string[] {
  const labels = name.split(".").filter(Boolean);
  if (labels.length < 2) throw new Error(`${name}: expected a name like label.parent.eth`);
  return labels.reverse();
}

export type SplitMeta = { metaAddress: Hex; spendingPublicKey: Hex; viewingPublicKey: Hex };

/**
 * An ERC-5564 scheme-1 meta-address (`st:eth:0x…` or bare hex) split into its two 33-byte compressed
 * secp256k1 public keys: spending first, viewing second.
 */
export function splitMetaAddress(input: string): SplitMeta {
  const metaAddress = parseMetaAddress(input);
  const hex = metaAddress.slice(2);
  if (hex.length !== 132) throw new Error("meta-address must be 66 bytes (two compressed public keys)");
  return { metaAddress, spendingPublicKey: `0x${hex.slice(0, 66)}`, viewingPublicKey: `0x${hex.slice(66)}` };
}

/** The canonical URI form, `st:eth:0x…`. */
export const metaUri = (meta: Hex) => `${META_ADDRESS_URI_PREFIX}${meta}`;

/**
 * Only the host of an RPC URL: providers put API keys in the path or query, and those must never be
 * printed. Anything unparseable shows as `(custom RPC)`.
 */
export function rpcHost(url: string): string {
  try {
    return new URL(url).host || "(custom RPC)";
  } catch {
    return "(custom RPC)";
  }
}

/** Whether `bitmap` holds every bit of `role`. */
export const hasRole = (bitmap: bigint, role: bigint) => (bitmap & role) === role;

/** Names of the resolver roles set in `bitmap` (admin halves marked), for display. */
export function resolverRoleNames(bitmap: bigint): string[] {
  const names: string[] = [];
  for (const [name, bit] of Object.entries(RESOLVER_ROLES)) {
    if (name.endsWith("_ADMIN")) continue;
    if (hasRole(bitmap, bit)) names.push(name);
    const admin = bit << 128n;
    if (bit < 1n << 128n && hasRole(bitmap, admin)) names.push(`${name}_ADMIN`);
  }
  return names;
}

export type FreshAddress = { stealthAddress: Address; ephemeralPublicKey: Hex; viewTag: number };

/**
 * N fresh stealth addresses for one meta-address, exactly as an employer's pay run derives lines:
 * `derivePayRun` with one line per address (a random ephemeral key each → ECDH shared secret with the
 * viewing key → stealth address + view tag), sorted ascending as on-chain. `randomEphemeralKey` is
 * the SDK's test hook.
 */
export function deriveFreshAddresses(
  metaAddressURI: string,
  count: number,
  randomEphemeralKey?: () => Uint8Array,
): FreshAddress[] {
  if (!Number.isInteger(count) || count < 1 || count > 50) throw new Error("--derive takes a whole number from 1 to 50");
  const lines: PayRunLine[] = derivePayRun({
    recipients: [{ metaAddressURI, amount: BigInt(count), id: "demo" }],
    denominate: (amount) => Array.from({ length: Number(amount) }, () => 1n),
    ...(randomEphemeralKey ? { randomEphemeralKey } : {}),
  });
  return lines.map((l) => ({ stealthAddress: l.stealthAddress, ephemeralPublicKey: l.ephemeralPublicKey, viewTag: l.viewTag }));
}

/** `0x02ab…cdef` style shortening for long hex. */
export function shortHex(s: string, head = 10, tail = 6): string {
  return s.length > head + tail + 1 ? `${s.slice(0, head)}…${s.slice(-tail)}` : s;
}

/** Parses `demo:ens` arguments. */
export function parseArgs(argv: readonly string[]): { target: string; derive: number } {
  let derive = 3;
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--derive") {
      const v = argv[++i];
      if (v === undefined) throw new Error("--derive needs a number");
      derive = Number(v);
    } else if (a.startsWith("--derive=")) derive = Number(a.slice("--derive=".length));
    else if (a.startsWith("--")) throw new Error(`unknown flag ${a}`);
    else positional.push(a);
  }
  if (positional.length !== 1) throw new Error("usage: pnpm demo:ens <label-or-name> [--derive N]");
  if (!Number.isInteger(derive) || derive < 1 || derive > 50) throw new Error("--derive takes a whole number from 1 to 50");
  return { target: positional[0]!, derive };
}

/** Parses a dotenv-style file body (KEY=value, optional quotes and `export`). */
export function parseEnvText(text: string): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const raw of text.split("\n")) {
    const m = raw.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    vars[m[1]!] = m[2]!.replace(/^(["'])(.*)\1$/, "$2");
  }
  return vars;
}
