/**
 * ERC-6538 registration and Soapay name claims (docs/mvp-spec.md §3, `registration.ts`).
 *
 * Pure and dependency-light (viem only, no ScopeLift SDK) so the API server can
 * import it under plain Node.
 */
import {
  encodeFunctionData,
  isAddress,
  isAddressEqual,
  parseAbi,
  parseAbiItem,
  recoverTypedDataAddress,
  type Address,
  type Hex,
  type PublicClient,
  type TypedDataDomain,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { formatMetaAddressURI, parseMetaAddress } from "./keys.js";
import { REGISTRY_ADDRESS } from "./constants.js";

/** Canonical ERC-6538 Registry (same address on every chain). Alias of `REGISTRY_ADDRESS`. */
export const ERC6538_REGISTRY: Address = REGISTRY_ADDRESS;

/** ERC-5564 scheme 1 (secp256k1 with view tags). */
const SCHEME_ID_1 = 1n;

/** The subset of ERC6538Registry used here. */
export const erc6538RegistryMinimalAbi = parseAbi([
  "function registerKeysOnBehalf(address registrant, uint256 schemeId, bytes signature, bytes stealthMetaAddress)",
  "function nonceOf(address registrant) view returns (uint256)",
  "function stealthMetaAddressOf(address registrant, uint256 schemeId) view returns (bytes)",
  "function DOMAIN_SEPARATOR() view returns (bytes32)",
]);

// ---------------------------------------------------------------------------
// ERC-6538 registerKeysOnBehalf (EIP-712)
// ---------------------------------------------------------------------------

/**
 * EIP-712 domain of ERC6538Registry, matching `_computeDomainSeparator` in
 * ScopeLift/stealth-address-erc-contracts src/ERC6538Registry.sol:
 * `EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)`
 * with name "ERC6538Registry", version "1.0". Verified against the live
 * `DOMAIN_SEPARATOR()` on Base Sepolia and Base.
 */
export function registryDomain(chainId: number, registry: Address = ERC6538_REGISTRY) {
  return {
    name: "ERC6538Registry",
    version: "1.0",
    chainId,
    verifyingContract: registry,
  } as const satisfies TypedDataDomain;
}

/** `Erc6538RegistryEntry(uint256 schemeId,bytes stealthMetaAddress,uint256 nonce)`. */
export const registryEntryTypes = {
  Erc6538RegistryEntry: [
    { name: "schemeId", type: "uint256" },
    { name: "stealthMetaAddress", type: "bytes" },
    { name: "nonce", type: "uint256" },
  ],
} as const;

/** A meta-address as a URI (`st:eth:0x…`) or as raw registry bytes. */
export type MetaAddressInput = { metaAddressURI: string } | { stealthMetaAddress: Hex };

function metaBytes(input: MetaAddressInput): Hex {
  return parseMetaAddress("metaAddressURI" in input ? input.metaAddressURI : input.stealthMetaAddress);
}

export type RegisterKeysTypedDataParams = MetaAddressInput & {
  chainId: number;
  /** Current `nonceOf(registrant)` on the registry; see `getRegistryNonce`. */
  nonce: bigint;
  registry?: Address;
};

/** Full typed data for `registerKeysOnBehalf` (sign or recover with viem). */
export function registerKeysTypedData(params: RegisterKeysTypedDataParams) {
  return {
    domain: registryDomain(params.chainId, params.registry ?? ERC6538_REGISTRY),
    types: registryEntryTypes,
    primaryType: "Erc6538RegistryEntry",
    message: {
      schemeId: SCHEME_ID_1,
      stealthMetaAddress: metaBytes(params),
      nonce: params.nonce,
    },
  } as const;
}

/**
 * Registrant's signature authorising a relayer to call
 * `registerKeysOnBehalf(registrant, 1, signature, stealthMetaAddress)`.
 */
export async function signRegisterKeysOnBehalf(
  params: RegisterKeysTypedDataParams & { registrantKey: Hex },
): Promise<Hex> {
  return privateKeyToAccount(params.registrantKey).signTypedData(registerKeysTypedData(params));
}

/** Address that produced a `registerKeysOnBehalf` signature (for API-side prechecks). */
export async function recoverRegisterKeysSigner(
  params: RegisterKeysTypedDataParams & { signature: Hex },
): Promise<Address> {
  return recoverTypedDataAddress({ ...registerKeysTypedData(params), signature: params.signature });
}

/** Minimal client surface for registry reads (any viem PublicClient fits). */
export type RegistryReader = {
  readContract(args: {
    address: Address;
    abi: typeof erc6538RegistryMinimalAbi;
    functionName: "nonceOf" | "stealthMetaAddressOf" | "DOMAIN_SEPARATOR";
    args?: readonly [] | readonly [Address] | readonly [Address, bigint];
  }): Promise<unknown>;
};

/** `nonceOf(registrant)` on the registry. Sign with this value. */
export async function getRegistryNonce(
  publicClient: RegistryReader,
  registrant: Address,
  registry: Address = ERC6538_REGISTRY,
): Promise<bigint> {
  const nonce = await publicClient.readContract({
    address: registry,
    abi: erc6538RegistryMinimalAbi,
    functionName: "nonceOf",
    args: [registrant],
  });
  if (typeof nonce !== "bigint") throw new Error("Soapay: unexpected nonceOf result");
  return nonce;
}

/** Calldata for the relayer's `registerKeysOnBehalf` transaction. */
export function buildRegisterKeysOnBehalfCall(
  params: MetaAddressInput & { registrant: Address; signature: Hex; registry?: Address },
): { to: Address; data: Hex } {
  return {
    to: params.registry ?? ERC6538_REGISTRY,
    data: encodeFunctionData({
      abi: erc6538RegistryMinimalAbi,
      functionName: "registerKeysOnBehalf",
      args: [params.registrant, SCHEME_ID_1, params.signature, metaBytes(params)],
    }),
  };
}

// ---------------------------------------------------------------------------
// Name claims (docs/mvp-spec.md: "Name claim, EIP-712")
// ---------------------------------------------------------------------------

/** 3–32 chars of [a-z0-9-], no leading/trailing hyphen, no `??--` (ENSIP-15). */
export function isValidLabel(label: string): boolean {
  return (
    /^[a-z0-9-]{3,32}$/.test(label) &&
    !label.startsWith("-") &&
    !label.endsWith("-") &&
    label.slice(2, 4) !== "--"
  );
}

export const nameClaimTypes = {
  NameClaim: [
    { name: "label", type: "string" },
    { name: "registrant", type: "address" },
    { name: "metaAddress", type: "string" },
    { name: "deadline", type: "uint256" },
  ],
} as const;

export function nameClaimDomain(chainId: number) {
  return { name: "Soapay Names", version: "1", chainId } as const satisfies TypedDataDomain;
}

export type NameClaim = {
  label: string;
  registrant: Address;
  /** Meta-address as URI or raw bytes; signed as the canonical lowercase `st:eth:0x…` URI. */
  metaAddress: string;
  /** Unix seconds. */
  deadline: bigint;
  chainId: number;
};

/** Typed data for a NameClaim. `metaAddress` is canonicalised to `st:eth:0x<lowercase>`. */
export function nameClaimTypedData(claim: NameClaim) {
  if (!isValidLabel(claim.label)) throw new Error(`Soapay: invalid label "${claim.label}"`);
  if (!isAddress(claim.registrant)) throw new Error("Soapay: invalid registrant address");
  return {
    domain: nameClaimDomain(claim.chainId),
    types: nameClaimTypes,
    primaryType: "NameClaim",
    message: {
      label: claim.label,
      registrant: claim.registrant,
      metaAddress: formatMetaAddressURI(claim.metaAddress),
      deadline: claim.deadline,
    },
  } as const;
}

/** Sign a NameClaim with the registrant key. The key must control `claim.registrant`. */
export async function signNameClaim(claim: NameClaim & { registrantKey: Hex }): Promise<Hex> {
  const account = privateKeyToAccount(claim.registrantKey);
  if (!isAddressEqual(account.address, claim.registrant)) {
    throw new Error("Soapay: registrantKey does not match registrant");
  }
  return account.signTypedData(nameClaimTypedData(claim));
}

export type NameClaimVerification =
  | { valid: true }
  | { valid: false; reason: "invalid-label" | "invalid-meta-address" | "expired" | "bad-signature" };

/**
 * Check a NameClaim: label rules, meta-address well-formed, deadline not passed
 * (`nowSeconds` defaults to the wall clock) and ECDSA signature by `registrant`.
 * Does NOT check the registry or label availability; the API does that.
 */
export async function verifyNameClaim(
  claim: NameClaim & { signature: Hex; nowSeconds?: bigint },
): Promise<NameClaimVerification> {
  if (!isValidLabel(claim.label)) return { valid: false, reason: "invalid-label" };
  try {
    parseMetaAddress(claim.metaAddress);
  } catch {
    return { valid: false, reason: "invalid-meta-address" };
  }
  const now = claim.nowSeconds ?? BigInt(Math.floor(Date.now() / 1000));
  if (claim.deadline < now) return { valid: false, reason: "expired" };
  try {
    const signer = await recoverTypedDataAddress({
      ...nameClaimTypedData(claim),
      signature: claim.signature,
    });
    if (isAddressEqual(signer, claim.registrant)) return { valid: true };
  } catch {
    // malformed signature
  }
  return { valid: false, reason: "bad-signature" };
}

// ---------------------------------------------------------------------------
// Registration block recovery (ported from CK's M1 register.ts)
// ---------------------------------------------------------------------------

/** ERC-6538 `StealthMetaAddressSet(address indexed registrant, uint256 indexed schemeId, bytes stealthMetaAddress)`. */
export const stealthMetaAddressSetEvent = parseAbiItem(
  "event StealthMetaAddressSet(address indexed registrant, uint256 indexed schemeId, bytes stealthMetaAddress)",
);

/** Minimal client surface (any viem PublicClient fits). */
export type RegistrationLogsClient = Pick<PublicClient, "getLogs" | "getBlockNumber">;

/**
 * First block in which `registrant` set a scheme-1 meta-address, for an account registered in another
 * browser: the scanner starts there instead of the Announcer deployment block. One indexed log query;
 * null when there is no such event; throws when the RPC refuses the range (the UI then asks for a block).
 */
export async function findRegistrationBlock(
  client: RegistrationLogsClient,
  registrant: Address,
  fromBlock: bigint,
  registry: Address = ERC6538_REGISTRY,
): Promise<bigint | null> {
  const toBlock = await client.getBlockNumber();
  const logs = await client.getLogs({
    address: registry,
    event: stealthMetaAddressSetEvent,
    args: { registrant, schemeId: SCHEME_ID_1 },
    fromBlock,
    toBlock,
  });
  let min: bigint | null = null;
  for (const l of logs) {
    if (l.blockNumber !== null && (min === null || l.blockNumber < min)) min = l.blockNumber;
  }
  return min;
}
