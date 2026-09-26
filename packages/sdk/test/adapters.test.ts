import { describe, expect, it } from "vitest";
import { generateRandomStealthMetaAddress } from "@scopelift/stealth-address-sdk";
import { decodeFunctionData, type Address, type Hash, type Hex } from "viem";
import {
  apiAnnouncementSource,
  apiRelayer,
  compositeResolver,
  erc6538Resolver,
  fallbackAnnouncementSource,
  memoryKeyStorage,
  metaAddressResolver,
  NoResolverError,
  phraseSigner,
  registerWithRelayer,
  rpcAnnouncementSource,
  selfSubmitRelayer,
  type NameResolver,
} from "../src/adapters.js";
import { keysFromMnemonic, parseMetaAddress } from "../src/keys.js";
import { erc6538RegistryMinimalAbi, recoverRegisterKeysSigner } from "../src/registration.js";

const MNEMONIC = "test test test test test test test test test test test junk";
const HASH = `0x${"ab".repeat(32)}` as Hash;
const A1 = "0x00000000000000000000000000000000000000a1" as Address;

describe("name resolvers", () => {
  it("meta-address resolver canonicalises raw hex and URIs", async () => {
    const uri = generateRandomStealthMetaAddress().stealthMetaAddressURI;
    const r = metaAddressResolver();
    expect(r.canResolve(uri)).toBe(true);
    expect(r.canResolve("alice.soapay.eth")).toBe(false);
    const raw = parseMetaAddress(uri);
    expect((await r.resolve(raw)).metaAddressURI).toBe(`st:eth:${raw}`);
    expect((await r.resolve(uri)).source).toBe("meta-address");
  });

  it("erc6538 resolver reads stealthMetaAddressOf", async () => {
    const raw = parseMetaAddress(generateRandomStealthMetaAddress().stealthMetaAddressURI);
    const r = erc6538Resolver({ client: { readContract: async () => raw } });
    expect(await r.resolve(A1)).toMatchObject({ metaAddressURI: `st:eth:${raw}`, source: "erc6538" });
    await expect(erc6538Resolver({ client: { readContract: async () => "0x" } }).resolve(A1)).rejects.toThrow(/no ERC-6538/);
  });

  it("composite resolver falls through and reports every failure", async () => {
    const failing: NameResolver = { name: "bad", canResolve: () => true, resolve: async () => Promise.reject(new Error("boom")) };
    const uri = generateRandomStealthMetaAddress().stealthMetaAddressURI;
    const c = compositeResolver([failing, metaAddressResolver()]);
    expect((await c.resolve(uri)).source).toBe("meta-address");
    const err = await c.resolve("alice.soapay.eth").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(NoResolverError);
    expect((err as Error).message).toMatch(/bad: boom/);
  });
});

describe("announcement sources", () => {
  it("api source pages through /announcements", async () => {
    const urls: string[] = [];
    const src = apiAnnouncementSource({
      apiUrl: "https://api.example/",
      fetch: async (url) => {
        urls.push(url);
        return { ok: true, status: 200, json: async () => ({ items: [], nextCursor: null }) };
      },
    });
    expect(await src.fetch({ fromBlock: 5n })).toEqual([]);
    expect(urls).toEqual(["https://api.example/announcements?from=5"]);
  });

  it("rpc source defaults toBlock to the latest block; fallback moves on", async () => {
    const calls: { fromBlock: bigint; toBlock: bigint }[] = [];
    const getLogs = async (a: { fromBlock: bigint; toBlock: bigint }) => {
      calls.push(a);
      return [];
    };
    const rpc = rpcAnnouncementSource({
      client: { getBlockNumber: async () => 20n, getLogs: getLogs as never },
      startBlock: 10n,
    });
    const broken = { name: "x", fetch: async () => Promise.reject(new Error("down")) };
    expect(await fallbackAnnouncementSource([broken, rpc]).fetch()).toEqual([]);
    expect(calls[0]).toMatchObject({ fromBlock: 10n, toBlock: 20n });
  });
});

describe("signer, storage, relayer", () => {
  it("phrase signer matches keysFromMnemonic", async () => {
    expect((await phraseSigner(MNEMONIC).getKeys()).metaAddressURI).toBe(keysFromMnemonic(MNEMONIC).metaAddressURI);
  });

  it("memory storage round trips", async () => {
    const s = memoryKeyStorage({ a: "1" });
    await s.set("b", "2");
    expect(await s.list()).toEqual(["a", "b"]);
    await s.delete("a");
    expect(await s.get("a")).toBeNull();
    expect(await s.get("b")).toBe("2");
  });

  it("registerWithRelayer signs a valid registerKeysOnBehalf and posts it to /register", async () => {
    const keys = keysFromMnemonic(MNEMONIC);
    let posted: { url: string; body: { registrant: Address; metaAddress: string; signature: Hex } } | undefined;
    const relayer = apiRelayer({
      apiUrl: "https://api.example",
      fetch: async (url, init) => {
        posted = { url, body: JSON.parse(init.body) };
        return { ok: true, status: 200, json: async () => ({ txHash: HASH, status: "pending" }) };
      },
    });
    const out = await registerWithRelayer({ keys, chainId: 84532, client: { readContract: async () => 3n }, relayer });
    expect(out).toEqual({ txHash: HASH, status: "pending" });
    expect(posted!.url).toBe("https://api.example/register");
    expect(posted!.body.metaAddress).toBe(keys.metaAddressURI);
    const signer = await recoverRegisterKeysSigner({ metaAddressURI: keys.metaAddressURI, chainId: 84532, nonce: 3n, signature: posted!.body.signature });
    expect(signer).toBe(keys.registrantAddress);
  });

  it("api relayer surfaces the API error message", async () => {
    const keys = keysFromMnemonic(MNEMONIC);
    const relayer = apiRelayer({
      apiUrl: "https://api.example",
      fetch: async () => ({ ok: false, status: 429, json: async () => ({ error: { code: "rate_limited", message: "slow down" } }) }),
    });
    await expect(relayer.submit({ registrant: A1, metaAddress: parseMetaAddress(keys.metaAddressURI), signature: "0x" })).rejects.toThrow(/slow down/);
  });

  it("self-submit sends registerKeysOnBehalf from the caller's wallet", async () => {
    const keys = keysFromMnemonic(MNEMONIC);
    let data: Hex | undefined;
    const relayer = selfSubmitRelayer({
      wallet: {
        sendTransaction: async (tx) => {
          data = tx.data;
          return HASH;
        },
      },
    });
    const out = await registerWithRelayer({ keys, chainId: 84532, client: { readContract: async () => 0n }, relayer });
    expect(out.txHash).toBe(HASH);
    const decoded = decodeFunctionData({ abi: erc6538RegistryMinimalAbi, data: data! });
    expect(decoded.functionName).toBe("registerKeysOnBehalf");
    expect(decoded.args?.[0]).toBe(keys.registrantAddress);
  });
});
