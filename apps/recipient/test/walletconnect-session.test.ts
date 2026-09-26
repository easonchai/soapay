import { describe, expect, it, vi } from "vitest";
import { getAddress, type Hex } from "viem";
import type { StealthInclusion } from "@soapay/sdk";
import {
  WalletConnectController,
  parsePairingUri,
  type ProposalEvent,
  type RequestEvent,
  type SessionLike,
  type WalletKitLike,
} from "../src/features/walletconnect/controller.js";
import { ProposalError, buildSessionNamespaces, sessionAccount } from "../src/features/walletconnect/namespaces.js";
import { RPC } from "../src/features/walletconnect/rpc.js";

const A = getAddress("0x1111111111111111111111111111111111111111");
const B = getAddress("0x2222222222222222222222222222222222222222");
const CHAIN = 84532;
const TX = `0x${"ab".repeat(32)}` as Hex;

describe("session namespaces: one address per session", () => {
  it("approves exactly one account on the active chain, echoing required methods", () => {
    const ns = buildSessionNamespaces(
      { requiredNamespaces: { eip155: { chains: [`eip155:${CHAIN}`], methods: ["eth_sendTransaction", "eth_sign"], events: ["accountsChanged"] } } },
      { chainId: CHAIN, address: A },
    );
    expect(Object.keys(ns)).toEqual(["eip155"]);
    expect(ns.eip155!.accounts).toEqual([`eip155:${CHAIN}:${A}`]);
    expect(ns.eip155!.chains).toEqual([`eip155:${CHAIN}`]);
    expect(ns.eip155!.methods).toEqual(expect.arrayContaining(["wallet_sendCalls", "personal_sign", "eth_sign"]));
  });

  it("refuses required chains or namespaces it can't serve, and dApps that don't list our chain", () => {
    const code = (fn: () => unknown) => {
      try {
        fn();
      } catch (e) {
        return (e as ProposalError).reason.code;
      }
      return null;
    };
    expect(code(() => buildSessionNamespaces({ requiredNamespaces: { eip155: { chains: ["eip155:1", `eip155:${CHAIN}`] } } }, { chainId: CHAIN, address: A }))).toBe(5100);
    expect(code(() => buildSessionNamespaces({ requiredNamespaces: { solana: { chains: ["solana:x"] } } }, { chainId: CHAIN, address: A }))).toBe(5104);
    expect(code(() => buildSessionNamespaces({ optionalNamespaces: { eip155: { chains: ["eip155:1", "eip155:8453"] } } }, { chainId: CHAIN, address: A }))).toBe(5100);
    expect(code(() => buildSessionNamespaces({ optionalNamespaces: { eip155: { chains: ["eip155:1", `eip155:${CHAIN}`] } } }, { chainId: CHAIN, address: A }))).toBeNull();
  });

  it("sessionAccount refuses a session exposing two addresses", () => {
    expect(sessionAccount({ eip155: { accounts: [`eip155:${CHAIN}:${A}`] } })).toEqual({ address: A, chainId: CHAIN });
    expect(() => sessionAccount({ eip155: { accounts: [`eip155:${CHAIN}:${A}`, `eip155:${CHAIN}:${B}`] } })).toThrow(/exactly one address/);
    expect(() => sessionAccount({ eip155: { accounts: [] } })).toThrow(/exactly one address/);
  });

  it("parsePairingUri accepts v2 wc: links only", () => {
    expect(parsePairingUri("  wc:abc123@2?relay-protocol=irn&symKey=00 ")).toBe("wc:abc123@2?relay-protocol=irn&symKey=00");
    expect(() => parsePairingUri("https://example.com")).toThrow(/starts with wc:/);
    expect(() => parsePairingUri("wc:abc@1?bridge=x")).toThrow(/older version/);
  });
});

/** In-memory stand-in for @reown/walletkit. */
class FakeKit implements WalletKitLike {
  handlers = new Map<string, (e: never) => void>();
  sessions: Record<string, SessionLike> = {};
  approveSession = vi.fn(async (p: { id: number; namespaces: Record<string, { accounts: string[] }> }) => {
    this.sessions.t1 = { topic: "t1", namespaces: p.namespaces, peer: { metadata: { name: "Morpho", url: "https://app.morpho.org" } } };
  });
  rejectSession = vi.fn(async () => undefined);
  respondSessionRequest = vi.fn(async () => undefined);
  disconnectSession = vi.fn(async (p: { topic: string }) => {
    delete this.sessions[p.topic];
  });
  pair = vi.fn(async () => undefined);
  on(event: string, fn: (e: never) => void) {
    this.handlers.set(event, fn);
    return this;
  }
  getActiveSessions() {
    return this.sessions;
  }
  emit(event: string, e: unknown) {
    this.handlers.get(event)?.(e as never);
  }
}

const proposal = (id = 7): ProposalEvent => ({
  id,
  params: { id, proposer: { metadata: { name: "Morpho", url: "https://app.morpho.org" } }, optionalNamespaces: { eip155: { chains: [`eip155:${CHAIN}`] } } },
  verifyContext: { verified: { validation: "VALID", origin: "https://app.morpho.org" } },
});
const request = (id: number, method: string, params: unknown, topic = "t1"): RequestEvent => ({ id, topic, params: { request: { method, params }, chainId: `eip155:${CHAIN}` } });
const flush = () => new Promise((r) => setTimeout(r, 0));

async function setup() {
  const kit = new FakeKit();
  const landed: StealthInclusion = { success: true, userOpHash: TX, txHash: TX, blockHash: TX, blockNumber: 1n, gasUsed: 1n, logs: [] };
  const execute = vi.fn(async () => ({ userOpHash: TX, included: Promise.resolve(landed) }));
  const c = new WalletConnectController({
    projectId: "test",
    chainId: CHAIN,
    chainName: "Base Sepolia",
    createKit: async () => kit,
    ownAddresses: () => [A, B],
    deps: () => ({
      checkPrivacy: () => ({ warnings: [], transfers: [], blocked: false }),
      execute,
      signMessage: async () => "0x01" as Hex,
      signTypedData: async () => "0x02" as Hex,
    }),
  });
  await c.start();
  return { kit, c, execute };
}

describe("WalletConnect controller (WalletKit mocked)", () => {
  it("a proposal exposes only the ONE address the user picked", async () => {
    const { kit, c } = await setup();
    kit.emit("session_proposal", proposal());
    expect(c.getState().proposal).toMatchObject({ id: 7, dapp: { name: "Morpho" }, validation: "VALID", error: null });
    await expect(c.approveProposal(getAddress("0x3333333333333333333333333333333333333333"))).rejects.toThrow(/payment addresses/);
    await c.approveProposal(B);
    const ns = kit.approveSession.mock.calls[0]![0].namespaces;
    expect(Object.values(ns).flatMap((n) => n.accounts)).toEqual([`eip155:${CHAIN}:${B}`]);
    expect(c.getState().sessions).toEqual([expect.objectContaining({ topic: "t1", address: B, chainId: CHAIN })]);
  });

  it("rejecting an unsupported proposal sends WalletConnect's reason", async () => {
    const { kit, c } = await setup();
    kit.emit("session_proposal", { ...proposal(8), params: { ...proposal(8).params, requiredNamespaces: { eip155: { chains: ["eip155:1"] } } } });
    expect(c.getState().proposal?.error).toMatch(/eip155:1/);
    await c.rejectProposal();
    expect(kit.rejectSession).toHaveBeenCalledWith({ id: 8, reason: expect.objectContaining({ code: 5100 }) });
  });

  it("requests on a session carrying two addresses are refused, never answered with an address", async () => {
    const { kit } = await setup();
    kit.sessions.bad = { topic: "bad", namespaces: { eip155: { accounts: [`eip155:${CHAIN}:${A}`, `eip155:${CHAIN}:${B}`] } }, peer: { metadata: {} } };
    kit.emit("session_request", request(1, "eth_accounts", [], "bad"));
    await flush();
    expect(kit.respondSessionRequest).toHaveBeenCalledWith({ topic: "bad", response: { id: 1, jsonrpc: "2.0", error: expect.objectContaining({ code: RPC.unauthorized }) } });
  });

  it("eth_sendTransaction waits for the approval sheet, then answers with the tx hash", async () => {
    const { kit, c, execute } = await setup();
    kit.emit("session_proposal", proposal());
    await c.approveProposal(A);
    kit.emit("session_request", request(2, "eth_sendTransaction", [{ from: A, to: B, data: "0x" }]));
    await flush();
    expect(c.getState().approval).toMatchObject({ requestId: 2, request: { kind: "transaction", address: A } });
    expect(execute).not.toHaveBeenCalled();
    c.resolveApproval({ approved: true });
    await flush();
    expect(execute).toHaveBeenCalledTimes(1);
    expect(kit.respondSessionRequest).toHaveBeenLastCalledWith({ topic: "t1", response: { id: 2, jsonrpc: "2.0", result: TX } });
    expect(c.getState().approval).toBeNull();
  });

  it("non-zero value and unsupported methods are answered with errors, no sheet shown", async () => {
    const { kit, c } = await setup();
    kit.emit("session_proposal", proposal());
    await c.approveProposal(A);
    kit.emit("session_request", request(3, "eth_sendTransaction", [{ from: A, to: B, value: "0x1" }]));
    kit.emit("session_request", request(4, "eth_sign", [A, "0x00"]));
    await flush();
    expect(c.getState().approval).toBeNull();
    const errs = kit.respondSessionRequest.mock.calls.map((x) => (x as unknown as [{ response: { id: number; error?: { code: number } } }])[0].response);
    expect(errs.find((r) => r.id === 3)?.error?.code).toBe(RPC.invalidParams);
    expect(errs.find((r) => r.id === 4)?.error?.code).toBe(RPC.unsupportedMethod);
  });

  it("a session on another chain than the app's is refused (the user switched networks)", async () => {
    const { kit } = await setup();
    kit.sessions.old = { topic: "old", namespaces: { eip155: { accounts: [`eip155:8453:${A}`] } }, peer: { metadata: {} } };
    kit.emit("session_request", { ...request(5, "eth_accounts", [], "old"), params: { request: { method: "eth_accounts" }, chainId: "eip155:8453" } });
    await flush();
    expect(kit.respondSessionRequest).toHaveBeenCalledWith({ topic: "old", response: { id: 5, jsonrpc: "2.0", error: expect.objectContaining({ code: 4901 }) } });
  });

  it("approval sheets queue one at a time; dispose rejects what's on screen", async () => {
    const { kit, c } = await setup();
    kit.emit("session_proposal", proposal());
    await c.approveProposal(A);
    kit.emit("session_request", request(10, "personal_sign", ["0x68690a", A]));
    kit.emit("session_request", request(11, "personal_sign", ["0x686900", A]));
    await flush();
    expect(c.getState().approval?.requestId).toBe(10);
    c.resolveApproval({ approved: false });
    await flush();
    expect(c.getState().approval?.requestId).toBe(11);
    c.dispose();
    await flush();
    const r10 = kit.respondSessionRequest.mock.calls.map((x) => (x as unknown as [{ response: { id: number; error?: { code: number } } }])[0].response).find((r) => r.id === 10);
    expect(r10?.error?.code).toBe(RPC.userRejected);
  });
});
