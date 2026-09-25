/**
 * Soapay names as real ENSv2 subnames on Ethereum Sepolia (docs/mvp-spec.md §2).
 *
 * Every address, role id and call below comes from the live ENSv2 deployment
 * (ensdomains/contracts-v2 @ 71a3b73, deployed 2026-09-15, the set listed on
 * docs.ens.domains/learn/deployments "Sepolia (ENSv2 Beta)"). contracts/ENSV2.md
 * documents each call; contracts/test/ENSv2Names.fork.t.sol proves the flow on a
 * Sepolia fork against the deployed contracts.
 *
 * Model:
 * - `soapay.eth` (in the .eth PermissionedRegistry) points at its own
 *   UserRegistry (a PermissionedRegistry proxy) deployed through the
 *   VerifiableFactory. The soapay.eth owner holds every root role on it.
 * - The API issuer holds ONLY `ROLE_REGISTRAR` on that registry's root.
 * - Each `label.soapay.eth` gets its OWN PermissionedResolver proxy, configured
 *   atomically in `initialize`: text `stealth` = meta-address URI, text
 *   `soapay:registrant` = registrant, no `addr`. The parent admin holds every
 *   root role on it; the stealth writer (the registrant by default, or a guard
 *   contract) holds `ROLE_SET_TEXT` on the `keccak256("stealth")` resource only.
 * - The subname token goes to the registrant with an EMPTY role bitmap: no
 *   `ROLE_CAN_TRANSFER_ADMIN` (non-transferable), no resolver/subregistry
 *   rights. The parent keeps `ROLE_UNREGISTER` on root, so it can revoke.
 *
 * Pure and viem-only (no ScopeLift SDK) so the API server can import it.
 */
import {
  concat,
  encodeAbiParameters,
  encodeFunctionData,
  getAddress,
  getContractAddress,
  isAddress,
  keccak256,
  labelhash,
  namehash,
  parseAbi,
  stringToHex,
  toHex,
  zeroAddress,
  type Account,
  type Address,
  type Chain,
  type Hex,
} from "viem";
import { normalize, packetToBytes } from "viem/ens";
import { sepolia } from "viem/chains";
import { formatMetaAddressURI } from "./keys.js";
import { PARENT_NAME, TEXT_KEY_REGISTRANT, TEXT_KEY_STEALTH } from "./constants.js";

// ---------------------------------------------------------------------------
// Deployment (Sepolia, chain 11155111). Every address verified with eth_getCode.
// ---------------------------------------------------------------------------

export const ENSV2_SEPOLIA = {
  chainId: sepolia.id,
  rootRegistry: "0x9703DBD26dAB89504490994138cF2c575251a9cE",
  ethRegistry: "0x657eA849311d3D5823348ddEd7C2AaAFb3EDE09E",
  ethRegistrar: "0xAbe76F6C8DFcEd81AA5A2bB8034202A7136b94ca",
  verifiableFactory: "0x9e726Eb570beb6BCEb495AB8cdA7df517d4e841C",
  userRegistryImpl: "0xA80338aAA8D23831cEa25E858D1774534aBb0263",
  permissionedResolverImpl: "0x14F09Fd05d4585759e54844DC9B00147131Cf243",
  /** viem's default `ensUniversalResolver` on Sepolia; proxies to UniversalResolverV2. */
  universalResolver: "0xeEeEEEeE14D718C2B47D9923Deab1335E144EeEe",
  universalResolverV2: "0x5d25C1D6aCBb71B7a28AA7899618a3412a8303e3",
  /** Testnet stablecoin accepted by the ETHRegistrar's price oracle (public `mint`). */
  mockUsdc: "0x16f95D91DBa7dA3Aca778Ec053dF0FF6C6A8aA8e",
} as const satisfies Record<string, Address | number>;

export type EnsV2Deployment = typeof ENSV2_SEPOLIA;
type Deployment = { [K in keyof EnsV2Deployment]: EnsV2Deployment[K] extends number ? number : Address };

// ---------------------------------------------------------------------------
// Enhanced Access Control role ids (one nybble per role, admin = role << 128).
// ---------------------------------------------------------------------------

/** Every role and every admin role (`EACBaseRolesLib.ALL_ROLES`). */
export const EAC_ALL_ROLES = 0x1111111111111111111111111111111111111111111111111111111111111111n;
/** EAC `ROOT_RESOURCE`: roles here apply to every resource of the contract. */
export const EAC_ROOT_RESOURCE = 0n;

/** PermissionedRegistry roles (`RegistryRolesLib`). */
export const REGISTRY_ROLES = {
  ROLE_REGISTRAR: 1n << 0n,
  ROLE_REGISTER_RESERVED: 1n << 4n,
  ROLE_SET_PARENT: 1n << 8n,
  ROLE_UNREGISTER: 1n << 12n,
  ROLE_RENEW: 1n << 16n,
  ROLE_SET_SUBREGISTRY: 1n << 20n,
  ROLE_SET_RESOLVER: 1n << 24n,
  ROLE_CAN_TRANSFER_ADMIN: (1n << 28n) << 128n,
  ROLE_SET_URI: 1n << 36n,
  ROLE_UPGRADE: 1n << 124n,
} as const;

/** PermissionedResolver roles (`PermissionedResolverLib`). */
export const RESOLVER_ROLES = {
  ROLE_SET_ADDRESS: 1n << 0n,
  ROLE_SET_TEXT: 1n << 4n,
  ROLE_SET_TEXT_ADMIN: (1n << 4n) << 128n,
  ROLE_SET_CONTENTHASH: 1n << 8n,
  ROLE_SET_ABI: 1n << 12n,
  ROLE_SET_INTERFACE: 1n << 16n,
  ROLE_SET_NAME: 1n << 20n,
  ROLE_SET_DATA: 1n << 24n,
  ROLE_LINK: 1n << 28n,
  ROLE_UPGRADE: 1n << 124n,
} as const;

/** Roles the issuer gets on the subname registry: register new names, nothing else. */
export const ISSUER_ROLE_BITMAP = REGISTRY_ROLES.ROLE_REGISTRAR;
/** Roles each subname token carries: none, so it can't be transferred or re-pointed. */
export const SUBNAME_ROLE_BITMAP = 0n;
/** Subnames never expire; only the parent's `unregister` removes them. */
export const SUBNAME_EXPIRY = (1n << 64n) - 1n;

/** PermissionedResolver EAC resource for one `setText(key)` argument: `keccak256(bytes(key))`. */
export function textRecordResource(key: string): bigint {
  return BigInt(keccak256(stringToHex(key)));
}
/** The resource the stealth writer role lives on. */
export const STEALTH_WRITER_RESOURCE = textRecordResource(TEXT_KEY_STEALTH);

// ---------------------------------------------------------------------------
// ABIs (subset of the deployed contracts)
// ---------------------------------------------------------------------------

export const verifiableFactoryAbi = parseAbi([
  "function deployProxy(address implementation, uint256 salt, bytes data) returns (address)",
  "function proxyLogic() view returns (address)",
  "function verifyContract(address proxy) view returns (address)",
  "event ProxyDeployed(address indexed sender, address indexed proxyAddress, uint256 salt, address implementation)",
]);

export const userRegistryInitAbi = parseAbi([
  "function initialize((address account, uint256 roleBitmap)[] grants)",
]);

export const permissionedRegistryAbi = parseAbi([
  "struct State { uint8 status; uint64 expiry; address latestOwner; uint256 tokenId; uint256 resource; }",
  "function register(string label, address owner, address registry, address resolver, uint256 roleBitmap, uint64 expiry) returns (uint256)",
  "function unregister(uint256 anyId)",
  "function renew(uint256 anyId, uint64 newExpiry)",
  "function setSubregistry(uint256 anyId, address registry)",
  "function setResolver(uint256 anyId, address resolver)",
  "function setParent(address parent, string label)",
  "function getSubregistry(string label) view returns (address)",
  "function getResolver(string label) view returns (address)",
  "function getParent() view returns (address parent, string label)",
  "function getState(uint256 anyId) view returns (State)",
  "function ownerOf(uint256 tokenId) view returns (address)",
  "function grantRootRoles(uint256 roleBitmap, address account) returns (bool)",
  "function revokeRootRoles(uint256 roleBitmap, address account) returns (bool)",
  "function roles(uint256 resource, address account) view returns (uint256)",
  "function hasRootRoles(uint256 roleBitmap, address account) view returns (bool)",
  "error EACUnauthorizedAccountRoles(uint256 resource, uint256 roleBitmap, address account)",
  "error EACCannotGrantRoles(uint256 resource, uint256 roleBitmap, address account)",
  "error LabelAlreadyRegistered(string label)",
  "error LabelExpired(uint256 tokenId)",
  "error TransferDisallowed(uint256 tokenId, address from)",
  "error TransferUnsafeUntilRegistryIsEmancipated()",
]);

export const permissionedResolverAbi = parseAbi([
  "function initialize((address account, uint256 roleBitmap)[] grants, bytes[] calls)",
  "function setText(bytes name, string key, string value)",
  "function setAddress(bytes name, uint256 coinType, bytes addressBytes)",
  "function grantSetterRoles(bytes setter, address account) returns (bool)",
  "function revokeRoles(uint256 resource, uint256 roleBitmap, address account) returns (bool)",
  "function revokeRootRoles(uint256 roleBitmap, address account) returns (bool)",
  "function roles(uint256 resource, address account) view returns (uint256)",
  "function multicall(bytes[] calls) returns (bytes[])",
  "function resolve(bytes name, bytes data) view returns (bytes)",
  "error EACUnauthorizedAccountRoles(uint256 resource, uint256 roleBitmap, address account)",
]);

// ---------------------------------------------------------------------------
// Names
// ---------------------------------------------------------------------------

export type Call = { to: Address; data: Hex };

/** DNS wire-format name (ENSIP-10), as ENSv2 setters and the Universal Resolver take it. */
export function dnsEncodeName(name: string): Hex {
  return toHex(packetToBytes(normalize(name)));
}

/** Split `label.parent` into its first label and the parent name. */
export function splitName(name: string): { label: string; parent: string } {
  const n = normalize(name);
  const i = n.indexOf(".");
  if (i <= 0 || i === n.length - 1) throw new Error(`Soapay ENSv2: "${name}" has no parent`);
  return { label: n.slice(0, i), parent: n.slice(i + 1) };
}

/** A subname label: one normalized label, no dots, 1-63 bytes. */
export function assertSubnameLabel(label: string): string {
  const l = normalize(label);
  if (l.length === 0 || l.includes(".") || new TextEncoder().encode(l).length > 63) {
    throw new Error(`Soapay ENSv2: invalid label "${label}"`);
  }
  return l;
}

/** `anyId` for a label in a PermissionedRegistry: `uint256(keccak256(label))`. */
export function labelId(label: string): bigint {
  return BigInt(labelhash(label));
}

// ---------------------------------------------------------------------------
// VerifiableFactory salts and address prediction
// ---------------------------------------------------------------------------

/** ENS's salt scheme for a per-name subname registry: keccak256("UserRegistry", namehash, version). */
export function userRegistrySalt(parent: string, version = 0n): bigint {
  return BigInt(
    keccak256(
      encodeAbiParameters(
        [{ type: "bytes32" }, { type: "bytes32" }, { type: "uint256" }],
        [keccak256(stringToHex("UserRegistry")), namehash(normalize(parent)), version],
      ),
    ),
  );
}

/**
 * Salt for a subname's own resolver. Binds the name, its registrant, the pre-issue
 * registry resource (which changes after every revoke, so a re-issue gets a fresh
 * resolver) and the initial records, so a retry with identical inputs can reuse a
 * resolver whose `register` tx never landed.
 */
export function nameResolverSalt(args: {
  name: string;
  registrant: Address;
  stealthWriter: Address;
  metaAddress: string;
  registryResource: bigint;
}): bigint {
  return BigInt(
    keccak256(
      encodeAbiParameters(
        [
          { type: "bytes32" },
          { type: "bytes32" },
          { type: "address" },
          { type: "address" },
          { type: "bytes32" },
          { type: "uint256" },
        ],
        [
          keccak256(stringToHex("SoapayNameResolver")),
          namehash(normalize(args.name)),
          getAddress(args.registrant),
          getAddress(args.stealthWriter),
          keccak256(stringToHex(formatMetaAddressURI(args.metaAddress))),
          args.registryResource,
        ],
      ),
    ),
  );
}

/** CREATE2 address of `deployProxy(_, salt, _)` sent by `deployer` (docs: ensv2/verifiable-factory). */
export function predictProxyAddress(args: {
  factory: Address;
  proxyLogic: Address;
  deployer: Address;
  salt: bigint;
}): Address {
  const outerSalt = keccak256(
    encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [args.deployer, args.salt]),
  );
  const bytecode = concat([
    "0x3d604d80600a3d3981f3363d3d373d3d3d363d73",
    args.proxyLogic,
    "0x5af43d82803e903d91602b57fd5bf3",
    outerSalt,
  ]);
  return getContractAddress({ opcode: "CREATE2", from: args.factory, salt: outerSalt, bytecode });
}

// ---------------------------------------------------------------------------
// (a) + (b) Parent setup: run once by the soapay.eth owner
// ---------------------------------------------------------------------------

/** Deploy soapay.eth's own UserRegistry; `admin` (the parent owner) gets every root role. */
export function buildDeploySubnameRegistryCall(args: {
  parent?: string;
  admin: Address;
  version?: bigint;
  deployment?: Deployment;
}): Call & { salt: bigint } {
  const d = args.deployment ?? ENSV2_SEPOLIA;
  const salt = userRegistrySalt(args.parent ?? PARENT_NAME, args.version ?? 0n);
  const init = encodeFunctionData({
    abi: userRegistryInitAbi,
    functionName: "initialize",
    args: [[{ account: getAddress(args.admin), roleBitmap: EAC_ALL_ROLES }]],
  });
  return {
    to: d.verifiableFactory,
    salt,
    data: encodeFunctionData({
      abi: verifiableFactoryAbi,
      functionName: "deployProxy",
      args: [d.userRegistryImpl, salt, init],
    }),
  };
}

/** Point `soapay.eth` at its subname registry (sent to the registry holding `soapay`, i.e. .eth). */
export function buildSetSubregistryCall(args: {
  parentRegistry: Address;
  label: string;
  subregistry: Address;
}): Call {
  return {
    to: args.parentRegistry,
    data: encodeFunctionData({
      abi: permissionedRegistryAbi,
      functionName: "setSubregistry",
      args: [labelId(args.label), args.subregistry],
    }),
  };
}

/** Record the canonical parent (`.eth` registry, "soapay") on the subname registry. */
export function buildSetParentCall(args: { registry: Address; parentRegistry: Address; label: string }): Call {
  return {
    to: args.registry,
    data: encodeFunctionData({
      abi: permissionedRegistryAbi,
      functionName: "setParent",
      args: [args.parentRegistry, args.label],
    }),
  };
}

/** Grant the API issuer `ROLE_REGISTRAR` (and nothing else) on the subname registry root. */
export function buildGrantIssuerRoleCall(args: { registry: Address; issuer: Address }): Call {
  return {
    to: args.registry,
    data: encodeFunctionData({
      abi: permissionedRegistryAbi,
      functionName: "grantRootRoles",
      args: [ISSUER_ROLE_BITMAP, getAddress(args.issuer)],
    }),
  };
}

/** Remove the issuer (key rotation or compromise). */
export function buildRevokeIssuerRoleCall(args: { registry: Address; issuer: Address }): Call {
  return {
    to: args.registry,
    data: encodeFunctionData({
      abi: permissionedRegistryAbi,
      functionName: "revokeRootRoles",
      args: [ISSUER_ROLE_BITMAP, getAddress(args.issuer)],
    }),
  };
}

// ---------------------------------------------------------------------------
// (c) Issue a subname: two transactions by the issuer
// ---------------------------------------------------------------------------

function setTextData(dnsName: Hex, key: string, value: string): Hex {
  return encodeFunctionData({ abi: permissionedResolverAbi, functionName: "setText", args: [dnsName, key, value] });
}

/** The `setter` argument of `grantSetterRoles`, selecting `setText(<any name>, "stealth", _)`. */
function stealthSetter(dnsName: Hex): Hex {
  return setTextData(dnsName, TEXT_KEY_STEALTH, "");
}

/**
 * `initialize` calldata for a subname's own PermissionedResolver.
 *
 * `grantSetterRoles` checks the CALLER's admin roles even during initialisation,
 * and the caller of `initialize` is the VerifiableFactory. So the factory gets a
 * bootstrap `ROLE_SET_TEXT_ADMIN` that the last call revokes, in the same tx.
 * The factory can't make arbitrary calls, and the fork test asserts it ends with
 * no role.
 */
export function buildNameResolverInit(args: {
  name: string;
  registrant: Address;
  stealthWriter: Address;
  metaAddress: string;
  admin: Address;
  deployment?: Deployment;
}): Hex {
  const d = args.deployment ?? ENSV2_SEPOLIA;
  const dnsName = dnsEncodeName(args.name);
  const calls: Hex[] = [
    setTextData(dnsName, TEXT_KEY_STEALTH, formatMetaAddressURI(args.metaAddress)),
    setTextData(dnsName, TEXT_KEY_REGISTRANT, getAddress(args.registrant)),
    encodeFunctionData({
      abi: permissionedResolverAbi,
      functionName: "grantSetterRoles",
      args: [stealthSetter(dnsName), getAddress(args.stealthWriter)],
    }),
    encodeFunctionData({
      abi: permissionedResolverAbi,
      functionName: "revokeRootRoles",
      args: [RESOLVER_ROLES.ROLE_SET_TEXT_ADMIN, d.verifiableFactory],
    }),
  ];
  return encodeFunctionData({
    abi: permissionedResolverAbi,
    functionName: "initialize",
    args: [
      [
        { account: getAddress(args.admin), roleBitmap: EAC_ALL_ROLES },
        { account: d.verifiableFactory, roleBitmap: RESOLVER_ROLES.ROLE_SET_TEXT_ADMIN },
      ],
      calls,
    ],
  });
}

/** Tx 1 of issuance: deploy + configure the name's own resolver. */
export function buildDeployNameResolverCall(args: {
  name: string;
  registrant: Address;
  stealthWriter?: Address;
  metaAddress: string;
  admin: Address;
  registryResource: bigint;
  deployment?: Deployment;
}): Call & { salt: bigint } {
  const d = args.deployment ?? ENSV2_SEPOLIA;
  const stealthWriter = args.stealthWriter ?? args.registrant;
  const salt = nameResolverSalt({
    name: args.name,
    registrant: args.registrant,
    stealthWriter,
    metaAddress: args.metaAddress,
    registryResource: args.registryResource,
  });
  const init = buildNameResolverInit({ ...args, stealthWriter, deployment: d });
  return {
    to: d.verifiableFactory,
    salt,
    data: encodeFunctionData({
      abi: verifiableFactoryAbi,
      functionName: "deployProxy",
      args: [d.permissionedResolverImpl, salt, init],
    }),
  };
}

/** Tx 2 of issuance: register the non-transferable subname, owned by the registrant. */
export function buildRegisterSubnameCall(args: {
  registry: Address;
  label: string;
  registrant: Address;
  resolver: Address;
}): Call {
  return {
    to: args.registry,
    data: encodeFunctionData({
      abi: permissionedRegistryAbi,
      functionName: "register",
      args: [
        assertSubnameLabel(args.label),
        getAddress(args.registrant),
        zeroAddress,
        getAddress(args.resolver),
        SUBNAME_ROLE_BITMAP,
        SUBNAME_EXPIRY,
      ],
    }),
  };
}

// ---------------------------------------------------------------------------
// (d) Registrant / guard: rotate the stealth record
// ---------------------------------------------------------------------------

/**
 * `setText(name, "stealth", <meta-address URI>)` on the name's resolver. Sent by
 * the stealth writer (the registrant key, or the World ID guard). Find the
 * resolver with `getEnsResolver` / `findNameResolver`.
 */
export function buildSetStealthRecordCall(args: { name: string; metaAddress: string; resolver: Address }): Call {
  return {
    to: getAddress(args.resolver),
    data: setTextData(dnsEncodeName(args.name), TEXT_KEY_STEALTH, formatMetaAddressURI(args.metaAddress)),
  };
}

/** Grant `account` (e.g. a SoapayNameGuard) the right to set ONLY `stealth`. Sent by the parent admin. */
export function buildGrantStealthWriterCall(args: { name: string; account: Address; resolver: Address }): Call {
  return {
    to: getAddress(args.resolver),
    data: encodeFunctionData({
      abi: permissionedResolverAbi,
      functionName: "grantSetterRoles",
      args: [stealthSetter(dnsEncodeName(args.name)), getAddress(args.account)],
    }),
  };
}

/** Revoke `account`'s stealth-writer role. Sent by the parent admin. */
export function buildRevokeStealthWriterCall(args: { account: Address; resolver: Address }): Call {
  return {
    to: getAddress(args.resolver),
    data: encodeFunctionData({
      abi: permissionedResolverAbi,
      functionName: "revokeRoles",
      args: [STEALTH_WRITER_RESOURCE, RESOLVER_ROLES.ROLE_SET_TEXT, getAddress(args.account)],
    }),
  };
}

// ---------------------------------------------------------------------------
// (e) Parent: revoke a subname
// ---------------------------------------------------------------------------

/** `unregister(labelhash)` on the subname registry. Sent by the parent (holds `ROLE_UNREGISTER`). */
export function buildRevokeCall(args: { registry: Address; label: string }): Call {
  return {
    to: getAddress(args.registry),
    data: encodeFunctionData({
      abi: permissionedRegistryAbi,
      functionName: "unregister",
      args: [labelId(assertSubnameLabel(args.label))],
    }),
  };
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/** Structural subset of a viem PublicClient. */
export type EnsV2Reader = {
  readContract(args: {
    address: Address;
    abi: readonly unknown[];
    functionName: string;
    args?: readonly unknown[];
  }): Promise<unknown>;
  getCode(args: { address: Address }): Promise<Hex | undefined>;
};

export type RegistryState = {
  status: number;
  expiry: bigint;
  latestOwner: Address;
  tokenId: bigint;
  resource: bigint;
};

export const REGISTRY_STATUS = { AVAILABLE: 0, RESERVED: 1, REGISTERED: 2 } as const;

/** Walk the ENSv2 registry hierarchy from the root to the registry that holds `name`'s children. */
export async function findSubregistry(
  client: EnsV2Reader,
  name: string,
  deployment: Deployment = ENSV2_SEPOLIA,
): Promise<Address> {
  let registry: Address = deployment.rootRegistry;
  for (const label of normalize(name).split(".").reverse()) {
    registry = (await client.readContract({
      address: registry,
      abi: permissionedRegistryAbi,
      functionName: "getSubregistry",
      args: [label],
    })) as Address;
    if (registry === zeroAddress) throw new Error(`Soapay ENSv2: ${name} has no subname registry`);
  }
  return registry;
}

export async function getRegistryState(client: EnsV2Reader, registry: Address, label: string): Promise<RegistryState> {
  return (await client.readContract({
    address: registry,
    abi: permissionedRegistryAbi,
    functionName: "getState",
    args: [labelId(label)],
  })) as RegistryState;
}

/** The token owner of `name` in its parent registry (e.g. the soapay.eth owner). */
export async function getNameOwner(
  client: EnsV2Reader,
  name: string,
  deployment: Deployment = ENSV2_SEPOLIA,
): Promise<Address> {
  const { label, parent } = splitName(name);
  const registry = await findSubregistry(client, parent, deployment);
  const state = await getRegistryState(client, registry, label);
  if (state.status !== REGISTRY_STATUS.REGISTERED) throw new Error(`Soapay ENSv2: ${name} is not registered`);
  return state.latestOwner;
}

// ---------------------------------------------------------------------------
// Issuer (the API's NameIssuer)
// ---------------------------------------------------------------------------

/** Structural subset of a viem WalletClient with an account. */
export type EnsV2Writer = {
  account: Account | undefined;
  chain: Chain | undefined;
  sendTransaction(args: { account: Account; chain: Chain | null; to: Address; data: Hex }): Promise<Hex>;
};

export type EnsV2PublicClient = EnsV2Reader & {
  waitForTransactionReceipt(args: { hash: Hex }): Promise<{ status: "success" | "reverted" }>;
};

export type IssueArgs = {
  label: string;
  /** Owner of the subname token and value of `soapay:registrant`. */
  registrant: string;
  /** Meta-address URI (`st:eth:0x…`) or raw 66-byte hex. */
  metaAddress: string;
  /** Who may rewrite `stealth`. Defaults to the registrant (or the issuer's `defaultStealthWriter`). */
  stealthWriter?: string;
};

export type IssueResult = {
  /** The `register` transaction (the name exists once it is mined). */
  txHash: Hex;
  /** The resolver deployment transaction, if one was sent. */
  resolverTxHash?: Hex;
  name: string;
  resolver: Address;
  registry: Address;
};

export type EnsV2NameIssuer = {
  issue(args: IssueArgs): Promise<IssueResult>;
};

export function createEnsV2NameIssuer(opts: {
  walletClient: EnsV2Writer;
  publicClient: EnsV2PublicClient;
  parent?: string;
  /** soapay.eth's subname registry; looked up through the ENSv2 hierarchy when omitted. */
  registry?: Address;
  /** Root admin of every issued resolver; defaults to the parent name's current owner. */
  resolverAdmin?: Address;
  /** Default stealth writer (e.g. the World ID guard); falls back to each registrant. */
  defaultStealthWriter?: Address;
  deployment?: Deployment;
}): EnsV2NameIssuer {
  const d = opts.deployment ?? ENSV2_SEPOLIA;
  const parent = normalize(opts.parent ?? PARENT_NAME);
  const account = opts.walletClient.account;
  if (!account) throw new Error("Soapay ENSv2: walletClient needs an account (the issuer key)");
  let setup: Promise<{ registry: Address; admin: Address; proxyLogic: Address }> | undefined;

  const loadSetup = () =>
    (setup ??= (async () => {
      const registry = opts.registry ?? (await findSubregistry(opts.publicClient, parent, d));
      const admin = opts.resolverAdmin ?? (await getNameOwner(opts.publicClient, parent, d));
      const proxyLogic = (await opts.publicClient.readContract({
        address: d.verifiableFactory,
        abi: verifiableFactoryAbi,
        functionName: "proxyLogic",
      })) as Address;
      const isIssuer = (await opts.publicClient.readContract({
        address: registry,
        abi: permissionedRegistryAbi,
        functionName: "hasRootRoles",
        args: [ISSUER_ROLE_BITMAP, account.address],
      })) as boolean;
      if (!isIssuer) throw new Error(`Soapay ENSv2: ${account.address} lacks ROLE_REGISTRAR on ${parent}'s registry`);
      return { registry, admin, proxyLogic };
    })().catch((e: unknown) => {
      setup = undefined;
      throw e;
    }));

  const send = async (call: Call): Promise<Hex> => {
    const hash = await opts.walletClient.sendTransaction({
      account,
      chain: opts.walletClient.chain ?? null,
      to: call.to,
      data: call.data,
    });
    const receipt = await opts.publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new Error(`Soapay ENSv2: tx ${hash} reverted`);
    return hash;
  };

  return {
    async issue(args) {
      const label = assertSubnameLabel(args.label);
      if (!isAddress(args.registrant)) throw new Error("Soapay ENSv2: registrant must be an address");
      const registrant = getAddress(args.registrant);
      const writerInput = args.stealthWriter ?? opts.defaultStealthWriter ?? registrant;
      if (!isAddress(writerInput)) throw new Error("Soapay ENSv2: stealthWriter must be an address");
      const stealthWriter = getAddress(writerInput);
      const metaAddress = formatMetaAddressURI(args.metaAddress); // validates both points
      const name = `${label}.${parent}`;

      const { registry, admin, proxyLogic } = await loadSetup();
      const state = await getRegistryState(opts.publicClient, registry, label);
      if (state.status !== REGISTRY_STATUS.AVAILABLE) throw new Error(`Soapay ENSv2: ${name} is already taken`);

      const deploy = buildDeployNameResolverCall({
        name,
        registrant,
        stealthWriter,
        metaAddress,
        admin,
        registryResource: state.resource,
        deployment: d,
      });
      const resolver = predictProxyAddress({
        factory: d.verifiableFactory,
        proxyLogic,
        deployer: account.address,
        salt: deploy.salt,
      });
      const code = await opts.publicClient.getCode({ address: resolver });
      // Same salt => same inputs: a resolver left by an earlier attempt is already configured.
      const resolverTxHash = code && code !== "0x" ? undefined : await send(deploy);
      const txHash = await send(buildRegisterSubnameCall({ registry, label, registrant, resolver }));
      return { txHash, name, resolver, registry, ...(resolverTxHash ? { resolverTxHash } : {}) };
    },
  };
}
