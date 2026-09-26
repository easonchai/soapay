import { describe, expect, it } from "vitest";
import {
  createPublicClient,
  createWalletClient,
  decodeFunctionData,
  encodeAbiParameters,
  getAddress,
  http,
  keccak256,
  labelhash,
  namehash,
  stringToHex,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import { keysFromMnemonic } from "../src/keys.js";
import { TEXT_KEY_REGISTRANT, TEXT_KEY_STEALTH } from "../src/constants.js";
import {
  EAC_ALL_ROLES,
  ENSV2_SEPOLIA,
  ISSUER_ROLE_BITMAP,
  REGISTRY_ROLES,
  REGISTRY_STATUS,
  RESOLVER_ROLES,
  STEALTH_WRITER_RESOURCE,
  SUBNAME_EXPIRY,
  SUBNAME_ROLE_BITMAP,
  assertSubnameLabel,
  buildDeployNameResolverCall,
  buildDeploySubnameRegistryCall,
  buildGrantIssuerRoleCall,
  buildGrantStealthWriterCall,
  buildNameResolverInit,
  buildRegisterSubnameCall,
  buildRevokeCall,
  buildRevokeIssuerRoleCall,
  buildRevokeStealthWriterCall,
  buildSetParentCall,
  buildSetStealthRecordCall,
  buildSetSubregistryCall,
  createEnsV2NameIssuer,
  dnsEncodeName,
  labelId,
  nameResolverSalt,
  permissionedRegistryAbi,
  permissionedResolverAbi,
  predictProxyAddress,
  splitName,
  textRecordResource,
  userRegistryInitAbi,
  userRegistrySalt,
  verifiableFactoryAbi,
  type EnsV2PublicClient,
  type EnsV2Writer,
} from "../src/ensv2.js";

const MNEMONIC =
  "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
const META_1 = keysFromMnemonic(MNEMONIC).metaAddressURI;
const META_2 = keysFromMnemonic(MNEMONIC, "rotated").metaAddressURI;
const META_1_RAW = META_1.slice("st:eth:".length) as Hex;

const PARENT_ADMIN = getAddress("0x1111111111111111111111111111111111111111");
const ISSUER = getAddress("0x2222222222222222222222222222222222222222");
const REGISTRANT = getAddress("0x3333333333333333333333333333333333333333");
const GUARD = getAddress("0x4444444444444444444444444444444444444444");
const REGISTRY = getAddress("0x5555555555555555555555555555555555555555");
const RESOLVER = getAddress("0x6666666666666666666666666666666666666666");
const PROXY_LOGIC = getAddress("0xC6dbA04e7c6264e85A459Dd592a6CBC2D2a6Ad8E");
const ALICE_DNS = "0x05616c69636506736f6170617903657468" + "00";

describe("ENSv2 constants", () => {
  it("role ids match the deployed RegistryRolesLib / PermissionedResolverLib", () => {
    expect(REGISTRY_ROLES.ROLE_REGISTRAR).toBe(1n);
    expect(REGISTRY_ROLES.ROLE_UNREGISTER).toBe(0x1000n);
    expect(REGISTRY_ROLES.ROLE_SET_SUBREGISTRY).toBe(0x100000n);
    expect(REGISTRY_ROLES.ROLE_SET_RESOLVER).toBe(0x1000000n);
    expect(REGISTRY_ROLES.ROLE_CAN_TRANSFER_ADMIN).toBe(0x10000000n << 128n);
    expect(RESOLVER_ROLES.ROLE_SET_ADDRESS).toBe(1n);
    expect(RESOLVER_ROLES.ROLE_SET_TEXT).toBe(0x10n);
    expect(RESOLVER_ROLES.ROLE_SET_TEXT_ADMIN).toBe(0x10n << 128n);
    expect(EAC_ALL_ROLES).toBe(BigInt(`0x${"1".repeat(64)}`));
  });

  it("the issuer only registers; subnames carry no roles and never expire", () => {
    expect(ISSUER_ROLE_BITMAP).toBe(REGISTRY_ROLES.ROLE_REGISTRAR);
    expect(SUBNAME_ROLE_BITMAP).toBe(0n);
    expect(SUBNAME_EXPIRY).toBe(2n ** 64n - 1n);
  });

  it("the stealth writer resource is keccak256(\"stealth\")", () => {
    expect(STEALTH_WRITER_RESOURCE).toBe(BigInt(keccak256(stringToHex("stealth"))));
    expect(textRecordResource(TEXT_KEY_REGISTRANT)).not.toBe(STEALTH_WRITER_RESOURCE);
  });

  it("deployment addresses are checksummed Sepolia addresses", () => {
    expect(ENSV2_SEPOLIA.chainId).toBe(11155111);
    for (const [k, v] of Object.entries(ENSV2_SEPOLIA)) {
      if (k !== "chainId") expect(getAddress(v as string)).toBe(v);
    }
  });
});

describe("ENSv2 names", () => {
  it("dns-encodes names", () => {
    expect(dnsEncodeName("alice.soapay.eth")).toBe(ALICE_DNS);
    expect(dnsEncodeName("Alice.Soapay.eth")).toBe(ALICE_DNS);
    expect(dnsEncodeName("eth")).toBe("0x0365746800");
  });

  it("splits names and validates labels", () => {
    expect(splitName("alice.soapay.eth")).toEqual({ label: "alice", parent: "soapay.eth" });
    expect(() => splitName("eth")).toThrow(/no parent/);
    expect(assertSubnameLabel("Alice")).toBe("alice");
    expect(() => assertSubnameLabel("a.b")).toThrow(/invalid label/);
    expect(() => assertSubnameLabel("")).toThrow();
    expect(() => assertSubnameLabel("a".repeat(64))).toThrow(/invalid label/);
    expect(assertSubnameLabel("a".repeat(63))).toBe("a".repeat(63));
  });

  it("labelId is the uint256 labelhash", () => {
    expect(labelId("alice")).toBe(BigInt(labelhash("alice")));
  });
});

describe("VerifiableFactory salts and addresses", () => {
  it("userRegistrySalt follows keccak256(\"UserRegistry\", namehash, version)", () => {
    const expected = BigInt(
      keccak256(
        encodeAbiParameters(
          [{ type: "bytes32" }, { type: "bytes32" }, { type: "uint256" }],
          [keccak256(stringToHex("UserRegistry")), namehash("soapay.eth"), 0n],
        ),
      ),
    );
    expect(userRegistrySalt("soapay.eth")).toBe(expected);
    expect(userRegistrySalt("soapay.eth", 1n)).not.toBe(expected);
  });

  it("predictProxyAddress matches the address the live factory produced on a Sepolia fork", () => {
    // contracts/test/ENSv2Names.fork.t.sol test_fork_predictProxyAddressVector
    expect(
      predictProxyAddress({
        factory: ENSV2_SEPOLIA.verifiableFactory,
        proxyLogic: PROXY_LOGIC,
        deployer: "0x000000000000000000000000000000000000dEaD",
        salt: 42n,
      }),
    ).toBe("0x045F805f70CC6f2A5A4d9e938c04635bF41B7851");
  });

  it("nameResolverSalt binds every input and normalises the meta-address", () => {
    const base = { name: "alice.soapay.eth", registrant: REGISTRANT, stealthWriter: REGISTRANT, metaAddress: META_1, registryResource: 7n };
    const s = nameResolverSalt(base);
    expect(nameResolverSalt({ ...base, metaAddress: META_1_RAW })).toBe(s);
    expect(nameResolverSalt({ ...base, name: "Alice.soapay.eth" })).toBe(s);
    expect(nameResolverSalt({ ...base, stealthWriter: GUARD })).not.toBe(s);
    expect(nameResolverSalt({ ...base, metaAddress: META_2 })).not.toBe(s);
    expect(nameResolverSalt({ ...base, registryResource: 8n })).not.toBe(s);
    expect(nameResolverSalt({ ...base, registrant: GUARD })).not.toBe(s);
  });
});

describe("parent setup builders", () => {
  it("deploys the subname registry with the parent admin holding every role", () => {
    const call = buildDeploySubnameRegistryCall({ admin: PARENT_ADMIN });
    expect(call.to).toBe(ENSV2_SEPOLIA.verifiableFactory);
    expect(call.salt).toBe(userRegistrySalt("soapay.eth"));
    const { functionName, args } = decodeFunctionData({ abi: verifiableFactoryAbi, data: call.data });
    expect(functionName).toBe("deployProxy");
    const [impl, salt, init] = args as [Address, bigint, Hex];
    expect(impl).toBe(ENSV2_SEPOLIA.userRegistryImpl);
    expect(salt).toBe(call.salt);
    const decoded = decodeFunctionData({ abi: userRegistryInitAbi, data: init });
    expect(decoded.args[0]).toEqual([{ account: PARENT_ADMIN, roleBitmap: EAC_ALL_ROLES }]);
  });

  it("links soapay.eth to its registry and records the parent", () => {
    const sub = buildSetSubregistryCall({ parentRegistry: ENSV2_SEPOLIA.ethRegistry, label: "soapay", subregistry: REGISTRY });
    expect(sub.to).toBe(ENSV2_SEPOLIA.ethRegistry);
    expect(decodeFunctionData({ abi: permissionedRegistryAbi, data: sub.data })).toMatchObject({
      functionName: "setSubregistry",
      args: [labelId("soapay"), REGISTRY],
    });
    const par = buildSetParentCall({ registry: REGISTRY, parentRegistry: ENSV2_SEPOLIA.ethRegistry, label: "soapay" });
    expect(par.to).toBe(REGISTRY);
    expect(decodeFunctionData({ abi: permissionedRegistryAbi, data: par.data })).toMatchObject({
      functionName: "setParent",
      args: [ENSV2_SEPOLIA.ethRegistry, "soapay"],
    });
  });

  it("grants and revokes only ROLE_REGISTRAR for the issuer", () => {
    const g = buildGrantIssuerRoleCall({ registry: REGISTRY, issuer: ISSUER });
    expect(decodeFunctionData({ abi: permissionedRegistryAbi, data: g.data })).toMatchObject({
      functionName: "grantRootRoles",
      args: [REGISTRY_ROLES.ROLE_REGISTRAR, ISSUER],
    });
    const r = buildRevokeIssuerRoleCall({ registry: REGISTRY, issuer: ISSUER });
    expect(decodeFunctionData({ abi: permissionedRegistryAbi, data: r.data })).toMatchObject({
      functionName: "revokeRootRoles",
      args: [REGISTRY_ROLES.ROLE_REGISTRAR, ISSUER],
    });
  });
});

function decodeResolverInit(init: Hex) {
  const { functionName, args } = decodeFunctionData({ abi: permissionedResolverAbi, data: init });
  expect(functionName).toBe("initialize");
  const [grants, calls] = args as [readonly { account: Address; roleBitmap: bigint }[], readonly Hex[]];
  return { grants, calls: calls.map((c) => decodeFunctionData({ abi: permissionedResolverAbi, data: c })) };
}

describe("issuance builders", () => {
  it("configures the per-name resolver atomically in initialize", () => {
    const init = buildNameResolverInit({
      name: "alice.soapay.eth",
      registrant: REGISTRANT,
      stealthWriter: REGISTRANT,
      metaAddress: META_1_RAW,
      admin: PARENT_ADMIN,
    });
    const { grants, calls } = decodeResolverInit(init);
    expect(grants).toEqual([
      { account: PARENT_ADMIN, roleBitmap: EAC_ALL_ROLES },
      { account: ENSV2_SEPOLIA.verifiableFactory, roleBitmap: RESOLVER_ROLES.ROLE_SET_TEXT_ADMIN },
    ]);
    expect(calls).toHaveLength(4);
    expect(calls[0]).toMatchObject({ functionName: "setText", args: [ALICE_DNS, TEXT_KEY_STEALTH, META_1] });
    expect(calls[1]).toMatchObject({ functionName: "setText", args: [ALICE_DNS, TEXT_KEY_REGISTRANT, REGISTRANT] });
    expect(calls[2]!.functionName).toBe("grantSetterRoles");
    const [setter, writer] = calls[2]!.args as [Hex, Address];
    expect(writer).toBe(REGISTRANT);
    expect(decodeFunctionData({ abi: permissionedResolverAbi, data: setter })).toMatchObject({
      functionName: "setText",
      args: [ALICE_DNS, TEXT_KEY_STEALTH, ""],
    });
    // The factory's bootstrap admin role is revoked in the same tx.
    expect(calls[3]).toMatchObject({
      functionName: "revokeRootRoles",
      args: [RESOLVER_ROLES.ROLE_SET_TEXT_ADMIN, ENSV2_SEPOLIA.verifiableFactory],
    });
    // No addr record is ever written.
    expect(calls.some((c) => c.functionName === "setAddress")).toBe(false);
  });

  it("defaults the stealth writer to the registrant (option A)", () => {
    const common = { name: "alice.soapay.eth", registrant: REGISTRANT, metaAddress: META_1, admin: PARENT_ADMIN, registryResource: 3n };
    const implicit = buildDeployNameResolverCall(common);
    const explicit = buildDeployNameResolverCall({ ...common, stealthWriter: REGISTRANT });
    expect(implicit).toEqual(explicit);
    expect(implicit.to).toBe(ENSV2_SEPOLIA.verifiableFactory);
    const [impl, salt, init] = decodeFunctionData({ abi: verifiableFactoryAbi, data: implicit.data }).args as [Address, bigint, Hex];
    expect(impl).toBe(ENSV2_SEPOLIA.permissionedResolverImpl);
    expect(salt).toBe(implicit.salt);
    expect(decodeResolverInit(init).calls[2]!.args[1]).toBe(REGISTRANT);

    const guarded = buildDeployNameResolverCall({ ...common, stealthWriter: GUARD });
    expect(guarded.salt).not.toBe(implicit.salt);
    const guardedInit = decodeFunctionData({ abi: verifiableFactoryAbi, data: guarded.data }).args[2] as Hex;
    expect(decodeResolverInit(guardedInit).calls[2]!.args[1]).toBe(GUARD);
  });

  it("registers a non-transferable, never-expiring subname owned by the registrant", () => {
    const call = buildRegisterSubnameCall({ registry: REGISTRY, label: "Alice", registrant: REGISTRANT, resolver: RESOLVER });
    expect(call.to).toBe(REGISTRY);
    expect(decodeFunctionData({ abi: permissionedRegistryAbi, data: call.data })).toMatchObject({
      functionName: "register",
      args: ["alice", REGISTRANT, "0x0000000000000000000000000000000000000000", RESOLVER, 0n, SUBNAME_EXPIRY],
    });
    expect(() => buildRegisterSubnameCall({ registry: REGISTRY, label: "a.b", registrant: REGISTRANT, resolver: RESOLVER })).toThrow();
  });
});

describe("stealth record rotation (option A)", () => {
  it("encodes setText(name, \"stealth\", uri) on the name's resolver", () => {
    const call = buildSetStealthRecordCall({ name: "alice.soapay.eth", metaAddress: META_2, resolver: RESOLVER.toLowerCase() as Address });
    expect(call.to).toBe(RESOLVER);
    expect(decodeFunctionData({ abi: permissionedResolverAbi, data: call.data })).toMatchObject({
      functionName: "setText",
      args: [ALICE_DNS, TEXT_KEY_STEALTH, META_2],
    });
  });

  it("each rotation targets the same resolver and only the new meta changes", () => {
    const first = buildSetStealthRecordCall({ name: "alice.soapay.eth", metaAddress: META_1_RAW, resolver: RESOLVER });
    const second = buildSetStealthRecordCall({ name: "alice.soapay.eth", metaAddress: META_2, resolver: RESOLVER });
    expect(first.to).toBe(second.to);
    expect(first.data).not.toBe(second.data);
    expect(decodeFunctionData({ abi: permissionedResolverAbi, data: first.data }).args[2]).toBe(META_1);
  });

  it("rejects malformed meta-addresses", () => {
    expect(() => buildSetStealthRecordCall({ name: "alice.soapay.eth", metaAddress: "st:eth:0x1234", resolver: RESOLVER })).toThrow();
  });
});

describe("guard-writer and revoke builders", () => {
  it("grants the guard setText on stealth only", () => {
    const call = buildGrantStealthWriterCall({ name: "alice.soapay.eth", account: GUARD, resolver: RESOLVER });
    const { functionName, args } = decodeFunctionData({ abi: permissionedResolverAbi, data: call.data });
    expect(functionName).toBe("grantSetterRoles");
    const [setter, account] = args as [Hex, Address];
    expect(account).toBe(GUARD);
    expect(decodeFunctionData({ abi: permissionedResolverAbi, data: setter }).args).toEqual([ALICE_DNS, TEXT_KEY_STEALTH, ""]);
  });

  it("revokes ROLE_SET_TEXT on the stealth resource", () => {
    const call = buildRevokeStealthWriterCall({ account: GUARD, resolver: RESOLVER });
    expect(decodeFunctionData({ abi: permissionedResolverAbi, data: call.data })).toMatchObject({
      functionName: "revokeRoles",
      args: [STEALTH_WRITER_RESOURCE, RESOLVER_ROLES.ROLE_SET_TEXT, GUARD],
    });
  });

  it("revokes a subname with unregister(labelhash)", () => {
    const call = buildRevokeCall({ registry: REGISTRY, label: "alice" });
    expect(decodeFunctionData({ abi: permissionedRegistryAbi, data: call.data })).toMatchObject({
      functionName: "unregister",
      args: [labelId("alice")],
    });
  });
});

// ---------------------------------------------------------------------------
// createEnsV2NameIssuer against in-memory clients
// ---------------------------------------------------------------------------

type Sent = { to: Address; data: Hex };

function fakeClients(opts: { isIssuer?: boolean; status?: number; resource?: bigint; existingCode?: boolean; stealth?: string } = {}) {
  const sent: Sent[] = [];
  const account = privateKeyToAccount(`0x${"11".repeat(32)}`);
  const walletClient: EnsV2Writer = {
    account,
    chain: sepolia,
    async sendTransaction({ to, data }) {
      sent.push({ to, data });
      return `0x${sent.length.toString(16).padStart(64, "0")}`;
    },
  };
  const publicClient: EnsV2PublicClient = {
    async readContract({ functionName }) {
      switch (functionName) {
        case "proxyLogic":
          return PROXY_LOGIC;
        case "hasRootRoles":
          return opts.isIssuer ?? true;
        case "getState":
          return { status: opts.status ?? REGISTRY_STATUS.AVAILABLE, expiry: 0n, latestOwner: REGISTRANT, tokenId: 1n, resource: opts.resource ?? 9n };
        case "getResolver":
          return "0x00000000000000000000000000000000000000Re".replace("Re", "e1");
        case "text":
          return opts.stealth ?? "";
        default:
          throw new Error(`unexpected read ${functionName}`);
      }
    },
    async getCode() {
      return opts.existingCode ? "0x3d60" : undefined;
    },
    async waitForTransactionReceipt() {
      return { status: "success" };
    },
  };
  return { walletClient, publicClient, sent, account };
}

describe("createEnsV2NameIssuer", () => {
  it("deploys the predicted resolver then registers the subname", async () => {
    const { walletClient, publicClient, sent, account } = fakeClients();
    const issuer = createEnsV2NameIssuer({ walletClient, publicClient, registry: REGISTRY, resolverAdmin: PARENT_ADMIN });
    const res = await issuer.issue({ label: "Alice", registrant: REGISTRANT.toLowerCase(), metaAddress: META_1_RAW });
    expect(res.name).toBe("alice.soapay.eth");
    expect(res.registry).toBe(REGISTRY);
    expect(sent).toHaveLength(2);

    const deploy = buildDeployNameResolverCall({
      name: "alice.soapay.eth",
      registrant: REGISTRANT,
      metaAddress: META_1,
      admin: PARENT_ADMIN,
      registryResource: 9n,
    });
    expect(sent[0]).toEqual({ to: deploy.to, data: deploy.data });
    const predicted = predictProxyAddress({
      factory: ENSV2_SEPOLIA.verifiableFactory,
      proxyLogic: PROXY_LOGIC,
      deployer: account.address,
      salt: deploy.salt,
    });
    expect(res.resolver).toBe(predicted);
    expect(sent[1]).toEqual(buildRegisterSubnameCall({ registry: REGISTRY, label: "alice", registrant: REGISTRANT, resolver: predicted }));
    expect(res.resolverTxHash).toBeDefined();
  });

  it("uses a guard as stealth writer when asked", async () => {
    const { walletClient, publicClient, sent } = fakeClients();
    const issuer = createEnsV2NameIssuer({ walletClient, publicClient, registry: REGISTRY, resolverAdmin: PARENT_ADMIN, defaultStealthWriter: GUARD });
    await issuer.issue({ label: "bob", registrant: REGISTRANT, metaAddress: META_1 });
    const init = decodeFunctionData({ abi: verifiableFactoryAbi, data: sent[0]!.data }).args[2] as Hex;
    expect(decodeResolverInit(init).calls[2]!.args[1]).toBe(GUARD);
  });

  it("reuses a resolver left by an earlier attempt", async () => {
    const { walletClient, publicClient, sent } = fakeClients({ existingCode: true });
    const issuer = createEnsV2NameIssuer({ walletClient, publicClient, registry: REGISTRY, resolverAdmin: PARENT_ADMIN });
    const res = await issuer.issue({ label: "alice", registrant: REGISTRANT, metaAddress: META_1 });
    expect(sent).toHaveLength(1);
    expect(res.resolverTxHash).toBeUndefined();
  });

  it("finishes a claim an interrupted request already issued (same registrant, same meta-address)", async () => {
    const done = fakeClients({ status: REGISTRY_STATUS.REGISTERED, stealth: META_1 });
    const res = await createEnsV2NameIssuer({ ...done, registry: REGISTRY, resolverAdmin: PARENT_ADMIN }).issue({
      label: "alice",
      registrant: REGISTRANT,
      metaAddress: META_1,
    });
    expect(res.recovered).toBe(true);
    expect(res.txHash).toBeUndefined();
    expect(done.sent).toHaveLength(0);
  });

  it("refuses taken names, non-issuers and bad input", async () => {
    const taken = fakeClients({ status: REGISTRY_STATUS.REGISTERED });
    await expect(
      createEnsV2NameIssuer({ ...taken, registry: REGISTRY, resolverAdmin: PARENT_ADMIN }).issue({ label: "alice", registrant: REGISTRANT, metaAddress: META_1 }),
    ).rejects.toThrow(/already taken/);

    const notIssuer = fakeClients({ isIssuer: false });
    await expect(
      createEnsV2NameIssuer({ ...notIssuer, registry: REGISTRY, resolverAdmin: PARENT_ADMIN }).issue({ label: "alice", registrant: REGISTRANT, metaAddress: META_1 }),
    ).rejects.toThrow(/ROLE_REGISTRAR/);

    const ok = fakeClients();
    const issuer = createEnsV2NameIssuer({ ...ok, registry: REGISTRY, resolverAdmin: PARENT_ADMIN });
    await expect(issuer.issue({ label: "alice", registrant: "nope", metaAddress: META_1 })).rejects.toThrow(/registrant/);
    await expect(issuer.issue({ label: "alice", registrant: REGISTRANT, metaAddress: "0x12" })).rejects.toThrow();
    expect(ok.sent).toHaveLength(0);
  });

  it("requires a wallet account", () => {
    const { publicClient } = fakeClients();
    expect(() =>
      createEnsV2NameIssuer({ walletClient: { account: undefined, chain: sepolia, sendTransaction: async () => "0x" }, publicClient }),
    ).toThrow(/account/);
  });

  it("accepts real viem clients (type-level)", () => {
    const transport = http("http://127.0.0.1:1");
    const walletClient = createWalletClient({ account: privateKeyToAccount(`0x${"11".repeat(32)}`), chain: sepolia, transport });
    const publicClient = createPublicClient({ chain: sepolia, transport });
    const issuer = createEnsV2NameIssuer({ walletClient, publicClient, registry: REGISTRY, resolverAdmin: PARENT_ADMIN });
    expect(typeof issuer.issue).toBe("function");
  });
});
