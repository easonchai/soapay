import { describe, expect, it } from "vitest";
import {
  createPublicClient,
  createWalletClient,
  custom,
  decodeFunctionData,
  encodeFunctionResult,
  hashDomain,
  http,
  recoverTypedDataAddress,
  type Hex,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { base, baseSepolia } from "viem/chains";
import { generateSignatureForRegisterKeysOnBehalf } from "@scopelift/stealth-address-sdk";
import { keysFromMnemonic } from "../src/keys.js";
import { REGISTRY_ADDRESS } from "../src/constants.js";
import {
  ERC6538_REGISTRY,
  buildRegisterKeysOnBehalfCall,
  erc6538RegistryMinimalAbi,
  getRegistryNonce,
  isValidLabel,
  nameClaimTypedData,
  recoverRegisterKeysSigner,
  registerKeysTypedData,
  registryDomain,
  registryEntryTypes,
  signNameClaim,
  signRegisterKeysOnBehalf,
  verifyNameClaim,
  type RegistryReader,
} from "../src/registration.js";

const MNEMONIC =
  "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
const keys = keysFromMnemonic(MNEMONIC);
const metaBytes = keys.metaAddressURI.slice("st:eth:".length) as Hex;

// Read from the live registries with eth_call DOMAIN_SEPARATOR() (2026-09-25).
const LIVE_DOMAIN_SEPARATOR = {
  [baseSepolia.id]: "0xab161919c9369faf2a42260089911d559309fd38a468cd1cd95170caa42984ec",
  [base.id]: "0x91aeb40543c57dd3db1639ed66390eeb210515b56472d1ea6e08e28e3a0d5adf",
} as const;

const domainTypes = {
  EIP712Domain: [
    { name: "name", type: "string" },
    { name: "version", type: "string" },
    { name: "chainId", type: "uint256" },
    { name: "verifyingContract", type: "address" },
  ],
} as const;

// hashDomain's types want uint256 chainId as bigint.
const domainHash = (chainId: number) =>
  hashDomain({ domain: { ...registryDomain(chainId), chainId: BigInt(chainId) }, types: domainTypes });

const LIVE = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env.LIVE === "1";

describe("ERC-6538 EIP-712", () => {
  it("uses the canonical registry address", () => {
    expect(ERC6538_REGISTRY).toBe(REGISTRY_ADDRESS);
  });

  it("domain separator matches the deployed registry on Base Sepolia and Base", () => {
    for (const chainId of [baseSepolia.id, base.id] as const) {
      expect(domainHash(chainId)).toBe(
        LIVE_DOMAIN_SEPARATOR[chainId],
      );
    }
  });

  it("signature recovers to the registrant", async () => {
    const sig = await signRegisterKeysOnBehalf({
      registrantKey: keys.registrantKey,
      metaAddressURI: keys.metaAddressURI,
      chainId: baseSepolia.id,
      nonce: 0n,
    });
    const typed = registerKeysTypedData({ stealthMetaAddress: metaBytes, chainId: baseSepolia.id, nonce: 0n });
    expect(await recoverTypedDataAddress({ ...typed, signature: sig })).toBe(keys.registrantAddress);
    expect(
      await recoverRegisterKeysSigner({ metaAddressURI: keys.metaAddressURI, chainId: baseSepolia.id, nonce: 0n, signature: sig }),
    ).toBe(keys.registrantAddress);
    // Nonce and chain are bound.
    expect(
      await recoverRegisterKeysSigner({ metaAddressURI: keys.metaAddressURI, chainId: baseSepolia.id, nonce: 1n, signature: sig }),
    ).not.toBe(keys.registrantAddress);
    expect(
      await recoverRegisterKeysSigner({ metaAddressURI: keys.metaAddressURI, chainId: base.id, nonce: 0n, signature: sig }),
    ).not.toBe(keys.registrantAddress);
  });

  it("URI and raw-bytes inputs sign the same message", async () => {
    const a = await signRegisterKeysOnBehalf({ registrantKey: keys.registrantKey, metaAddressURI: keys.metaAddressURI, chainId: 84532, nonce: 3n });
    const b = await signRegisterKeysOnBehalf({ registrantKey: keys.registrantKey, stealthMetaAddress: metaBytes, chainId: 84532, nonce: 3n });
    expect(a).toBe(b);
  });

  it("is byte-identical to ScopeLift's generateSignatureForRegisterKeysOnBehalf", async () => {
    const account = privateKeyToAccount(keys.registrantKey);
    const nonce = 7n;
    let sentByScopeLift: unknown;
    const walletClient = createWalletClient({
      account,
      chain: baseSepolia,
      transport: custom({
        async request({ method, params }: { method: string; params: unknown }) {
          if (method === "eth_chainId") return `0x${baseSepolia.id.toString(16)}`;
          if (method === "eth_call") {
            const [{ data }] = params as [{ data: Hex }];
            expect(decodeFunctionData({ abi: erc6538RegistryMinimalAbi, data }).functionName).toBe("nonceOf");
            return encodeFunctionResult({ abi: erc6538RegistryMinimalAbi, functionName: "nonceOf", result: nonce });
          }
          if (method === "eth_signTypedData_v4") {
            // ScopeLift signs over JSON-RPC; sign exactly what it sent (its own domain/types/message).
            const [from, json] = params as [Hex, string];
            expect(from.toLowerCase()).toBe(account.address.toLowerCase());
            const td = JSON.parse(json) as {
              domain: { name: string; version: string; chainId: number; verifyingContract: Hex };
              types: Record<string, { name: string; type: string }[]>;
              primaryType: string;
              message: { schemeId: string; stealthMetaAddress: Hex; nonce: string };
            };
            sentByScopeLift = td;
            const { EIP712Domain: _omit, ...types } = td.types;
            return account.signTypedData({
              domain: td.domain,
              types,
              primaryType: td.primaryType,
              message: { ...td.message, schemeId: BigInt(td.message.schemeId), nonce: BigInt(td.message.nonce) },
            });
          }
          throw new Error(`unexpected ${method}`);
        },
      }),
    });
    const theirs = await generateSignatureForRegisterKeysOnBehalf({
      walletClient,
      account: account.address,
      ERC6538Address: REGISTRY_ADDRESS,
      chainId: baseSepolia.id,
      schemeId: 1,
      stealthMetaAddressToRegister: metaBytes,
    });
    const ours = await signRegisterKeysOnBehalf({
      registrantKey: keys.registrantKey,
      metaAddressURI: keys.metaAddressURI,
      chainId: baseSepolia.id,
      nonce,
    });
    expect(ours).toBe(theirs);
    expect(sentByScopeLift).toMatchObject({
      // viem lowercases addresses on the JSON-RPC path.
      domain: { ...registryDomain(baseSepolia.id), verifyingContract: REGISTRY_ADDRESS.toLowerCase() },
      primaryType: "Erc6538RegistryEntry",
      types: { Erc6538RegistryEntry: registryEntryTypes.Erc6538RegistryEntry },
    });
  });

  it("builds registerKeysOnBehalf calldata", () => {
    const sig = `0x${"11".repeat(65)}` as Hex;
    const call = buildRegisterKeysOnBehalfCall({ registrant: keys.registrantAddress, metaAddressURI: keys.metaAddressURI, signature: sig });
    expect(call.to).toBe(REGISTRY_ADDRESS);
    const decoded = decodeFunctionData({ abi: erc6538RegistryMinimalAbi, data: call.data });
    expect(decoded.functionName).toBe("registerKeysOnBehalf");
    expect(decoded.args).toEqual([keys.registrantAddress, 1n, sig, metaBytes]);
  });

  it("getRegistryNonce reads nonceOf", async () => {
    const client: RegistryReader = {
      async readContract(args) {
        expect(args.functionName).toBe("nonceOf");
        expect(args.args).toEqual([keys.registrantAddress]);
        return 5n;
      },
    };
    expect(await getRegistryNonce(client, keys.registrantAddress)).toBe(5n);
  });
});

describe.skipIf(!LIVE)("ERC-6538 on Base Sepolia (LIVE=1)", () => {
  const client = createPublicClient({ chain: baseSepolia, transport: http("https://sepolia.base.org") });

  it("live DOMAIN_SEPARATOR() equals our domain hash", async () => {
    const onchain = await client.readContract({
      address: ERC6538_REGISTRY,
      abi: erc6538RegistryMinimalAbi,
      functionName: "DOMAIN_SEPARATOR",
    });
    expect(onchain).toBe(domainHash(baseSepolia.id));
  });

  it("registry accepts our signature (simulated registerKeysOnBehalf from a random relayer)", async () => {
    const registrantKey = generatePrivateKey();
    const registrant = privateKeyToAccount(registrantKey).address;
    const nonce = await getRegistryNonce(client, registrant);
    const signature = await signRegisterKeysOnBehalf({ registrantKey, metaAddressURI: keys.metaAddressURI, chainId: baseSepolia.id, nonce });
    const { to, data } = buildRegisterKeysOnBehalfCall({ registrant, metaAddressURI: keys.metaAddressURI, signature });
    const relayer = privateKeyToAccount(generatePrivateKey()).address;
    await expect(client.call({ account: relayer, to, data })).resolves.toBeDefined();
    // A wrong nonce must revert.
    const bad = await signRegisterKeysOnBehalf({ registrantKey, metaAddressURI: keys.metaAddressURI, chainId: baseSepolia.id, nonce: nonce + 1n });
    const badCall = buildRegisterKeysOnBehalfCall({ registrant, metaAddressURI: keys.metaAddressURI, signature: bad });
    await expect(client.call({ account: relayer, ...badCall })).rejects.toThrow();
  });
});

describe("name claims", () => {
  const claim = {
    label: "alice",
    registrant: keys.registrantAddress,
    metaAddress: keys.metaAddressURI,
    deadline: 2_000_000_000n,
    chainId: baseSepolia.id,
  };
  const now = 1_900_000_000n;

  it("label rules", () => {
    for (const ok of ["abc", "alice", "a-b", "a1b2", "x".repeat(32), "123"]) expect(isValidLabel(ok), ok).toBe(true);
    for (const bad of ["ab", "x".repeat(33), "-abc", "abc-", "Alice", "al_ce", "al.ce", "xn--abc", "ab--c", "", "ali ce", "élan"])
      expect(isValidLabel(bad), bad).toBe(false);
  });

  it("typed data matches the spec's NameClaim definition", () => {
    const td = nameClaimTypedData(claim);
    expect(td.domain).toEqual({ name: "Soapay Names", version: "1", chainId: 84532 });
    expect(td.types.NameClaim.map((f) => `${f.type} ${f.name}`).join(",")).toBe(
      "string label,address registrant,string metaAddress,uint256 deadline",
    );
    expect(td.message.metaAddress).toBe(keys.metaAddressURI);
    // Raw bytes and upper-case hex canonicalise to the same signed message.
    expect(nameClaimTypedData({ ...claim, metaAddress: metaBytes.toUpperCase().replace("0X", "0x") }).message).toEqual(td.message);
  });

  it("sign → verify", async () => {
    const signature = await signNameClaim({ ...claim, registrantKey: keys.registrantKey });
    expect(await recoverTypedDataAddress({ ...nameClaimTypedData(claim), signature })).toBe(keys.registrantAddress);
    expect(await verifyNameClaim({ ...claim, signature, nowSeconds: now })).toEqual({ valid: true });
    expect(await verifyNameClaim({ ...claim, metaAddress: metaBytes, signature, nowSeconds: now })).toEqual({ valid: true });
  });

  it("verify rejects tampering, expiry, bad labels and wrong signers", async () => {
    const signature = await signNameClaim({ ...claim, registrantKey: keys.registrantKey });
    expect(await verifyNameClaim({ ...claim, label: "alicia", signature, nowSeconds: now })).toEqual({ valid: false, reason: "bad-signature" });
    expect(await verifyNameClaim({ ...claim, deadline: claim.deadline + 1n, signature, nowSeconds: now })).toEqual({ valid: false, reason: "bad-signature" });
    const other = keysFromMnemonic(MNEMONIC, "x");
    expect(await verifyNameClaim({ ...claim, metaAddress: other.metaAddressURI, signature, nowSeconds: now })).toEqual({ valid: false, reason: "bad-signature" });
    expect(await verifyNameClaim({ ...claim, chainId: base.id, signature, nowSeconds: now })).toEqual({ valid: false, reason: "bad-signature" });
    expect(await verifyNameClaim({ ...claim, signature, nowSeconds: claim.deadline + 1n })).toEqual({ valid: false, reason: "expired" });
    expect(await verifyNameClaim({ ...claim, label: "-bad", signature, nowSeconds: now })).toEqual({ valid: false, reason: "invalid-label" });
    expect(await verifyNameClaim({ ...claim, metaAddress: "st:eth:0x1234", signature, nowSeconds: now })).toEqual({ valid: false, reason: "invalid-meta-address" });
    expect(await verifyNameClaim({ ...claim, signature: "0x1234", nowSeconds: now })).toEqual({ valid: false, reason: "bad-signature" });
    const imposter = await privateKeyToAccount(other.registrantKey).signTypedData(nameClaimTypedData(claim));
    expect(await verifyNameClaim({ ...claim, signature: imposter, nowSeconds: now })).toEqual({ valid: false, reason: "bad-signature" });
  });

  it("signNameClaim refuses a key that does not control the registrant", async () => {
    const other = keysFromMnemonic(MNEMONIC, "x");
    await expect(signNameClaim({ ...claim, registrantKey: other.registrantKey })).rejects.toThrow(/does not match/);
  });
});
