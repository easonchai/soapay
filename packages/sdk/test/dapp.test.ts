import { describe, expect, it } from "vitest";
import { encodeFunctionData, erc20Abi, getAddress, parseAbi, recoverMessageAddress, stringToHex, verifyTypedData, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  ClusterGraph,
  applySpend,
  checkDappPrivacy,
  decodeDappCall,
  dappTransfers,
  parseTypedDataV4,
  personalMessageText,
  planSpend,
  signMessageAsStealth,
  signTypedDataAsStealth,
  typedDataChainId,
  typedDataPermitSpender,
} from "../src/index.js";

// Test-only key (anvil #3); never a real stealth key.
const KEY = "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6" as Hex;
const ME = privateKeyToAccount(KEY).address;
const a = (n: number): Address => getAddress(`0x${n.toString(16).padStart(40, "0")}`);
const S2 = a(0x52);
const MAIN = a(0xa1);
const FRESH = a(0xf1);
const USDC = a(0xc0);
const POOL = a(0xaa);

const aave = parseAbi(["function supply(address asset, uint256 amount, address onBehalfOf, uint16 referralCode)"]);

function graph() {
  const g = new ClusterGraph();
  g.addStealth(ME).addStealth(S2);
  g.setLabel(MAIN, "main-wallet");
  return g;
}

const permit = (spender: Address, chainId: number | string = 8453) => ({
  domain: { name: "USD Coin", version: "2", chainId, verifyingContract: USDC },
  types: {
    EIP712Domain: [
      { name: "name", type: "string" },
      { name: "version", type: "string" },
      { name: "chainId", type: "uint256" },
      { name: "verifyingContract", type: "address" },
    ],
    Permit: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
      { name: "value", type: "uint256" },
      { name: "nonce", type: "uint256" },
      { name: "deadline", type: "uint256" },
    ],
  },
  primaryType: "Permit",
  message: { owner: ME, spender, value: "1000000", nonce: "0", deadline: "0xffffffff" },
});

describe("dApp signing with a stealth key", () => {
  it("personal_sign: hex payloads are raw bytes, text is UTF-8; both recover to the stealth address", async () => {
    const text = "Sign in to Aave";
    const sigText = await signMessageAsStealth({ stealthKey: KEY, message: text, expected: ME });
    expect(await recoverMessageAddress({ message: text, signature: sigText })).toBe(ME);
    const hex = stringToHex(text);
    const sigHex = await signMessageAsStealth({ stealthKey: KEY, message: hex });
    expect(sigHex).toBe(sigText);
    expect(personalMessageText(hex)).toBe(text);
    expect(personalMessageText(`0x${"00".repeat(32)}`)).toBe(`0x${"00".repeat(32)}`);
  });

  it("refuses a key that doesn't control the expected address", async () => {
    await expect(signMessageAsStealth({ stealthKey: KEY, message: "x", expected: FRESH })).rejects.toThrow(/does not control/);
  });

  it("eth_signTypedData_v4: JSON with string integers signs and verifies", async () => {
    const json = JSON.stringify(permit(POOL));
    const td = parseTypedDataV4(json);
    const signature = await signTypedDataAsStealth({ stealthKey: KEY, typedData: json, expected: ME });
    const ok = await verifyTypedData({
      address: ME,
      domain: { name: "USD Coin", version: "2", chainId: 8453, verifyingContract: USDC },
      types: { Permit: permit(POOL).types.Permit },
      primaryType: "Permit",
      message: { owner: ME, spender: POOL, value: 1_000_000n, nonce: 0n, deadline: 0xffffffffn },
      signature,
    });
    expect(ok).toBe(true);
    expect(typedDataChainId(td)).toBe(8453);
    expect(typedDataPermitSpender(td)).toBe(POOL);
  });

  it("rejects malformed typed data", () => {
    expect(() => parseTypedDataV4("{not json")).toThrow(/JSON/);
    expect(() => parseTypedDataV4({ types: {}, primaryType: "X", message: {} })).toThrow(/primaryType/);
  });
});

describe("decoding dApp calls", () => {
  it("names ERC-20 and Aave calls and lists token transfers", () => {
    const transfer = { to: USDC, data: encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [FRESH, 5n] }) };
    const supply = { to: POOL, data: encodeFunctionData({ abi: aave, functionName: "supply", args: [USDC, 7n, ME, 0] }) };
    expect(decodeDappCall(transfer)).toMatchObject({ functionName: "transfer", args: [{ name: "recipient", value: FRESH }, { name: "amount", value: "5" }] });
    expect(decodeDappCall(supply)).toMatchObject({ functionName: "supply", selector: supply.data.slice(0, 10) });
    expect(decodeDappCall({ to: POOL, data: "0xdeadbeef" })).toMatchObject({ selector: "0xdeadbeef" });
    expect(decodeDappCall({ to: POOL }).functionName).toBeUndefined();
    expect(dappTransfers([transfer, supply])).toEqual([{ token: USDC, to: FRESH, amount: 5n }]);
  });
});

describe("dApp privacy check (consolidation guard)", () => {
  it("allows a supply on your own behalf", () => {
    const data = encodeFunctionData({ abi: aave, functionName: "supply", args: [USDC, 7n, ME, 0] });
    const r = checkDappPrivacy({ graph: graph(), from: ME, calls: [{ to: POOL, data }] });
    expect(r).toMatchObject({ warnings: [], blocked: false });
  });

  it("blocks calldata that names your main wallet (Aave onBehalfOf) until overridden", () => {
    const data = encodeFunctionData({ abi: aave, functionName: "supply", args: [USDC, 7n, MAIN, 0] });
    const r = checkDappPrivacy({ graph: graph(), from: ME, calls: [{ to: POOL, data }] });
    expect(r.blocked).toBe(true);
    expect(r.warnings).toEqual([expect.objectContaining({ code: "identifiable", address: MAIN })]);
    expect(checkDappPrivacy({ graph: graph(), from: ME, calls: [{ to: POOL, data }], override: true }).blocked).toBe(false);
  });

  it("blocks a token transfer to an identifiable wallet through planSpend, like Send", () => {
    const data = encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [MAIN, 5n] });
    const r = checkDappPrivacy({ graph: graph(), from: ME, calls: [{ to: USDC, data }] });
    expect(r.transfers[0]!.plan).toMatchObject({ decision: "block" });
    expect(r.warnings).toEqual([]);
    expect(r.blocked).toBe(true);
  });

  it("flags another of your stealth addresses in a signature, even one missing from the graph", () => {
    const r = checkDappPrivacy({ graph: graph(), from: ME, typedData: parseTypedDataV4(permit(S2)) });
    expect(r.warnings.map((w) => w.code)).toEqual(["own-stealth"]);
    const outside = a(0x99);
    const m = checkDappPrivacy({ graph: graph(), from: ME, ownStealth: [ME, outside], message: `link ${outside.toLowerCase()}` });
    expect(m.warnings).toEqual([expect.objectContaining({ code: "own-stealth", address: outside })]);
    expect(m.blocked).toBe(true);
  });

  it("skips addresses already linked to this one (no new link)", () => {
    const g = graph();
    applySpend(g, planSpend(g, { from: [ME], to: MAIN, override: true }));
    const data = encodeFunctionData({ abi: aave, functionName: "supply", args: [USDC, 7n, MAIN, 0] });
    expect(checkDappPrivacy({ graph: g, from: ME, calls: [{ to: POOL, data }] })).toMatchObject({ warnings: [], blocked: false });
  });
});
