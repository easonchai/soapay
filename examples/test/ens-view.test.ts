import { describe, expect, it } from "vitest";
import { deriveStealthKey, keysFromMnemonic, type AnnouncementRecord } from "@soapay/sdk";
import { RESOLVER_ROLES } from "@soapay/sdk/ensv2";
import {
  deriveFreshAddresses,
  hasRole,
  parseArgs,
  parseEnvText,
  registryPath,
  resolverRoleNames,
  rpcHost,
  splitMetaAddress,
  toEnsName,
} from "../demo/ens-view.js";

const PHRASE = "test test test test test test test test test test test junk";
const keys = keysFromMnemonic(PHRASE);

describe("toEnsName / registryPath", () => {
  it("adds soapay.eth to a bare label and keeps full names", () => {
    expect(toEnsName("alex-demo")).toBe("alex-demo.soapay.eth");
    expect(toEnsName(" Infra-Agent.soapay.eth. ")).toBe("infra-agent.soapay.eth");
    expect(() => toEnsName("  ")).toThrow();
  });
  it("walks labels from the TLD down", () => {
    expect(registryPath("alex-demo.soapay.eth")).toEqual(["eth", "soapay", "alex-demo"]);
    expect(() => registryPath("eth")).toThrow();
  });
});

describe("splitMetaAddress", () => {
  it("splits spending then viewing key, from a URI or bare hex", () => {
    const s = splitMetaAddress(keys.metaAddressURI);
    expect(s.spendingPublicKey).toBe(keys.spendingPublicKey.toLowerCase());
    expect(s.viewingPublicKey).toBe(keys.viewingPublicKey.toLowerCase());
    expect(splitMetaAddress(s.metaAddress)).toEqual(s);
  });
  it("rejects malformed input", () => {
    expect(() => splitMetaAddress("st:eth:0x1234")).toThrow();
  });
});

describe("rpcHost", () => {
  it("never shows the path or query (where API keys live)", () => {
    expect(rpcHost("https://eth-sepolia.g.alchemy.com/v2/SECRETKEY")).toBe("eth-sepolia.g.alchemy.com");
    expect(rpcHost("https://rpc.example.org/?apikey=SECRET")).toBe("rpc.example.org");
    expect(rpcHost("not a url SECRET")).toBe("(custom RPC)");
  });
});

describe("roles", () => {
  it("decodes resolver role bitmaps", () => {
    const bitmap = RESOLVER_ROLES.ROLE_SET_TEXT | RESOLVER_ROLES.ROLE_SET_TEXT_ADMIN;
    expect(hasRole(bitmap, RESOLVER_ROLES.ROLE_SET_TEXT)).toBe(true);
    expect(hasRole(bitmap, RESOLVER_ROLES.ROLE_SET_ADDRESS)).toBe(false);
    expect(resolverRoleNames(bitmap)).toEqual(["ROLE_SET_TEXT", "ROLE_SET_TEXT_ADMIN"]);
    expect(resolverRoleNames(0n)).toEqual([]);
  });
});

describe("deriveFreshAddresses", () => {
  it("derives N distinct, sorted addresses the recipient's keys control", () => {
    const fresh = deriveFreshAddresses(keys.metaAddressURI, 5);
    expect(fresh).toHaveLength(5);
    expect(new Set(fresh.map((f) => f.stealthAddress)).size).toBe(5);
    expect(new Set(fresh.map((f) => f.ephemeralPublicKey)).size).toBe(5);
    const sorted = [...fresh].sort((a, b) => (BigInt(a.stealthAddress) < BigInt(b.stealthAddress) ? -1 : 1));
    expect(fresh).toEqual(sorted);
    for (const f of fresh) {
      expect(f.viewTag).toBeGreaterThanOrEqual(0);
      expect(f.viewTag).toBeLessThan(256);
      const announcement = { stealthAddress: f.stealthAddress, ephemeralPubKey: f.ephemeralPublicKey } as AnnouncementRecord;
      // Throws unless the recipient's derived key controls the address.
      deriveStealthKey({ announcement }, { spendingPrivateKey: keys.spendingKey, viewingPrivateKey: keys.viewingKey });
    }
  });
  it("is deterministic under the SDK's ephemeral-key hook", () => {
    const seq = () => {
      let i = 1;
      return () => {
        const key = new Uint8Array(32);
        key[31] = i++;
        return key;
      };
    };
    expect(deriveFreshAddresses(keys.metaAddressURI, 3, seq())).toEqual(deriveFreshAddresses(keys.metaAddressURI, 3, seq()));
  });
  it("bounds N", () => {
    expect(() => deriveFreshAddresses(keys.metaAddressURI, 0)).toThrow();
    expect(() => deriveFreshAddresses(keys.metaAddressURI, 51)).toThrow();
  });
});

describe("parseArgs / parseEnvText", () => {
  it("parses the target and --derive", () => {
    expect(parseArgs(["alex-demo"])).toEqual({ target: "alex-demo", derive: 3 });
    expect(parseArgs(["alex-demo", "--derive", "5"])).toEqual({ target: "alex-demo", derive: 5 });
    expect(parseArgs(["--derive=2", "x.soapay.eth"])).toEqual({ target: "x.soapay.eth", derive: 2 });
    expect(() => parseArgs([])).toThrow();
    expect(() => parseArgs(["a", "--derive", "abc"])).toThrow();
    expect(() => parseArgs(["a", "--nope"])).toThrow();
  });
  it("reads dotenv lines", () => {
    expect(parseEnvText('# c\nRPC_URL="https://a/b"\nexport L1_RPC_URL=https://c \nbad line')).toEqual({
      RPC_URL: "https://a/b",
      L1_RPC_URL: "https://c",
    });
  });
});
