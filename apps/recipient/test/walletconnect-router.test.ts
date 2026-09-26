import { describe, expect, it, vi } from "vitest";
import { encodeFunctionData, erc20Abi, getAddress, numberToHex, stringToHex, type Address, type Hex } from "viem";
import type { DappPrivacyCheck, StealthInclusion } from "@soapay/sdk";
import { CallsStore, routeRequest, type ApprovalDecision, type RouterDeps, type SessionContext } from "../src/features/walletconnect/router.js";
import { RPC, RpcError } from "../src/features/walletconnect/rpc.js";

const ME = getAddress("0x1111111111111111111111111111111111111111");
const OTHER = getAddress("0x2222222222222222222222222222222222222222");
const POOL = getAddress("0xa238dd80c259a72e81d7e4664a9801593f98d1c5");
const USDC = getAddress("0x833589fcd6edb6e08f4c7c32d4f71b54bda02913");
const CHAIN = 8453;
const TX = `0x${"ab".repeat(32)}` as Hex;
const OP = `0x${"cd".repeat(32)}` as Hex;

const session: SessionContext = { topic: "t1", address: ME, chainId: CHAIN, dapp: { name: "Aave", url: "https://app.aave.com" } };
const clean: DappPrivacyCheck = { warnings: [], transfers: [], blocked: false };
const blocked: DappPrivacyCheck = {
  warnings: [{ code: "identifiable", address: OTHER, message: "names your main wallet" }],
  transfers: [],
  blocked: true,
};

function inclusion(success = true): StealthInclusion {
  return { success, userOpHash: OP, txHash: TX, blockHash: `0x${"ee".repeat(32)}`, blockNumber: 10n, gasUsed: 90_000n, logs: [] };
}

function deps(over: Partial<RouterDeps> & { decision?: ApprovalDecision; privacy?: DappPrivacyCheck; landed?: StealthInclusion } = {}) {
  const d = {
    approve: vi.fn(async () => over.decision ?? { approved: true }),
    checkPrivacy: vi.fn((input: { override?: boolean }) => (input.override ? clean : (over.privacy ?? clean))),
    execute: vi.fn(async () => ({ userOpHash: OP, included: Promise.resolve(over.landed ?? inclusion()) })),
    signMessage: vi.fn(async () => "0x5151" as Hex),
    signTypedData: vi.fn(async () => "0x7171" as Hex),
    bundles: new CallsStore(),
    onExecuted: vi.fn(),
    newId: () => "0xb1",
    ...over,
  };
  return d;
}

async function rpcError(p: Promise<unknown>): Promise<RpcError> {
  const e = await p.then(
    () => null,
    (err: unknown) => err,
  );
  expect(e).toBeInstanceOf(RpcError);
  return e as RpcError;
}

const transferData = (to: Address, amount: bigint) => encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [to, amount] });

describe("WalletConnect router: read-only methods", () => {
  it("eth_accounts / eth_requestAccounts expose exactly the session's one address", async () => {
    const d = deps();
    expect(await routeRequest({ method: "eth_accounts" }, session, d)).toEqual([ME]);
    expect(await routeRequest({ method: "eth_requestAccounts" }, session, d)).toEqual([ME]);
    expect(d.approve).not.toHaveBeenCalled();
  });

  it("eth_chainId and wallet_switchEthereumChain only know the session chain", async () => {
    const d = deps();
    expect(await routeRequest({ method: "eth_chainId" }, session, d)).toBe("0x2105");
    expect(await routeRequest({ method: "wallet_switchEthereumChain", params: [{ chainId: "0x2105" }] }, session, d)).toBeNull();
    const e = await rpcError(routeRequest({ method: "wallet_switchEthereumChain", params: [{ chainId: "0x14a34" }] }, session, d));
    expect(e.code).toBe(RPC.unrecognizedChain);
  });

  it("wallet_getCapabilities advertises atomic + paymasterService on the session chain only", async () => {
    const d = deps();
    expect(await routeRequest({ method: "wallet_getCapabilities", params: [ME] }, session, d)).toEqual({
      "0x2105": { atomic: { status: "supported" }, paymasterService: { supported: true } },
    });
    expect(await routeRequest({ method: "wallet_getCapabilities", params: [ME, ["0x1"]] }, session, d)).toEqual({});
    expect((await rpcError(routeRequest({ method: "wallet_getCapabilities", params: [OTHER] }, session, d))).code).toBe(RPC.unauthorized);
  });

  it.each(["eth_sign", "eth_signTransaction", "eth_getBalance", "wallet_addEthereumChain", "eth_signTypedData_v3"])(
    "rejects %s as unsupported (4200) without asking the user",
    async (method) => {
      const d = deps();
      const e = await rpcError(routeRequest({ method, params: [] }, session, d));
      expect(e.code).toBe(RPC.unsupportedMethod);
      expect(d.approve).not.toHaveBeenCalled();
    },
  );
});

describe("WalletConnect router: eth_sendTransaction", () => {
  const tx = { from: ME, to: POOL, data: "0x617ba037", value: "0x0" };

  it("asks for approval, runs ONE userOp from the session address and returns the real tx hash", async () => {
    const d = deps();
    expect(await routeRequest({ method: "eth_sendTransaction", params: [tx] }, session, d)).toBe(TX);
    expect(d.approve).toHaveBeenCalledTimes(1);
    const req = d.approve.mock.calls[0]![0 as never] as { kind: string; calls: { to: Address; selector: string }[]; address: Address; dapp: { name: string } };
    expect(req).toMatchObject({ kind: "transaction", address: ME, dapp: { name: "Aave" } });
    expect(req.calls).toHaveLength(1);
    expect(req.calls[0]).toMatchObject({ to: POOL, selector: "0x617ba037" });
    expect(d.execute).toHaveBeenCalledWith(ME, [{ to: POOL, data: "0x617ba037", value: 0n }]);
    expect(d.onExecuted).toHaveBeenCalledTimes(1);
  });

  it("rejects non-zero value before the user is asked (stealth addresses hold no ETH)", async () => {
    const d = deps();
    const e = await rpcError(routeRequest({ method: "eth_sendTransaction", params: [{ ...tx, value: "0x2386f26fc10000" }] }, session, d));
    expect(e.code).toBe(RPC.invalidParams);
    expect(e.message).toMatch(/hold no ETH.*0\.01 ETH/);
    expect(d.approve).not.toHaveBeenCalled();
    expect(d.execute).not.toHaveBeenCalled();
  });

  it("refuses a `from` other than the session's one address", async () => {
    const d = deps();
    expect((await rpcError(routeRequest({ method: "eth_sendTransaction", params: [{ ...tx, from: OTHER }] }, session, d))).code).toBe(RPC.unauthorized);
    expect(d.approve).not.toHaveBeenCalled();
  });

  it("refuses contract deployment (no `to`) and another chain", async () => {
    const d = deps();
    expect((await rpcError(routeRequest({ method: "eth_sendTransaction", params: [{ from: ME, data: "0x60" }] }, session, d))).code).toBe(RPC.invalidParams);
    expect((await rpcError(routeRequest({ method: "eth_sendTransaction", params: [{ ...tx, chainId: "0x1" }] }, session, d))).code).toBe(RPC.unsupportedChain);
  });

  it("user rejection → 4001 and nothing is sent", async () => {
    const d = deps({ decision: { approved: false } });
    expect((await rpcError(routeRequest({ method: "eth_sendTransaction", params: [tx] }, session, d))).code).toBe(RPC.userRejected);
    expect(d.execute).not.toHaveBeenCalled();
  });

  it("a privacy block needs the explicit override", async () => {
    const noOverride = deps({ privacy: blocked, decision: { approved: true } });
    expect((await rpcError(routeRequest({ method: "eth_sendTransaction", params: [tx] }, session, noOverride))).code).toBe(RPC.userRejected);
    expect(noOverride.execute).not.toHaveBeenCalled();

    const withOverride = deps({ privacy: blocked, decision: { approved: true, override: true } });
    expect(await routeRequest({ method: "eth_sendTransaction", params: [tx] }, session, withOverride)).toBe(TX);
    expect(withOverride.checkPrivacy).toHaveBeenLastCalledWith(expect.objectContaining({ override: true }));
    expect(withOverride.approve.mock.calls[0]![0 as never]).toMatchObject({ privacy: { blocked: true } });
  });

  it("a userOp that reverts on-chain is an error, not a success hash", async () => {
    const d = deps({ landed: { ...inclusion(false), reason: "0x" } });
    const e = await rpcError(routeRequest({ method: "eth_sendTransaction", params: [tx] }, session, d));
    expect(e.message).toMatch(/reverted/);
    expect(d.onExecuted).not.toHaveBeenCalled();
  });
});

describe("WalletConnect router: EIP-5792", () => {
  const calls = [
    { to: USDC, data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [POOL, 5n] }) },
    { to: POOL, data: "0x617ba037" },
  ];
  const send = (p: Record<string, unknown> = {}) => ({ method: "wallet_sendCalls", params: [{ version: "2.0.0", chainId: numberToHex(CHAIN), from: ME, calls, atomicRequired: true, ...p }] });

  it("wallet_sendCalls: one approval, one userOp, returns a bundle id; getCallsStatus goes 100 → 200 with receipts", async () => {
    let land!: (i: StealthInclusion) => void;
    const d = deps({ execute: vi.fn(async () => ({ userOpHash: OP, included: new Promise<StealthInclusion>((r) => (land = r)) })) });
    expect(await routeRequest(send(), session, d)).toEqual({ id: "0xb1" });
    expect(d.approve).toHaveBeenCalledTimes(1);
    expect(d.approve.mock.calls[0]![0 as never]).toMatchObject({ kind: "calls" });
    expect(d.execute).toHaveBeenCalledTimes(1);
    expect((d.execute.mock.calls[0] as unknown[])[1]).toHaveLength(2);

    expect(await routeRequest({ method: "wallet_getCallsStatus", params: ["0xb1"] }, session, d)).toMatchObject({ id: "0xb1", status: 100, atomic: true, chainId: "0x2105" });
    land(inclusion());
    await Promise.resolve();
    await Promise.resolve();
    const done = (await routeRequest({ method: "wallet_getCallsStatus", params: ["0xb1"] }, session, d)) as { status: number; receipts: { transactionHash: Hex; status: string }[] };
    expect(done.status).toBe(200);
    expect(done.receipts[0]).toMatchObject({ transactionHash: TX, status: "0x1", blockNumber: "0xa" });
    expect(d.onExecuted).toHaveBeenCalledTimes(1);
  });

  it("bundle ids are scoped to the session address and must be unique", async () => {
    const d = deps();
    await routeRequest(send({ id: "0xfeed" }), session, d);
    expect((await rpcError(routeRequest(send({ id: "0xfeed" }), session, d))).code).toBe(RPC.duplicateId);
    const other = { ...session, topic: "t2", address: OTHER };
    expect((await rpcError(routeRequest({ method: "wallet_getCallsStatus", params: ["0xfeed"] }, other, d))).code).toBe(RPC.unknownBundle);
    expect((await rpcError(routeRequest({ method: "wallet_getCallsStatus", params: ["0xnope"] }, session, d))).code).toBe(RPC.unknownBundle);
  });

  it("rejects value, another chain and unknown required capabilities; accepts optional ones", async () => {
    const d = deps();
    const withValue = send({ calls: [{ to: POOL, data: "0x", value: "0x1" }] });
    expect((await rpcError(routeRequest(withValue, session, d))).code).toBe(RPC.invalidParams);
    expect((await rpcError(routeRequest(send({ chainId: "0x14a34" }), session, d))).code).toBe(RPC.unsupportedChain);
    expect((await rpcError(routeRequest(send({ capabilities: { auxiliaryFunds: { supported: true } } }), session, d))).code).toBe(RPC.unsupportedCapability);
    expect(d.approve).not.toHaveBeenCalled();

    await routeRequest(send({ id: "0xopt", capabilities: { flowControl: { optional: true }, paymasterService: { url: "https://pm.example" } } }), session, d);
    expect(d.approve.mock.calls[0]![0 as never]).toMatchObject({ notes: [expect.stringMatching(/own gas path/)] });
  });
});

describe("WalletConnect router: signing", () => {
  it("personal_sign signs with the session address (either param order)", async () => {
    const d = deps();
    const msg = stringToHex("Sign in to Morpho");
    expect(await routeRequest({ method: "personal_sign", params: [msg, ME] }, session, d)).toBe("0x5151");
    expect(d.approve.mock.calls[0]![0 as never]).toMatchObject({ kind: "message", message: { text: "Sign in to Morpho", raw: msg } });
    expect(await routeRequest({ method: "personal_sign", params: [ME, msg] }, session, d)).toBe("0x5151");
    expect(d.signMessage).toHaveBeenCalledWith(ME, msg);
    expect((await rpcError(routeRequest({ method: "personal_sign", params: [msg, OTHER] }, session, d))).code).toBe(RPC.unauthorized);
  });

  it("eth_signTypedData_v4 flags permits and other-chain domains; rejection signs nothing", async () => {
    const td = {
      domain: { name: "USD Coin", version: "2", chainId: 1, verifyingContract: USDC },
      types: { Permit: [{ name: "spender", type: "address" }, { name: "value", type: "uint256" }] },
      primaryType: "Permit",
      message: { spender: POOL, value: "5" },
    };
    const d = deps();
    expect(await routeRequest({ method: "eth_signTypedData_v4", params: [ME, JSON.stringify(td)] }, session, d)).toBe("0x7171");
    const notes = (d.approve.mock.calls[0]![0 as never] as { notes: string[] }).notes;
    expect(notes.some((n) => /chain 1/.test(n))).toBe(true);
    expect(notes.some((n) => /permit/.test(n) && n.includes(POOL))).toBe(true);

    const no = deps({ decision: { approved: false } });
    expect((await rpcError(routeRequest({ method: "eth_signTypedData_v4", params: [ME, td] }, session, no))).code).toBe(RPC.userRejected);
    expect(no.signTypedData).not.toHaveBeenCalled();
    expect((await rpcError(routeRequest({ method: "eth_signTypedData_v4", params: [ME, "{bad"] }, session, no))).code).toBe(RPC.invalidParams);
  });

  it("the privacy check sees the signed content (a transfer to your main wallet is blocked)", async () => {
    const d = deps({ privacy: blocked, decision: { approved: true } });
    const e = await rpcError(routeRequest({ method: "eth_sendTransaction", params: [{ from: ME, to: USDC, data: transferData(OTHER, 1n) }] }, session, d));
    expect(e.code).toBe(RPC.userRejected);
    expect(d.checkPrivacy).toHaveBeenCalledWith(expect.objectContaining({ from: ME, calls: [expect.objectContaining({ to: USDC })] }));
  });
});
