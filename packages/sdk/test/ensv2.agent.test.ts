import { describe, expect, it } from "vitest";
import { decodeFunctionData, getAddress, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import { keysFromMnemonic } from "../src/keys.js";
import { TEXT_KEY_REGISTRANT, TEXT_KEY_STEALTH } from "../src/constants.js";
import {
  AgentMetadataError,
  REGISTRY_STATUS,
  TEXT_KEY_AGENT_CONTEXT,
  agentEndpointKey,
  agentRegistrationKey,
  agentTextRecords,
  buildDeployNameResolverCall,
  buildNameResolverInit,
  createEnsV2NameIssuer,
  nameResolverSalt,
  permissionedResolverAbi,
  verifiableFactoryAbi,
  type AgentMetadata,
  type EnsV2PublicClient,
  type EnsV2Writer,
} from "../src/ensv2.js";

const META = keysFromMnemonic("abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about").metaAddressURI;
const ADMIN = getAddress("0x1111111111111111111111111111111111111111");
const REGISTRANT = getAddress("0x3333333333333333333333333333333333333333");
const REGISTRY = getAddress("0x5555555555555555555555555555555555555555");
// ERC-8004 registry on Ethereum mainnet, ERC-7930 encoded (the ENSIP-25 example).
const ERC7930 = "0x000100000101148004a169fb4a3325136eb29fa0ceb6d2e539a432" as Hex;

const AGENT: AgentMetadata = {
  context: "Soapay payroll agent. Pays names in USDC on Base.",
  endpoints: { web: "https://soapay.example/agents/bot", mcp: "https://mcp.soapay.example" },
  registrations: [{ registry: ERC7930, agentId: "167" }],
};

function initCalls(init: Hex) {
  const { args } = decodeFunctionData({ abi: permissionedResolverAbi, data: init });
  return (args[1] as readonly Hex[]).map((c) => decodeFunctionData({ abi: permissionedResolverAbi, data: c }));
}

describe("agentTextRecords (ENSIP-25/26)", () => {
  it("maps metadata to the spec keys in a stable order", () => {
    expect(agentTextRecords(AGENT)).toEqual([
      { key: "agent-context", value: AGENT.context },
      { key: "agent-endpoint[mcp]", value: "https://mcp.soapay.example" },
      { key: "agent-endpoint[web]", value: "https://soapay.example/agents/bot" },
      { key: `agent-registration[${ERC7930}][167]`, value: "1" },
    ]);
    expect(TEXT_KEY_AGENT_CONTEXT).toBe("agent-context");
    expect(agentEndpointKey("a2a")).toBe("agent-endpoint[a2a]");
    expect(agentRegistrationKey(ERC7930.toUpperCase().replace("0X", "0x") as Hex, "1")).toBe(`agent-registration[${ERC7930}][1]`);
  });

  it("context alone is enough; ipfs endpoints are allowed", () => {
    expect(agentTextRecords({ context: "hi" })).toEqual([{ key: "agent-context", value: "hi" }]);
    expect(agentTextRecords({ context: "x", endpoints: { web: "ipfs://bafy" } })[1]).toEqual({ key: "agent-endpoint[web]", value: "ipfs://bafy" });
  });

  it.each<[string, unknown]>([
    ["missing context", {}],
    ["blank context", { context: "   " }],
    ["long context", { context: "x".repeat(2001) }],
    ["unknown field", { context: "x", stealth: "st:eth:0x" }],
    ["bad protocol", { context: "x", endpoints: { "MCP]": "https://a.b" } }],
    ["bad url scheme", { context: "x", endpoints: { web: "javascript:alert(1)" } }],
    ["url with spaces", { context: "x", endpoints: { web: "https://a.b/ c" } }],
    ["too many endpoints", { context: "x", endpoints: Object.fromEntries([...Array(9)].map((_, i) => [`p${i}`, "https://a.b"])) }],
    ["registry not ERC-7930", { context: "x", registrations: [{ registry: "0x8004a169fb4a3325136eb29fa0ceb6d2e539a432", agentId: "1" }] }],
    ["agentId with brackets", { context: "x", registrations: [{ registry: ERC7930, agentId: "1][2" }] }],
    ["duplicate registration", { context: "x", registrations: [{ registry: ERC7930, agentId: "1" }, { registry: ERC7930, agentId: "1" }] }],
    ["not an object", "hello"],
  ])("rejects %s", (_, bad) => {
    expect(() => agentTextRecords(bad as AgentMetadata)).toThrow(AgentMetadataError);
  });
});

describe("issuance with agent records", () => {
  const base = { name: "bot.soapay.eth", registrant: REGISTRANT, metaAddress: META, admin: ADMIN };

  it("writes the records in initialize, after stealth and registrant, before the role changes", () => {
    const calls = initCalls(buildNameResolverInit({ ...base, stealthWriter: REGISTRANT, textRecords: agentTextRecords(AGENT) }));
    expect(calls.map((c) => (c.functionName === "setText" ? (c.args[1] as string) : c.functionName))).toEqual([
      TEXT_KEY_STEALTH,
      TEXT_KEY_REGISTRANT,
      "agent-context",
      "agent-endpoint[mcp]",
      "agent-endpoint[web]",
      `agent-registration[${ERC7930}][167]`,
      "grantSetterRoles",
      "revokeRootRoles",
    ]);
  });

  it("without records the init and salt are byte-identical to before (backward compatible)", () => {
    const plain = buildDeployNameResolverCall({ ...base, registryResource: 4n });
    expect(buildDeployNameResolverCall({ ...base, registryResource: 4n, textRecords: [] })).toEqual(plain);
    expect(initCalls(decodeFunctionData({ abi: verifiableFactoryAbi, data: plain.data }).args[2] as Hex)).toHaveLength(4);
    const s = { ...base, stealthWriter: REGISTRANT, registryResource: 4n };
    expect(nameResolverSalt({ ...s, textRecords: [] })).toBe(nameResolverSalt(s));
  });

  it("binds the records into the resolver salt", () => {
    const s = { ...base, stealthWriter: REGISTRANT, registryResource: 4n };
    const a = nameResolverSalt({ ...s, textRecords: agentTextRecords(AGENT) });
    expect(a).not.toBe(nameResolverSalt(s));
    expect(nameResolverSalt({ ...s, textRecords: agentTextRecords({ context: "other" }) })).not.toBe(a);
  });

  it("refuses extra records that touch the reserved keys", () => {
    for (const key of [TEXT_KEY_STEALTH, TEXT_KEY_REGISTRANT]) {
      expect(() => buildNameResolverInit({ ...base, stealthWriter: REGISTRANT, textRecords: [{ key, value: "x" }] })).toThrow(/reserved/);
    }
    expect(() =>
      buildNameResolverInit({ ...base, stealthWriter: REGISTRANT, textRecords: [{ key: "a", value: "1" }, { key: "a", value: "2" }] }),
    ).toThrow(/duplicate/);
  });

  it("createEnsV2NameIssuer passes agent metadata through issue()", async () => {
    const sent: { to: Address; data: Hex }[] = [];
    const walletClient: EnsV2Writer = {
      account: privateKeyToAccount(`0x${"11".repeat(32)}`),
      chain: sepolia,
      async sendTransaction({ to, data }) {
        sent.push({ to, data });
        return `0x${sent.length.toString(16).padStart(64, "0")}`;
      },
    };
    const publicClient: EnsV2PublicClient = {
      async readContract({ functionName }) {
        if (functionName === "proxyLogic") return "0xC6dbA04e7c6264e85A459Dd592a6CBC2D2a6Ad8E";
        if (functionName === "hasRootRoles") return true;
        if (functionName === "getState") return { status: REGISTRY_STATUS.AVAILABLE, expiry: 0n, latestOwner: REGISTRANT, tokenId: 1n, resource: 9n };
        throw new Error(functionName);
      },
      async getCode() {
        return undefined;
      },
      async waitForTransactionReceipt() {
        return { status: "success" };
      },
    };
    const issuer = createEnsV2NameIssuer({ walletClient, publicClient, registry: REGISTRY, resolverAdmin: ADMIN });
    await issuer.issue({ label: "bot", registrant: REGISTRANT, metaAddress: META, agent: AGENT });
    const init = decodeFunctionData({ abi: verifiableFactoryAbi, data: sent[0]!.data }).args[2] as Hex;
    expect(initCalls(init).filter((c) => c.functionName === "setText")).toHaveLength(6);
    await expect(
      issuer.issue({ label: "bot2", registrant: REGISTRANT, metaAddress: META, agent: { context: "" } }),
    ).rejects.toThrow(AgentMetadataError);
  });
});
