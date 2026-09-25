/**
 * ENS name → stealth meta-address (docs/mvp-spec.md §3, `names.ts`).
 *
 * ENS is only a reference identifier (CLAUDE.md threat model). The sender resolves
 * a name ONCE at enrollment, cross-checks it against ERC-6538 on Base, PINS the
 * meta-address, and alerts the employer if it ever changes (`pinnedMetaChanged`).
 */
import { isAddress, type Address, type Hex } from "viem";
import { normalize } from "viem/ens";
import { formatMetaAddressURI, parseMetaAddress } from "./keys.js";
import { ERC6538_REGISTRY, erc6538RegistryMinimalAbi, type RegistryReader } from "./registration.js";

import { TEXT_KEY_REGISTRANT as TEXT_REGISTRANT, TEXT_KEY_STEALTH as TEXT_STEALTH } from "./constants.js";

export type NameErrorCode = "NameNotFound" | "MetaMismatch" | "NotRegistered";

export class SoapayNameError extends Error {
  readonly code: NameErrorCode;
  readonly ensName: string;
  constructor(code: NameErrorCode, ensName: string, message: string) {
    super(message);
    this.name = code;
    this.code = code;
    this.ensName = ensName;
  }
}

/** Name has no (or malformed) `stealth` / `soapay:registrant` text records. */
export class NameNotFound extends SoapayNameError {
  constructor(ensName: string, detail: string) {
    super("NameNotFound", ensName, `${ensName}: ${detail}`);
  }
}

/** Registrant has no scheme-1 entry in the ERC-6538 registry on the Base chain. */
export class NotRegistered extends SoapayNameError {
  readonly registrant: Address;
  constructor(ensName: string, registrant: Address) {
    super("NotRegistered", ensName, `${ensName}: registrant ${registrant} has no ERC-6538 entry`);
    this.registrant = registrant;
  }
}

/** ENS `stealth` record differs from the registrant's ERC-6538 entry. Do not pay. */
export class MetaMismatch extends SoapayNameError {
  readonly textRecord: string;
  readonly registryValue: Hex;
  constructor(ensName: string, textRecord: string, registryValue: Hex) {
    super("MetaMismatch", ensName, `${ensName}: ENS stealth record does not match ERC-6538 registry`);
    this.textRecord = textRecord;
    this.registryValue = registryValue;
  }
}

/** Minimal ENS client surface (any viem PublicClient on the ENS chain fits). */
export type EnsTextReader = {
  getEnsText(args: { name: string; key: string }): Promise<string | null>;
};

export type ResolvedStealthMeta = {
  /** Canonical `st:eth:0x<lowercase>` URI; pin this. */
  metaAddressURI: string;
  registrant: Address;
};

/**
 * Resolve `name` (e.g. `alice.soapay.eth`) to its stealth meta-address.
 * `ensClient` is on the ENS chain (Sepolia/mainnet; CCIP-Read handled by viem's
 * Universal Resolver path); `baseClient` is on the Base chain holding the registry.
 * Throws NameNotFound, NotRegistered or MetaMismatch.
 */
export async function resolveStealthMeta(params: {
  ensClient: EnsTextReader;
  baseClient: RegistryReader;
  name: string;
  registry?: Address;
}): Promise<ResolvedStealthMeta> {
  const name = normalize(params.name);

  const [stealthText, registrantText] = await Promise.all([
    params.ensClient.getEnsText({ name, key: TEXT_STEALTH }),
    params.ensClient.getEnsText({ name, key: TEXT_REGISTRANT }),
  ]);
  if (!stealthText) throw new NameNotFound(name, `no "${TEXT_STEALTH}" text record`);
  if (!registrantText) throw new NameNotFound(name, `no "${TEXT_REGISTRANT}" text record`);

  const registrant = registrantText.trim();
  if (!isAddress(registrant)) throw new NameNotFound(name, `malformed "${TEXT_REGISTRANT}" record`);

  let textMeta: Hex;
  try {
    textMeta = parseMetaAddress(stealthText);
  } catch {
    throw new NameNotFound(name, `malformed "${TEXT_STEALTH}" record`);
  }

  const onchain = (await params.baseClient.readContract({
    address: params.registry ?? ERC6538_REGISTRY,
    abi: erc6538RegistryMinimalAbi,
    functionName: "stealthMetaAddressOf",
    args: [registrant, 1n],
  })) as Hex;
  if (!onchain || onchain === "0x") throw new NotRegistered(name, registrant);
  if (onchain.toLowerCase() !== textMeta) throw new MetaMismatch(name, stealthText, onchain);

  return { metaAddressURI: formatMetaAddressURI(textMeta), registrant };
}

/**
 * True if the meta-address resolved now differs from the one pinned at enrollment
 * (compared canonically, so URI vs raw bytes and hex case do not matter). A
 * malformed value counts as changed. On `true`, alert the employer; do not pay.
 */
export function pinnedMetaChanged(pinned: string, current: string): boolean {
  try {
    return parseMetaAddress(pinned) !== parseMetaAddress(current);
  } catch {
    return true;
  }
}
