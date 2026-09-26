import { describe, expect, it, vi } from "vitest";
import { encodeFunctionData, erc20Abi, getAddress, numberToHex, parseAbi, type Address, type Hex } from "viem";
import { ANNOUNCER_ADDRESS, ENTRYPOINT_V08, MOCK_USDC_BASE_SEPOLIA, PERMIT2_ADDRESS, SIMPLE_7702_ACCOUNT, STEALTH_DISPERSE_BASE_SEPOLIA } from "@soapay/sdk";
import { checkSponsorable } from "../src/routes/paymaster.js";
import { j, makeTestApp } from "./helpers.js";

const accountAbi = parseAbi([
  "function execute(address target, uint256 value, bytes data)",
  "function executeBatch((address target, uint256 value, bytes data)[] calls)",
]);
const SENDER = "0x1234567890123456789012345678901234567890" as Address;
const ROUTER = "0x8702463e73f74d0b6765aBceb314Ef07aCb92650" as Address;
const EVIL = "0x000000000000000000000000000000000000bEEF" as Address;
const CHAIN = numberToHex(84532);
const EP06 = "0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789";
const CB_FACTORY = "0x0BA5ED0c6AA8c49038F819E587E2633c4A9F428a";

const transfer = encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [EVIL, 1n] });
const exec = (target: Address, value = 0n, data: Hex = transfer) => encodeFunctionData({ abi: accountAbi, functionName: "execute", args: [target, value, data] });
const batch = (...targets: Address[]) =>
  encodeFunctionData({ abi: accountAbi, functionName: "executeBatch", args: [targets.map((target) => ({ target, value: 0n, data: transfer }))] });
const op = (callData: Hex, extra: Record<string, unknown> = {}) => ({ sender: SENDER, nonce: "0x0", callData, ...extra });
const auth = (address: Address = SIMPLE_7702_ACCOUNT) => ({ address, chainId: CHAIN, nonce: "0x0", r: "0x1", s: "0x2", yParity: "0x0" });

function upstream(json: unknown = { jsonrpc: "2.0", id: 1, result: { paymaster: EVIL, paymasterData: "0x01" } }, status = 200) {
  return vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => Response.json(json, { status }));
}
const rpc = (t: ReturnType<typeof makeTestApp>, body: unknown, headers: Record<string, string> = {}) =>
  t.app.request("/paymaster", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json", ...headers } });
const stub = (userOp: unknown, params: unknown[] = [ENTRYPOINT_V08, CHAIN, {}]) => ({ jsonrpc: "2.0", id: 7, method: "pm_getPaymasterStubData", params: [userOp, ...params] });

describe("checkSponsorable (the allow-list)", () => {
  const allowed = [MOCK_USDC_BASE_SEPOLIA, PERMIT2_ADDRESS, ROUTER, STEALTH_DISPERSE_BASE_SEPOLIA, ANNOUNCER_ADDRESS];

  it("accepts a stealth transfer of the pay token with a 7702 authorization to Simple7702Account", () => {
    expect(checkSponsorable(op(exec(MOCK_USDC_BASE_SEPOLIA), { factory: "0x7702", eip7702Auth: auth() }), allowed)).toEqual({
      ok: true,
      targets: [getAddress(MOCK_USDC_BASE_SEPOLIA)],
    });
  });

  it("accepts a swap-shaped batch (token, Permit2, router) and the employer's 5792 batch (token, Announcer)", () => {
    expect(checkSponsorable(op(batch(MOCK_USDC_BASE_SEPOLIA, PERMIT2_ADDRESS, ROUTER)), allowed).ok).toBe(true);
    expect(checkSponsorable(op(batch(MOCK_USDC_BASE_SEPOLIA, ANNOUNCER_ADDRESS, MOCK_USDC_BASE_SEPOLIA, ANNOUNCER_ADDRESS)), allowed).ok).toBe(true);
    expect(checkSponsorable(op(batch(STEALTH_DISPERSE_BASE_SEPOLIA)), allowed).ok).toBe(true);
  });

  it("accepts a first Coinbase Smart Wallet op (v0.6 initCode from its factory)", () => {
    expect(checkSponsorable(op(batch(MOCK_USDC_BASE_SEPOLIA), { initCode: `${CB_FACTORY}abcd` }), allowed).ok).toBe(true);
  });

  it("refuses other targets, ETH value, unknown factories, foreign 7702 delegates and non-account calldata", () => {
    expect(checkSponsorable(op(exec(EVIL)), allowed)).toMatchObject({ ok: false, reason: expect.stringMatching(/not sponsored/) });
    expect(checkSponsorable(op(batch(MOCK_USDC_BASE_SEPOLIA, EVIL)), allowed).ok).toBe(false);
    expect(checkSponsorable(op(exec(MOCK_USDC_BASE_SEPOLIA, 1n)), allowed)).toMatchObject({ ok: false, reason: "calls must not move ETH" });
    expect(checkSponsorable(op(exec(MOCK_USDC_BASE_SEPOLIA), { initCode: `${EVIL}00` }), allowed).ok).toBe(false);
    expect(checkSponsorable(op(exec(MOCK_USDC_BASE_SEPOLIA), { factory: EVIL }), allowed).ok).toBe(false);
    expect(checkSponsorable(op(exec(MOCK_USDC_BASE_SEPOLIA), { eip7702Auth: auth(EVIL) }), allowed).ok).toBe(false);
    expect(checkSponsorable(op(transfer), allowed).ok).toBe(false);
    expect(checkSponsorable(op(batch()), allowed)).toMatchObject({ ok: false, reason: "no calls" });
    expect(checkSponsorable(null, allowed).ok).toBe(false);
  });
});

describe("POST /paymaster (Pimlico sponsorship proxy)", () => {
  it("503 sponsorship_disabled without PIMLICO_API_KEY", async () => {
    const t = makeTestApp();
    const res = await rpc(t, stub(op(exec(MOCK_USDC_BASE_SEPOLIA))));
    expect(res.status).toBe(503);
    expect(await j(res)).toMatchObject({ code: "sponsorship_disabled" });
  });

  it("forwards an allowed stub request with the server's key and context, and returns Pimlico's answer", async () => {
    const f = upstream();
    const t = makeTestApp({ env: { PIMLICO_API_KEY: "pim-secret", PIMLICO_SPONSORSHIP_POLICY_ID: "sp_policy" }, paymasterFetch: f as unknown as typeof fetch });
    const userOp = op(exec(MOCK_USDC_BASE_SEPOLIA), { factory: "0x7702", eip7702Auth: auth() });
    // The client's context is ignored: the server picks the policy.
    const res = await rpc(t, stub(userOp, [ENTRYPOINT_V08, CHAIN, { sponsorshipPolicyId: "sp_someone_else" }]));
    expect(res.status).toBe(200);
    expect(await j(res)).toEqual({ jsonrpc: "2.0", id: 1, result: { paymaster: EVIL, paymasterData: "0x01" } });
    const [url, init] = f.mock.calls[0]!;
    expect(url).toBe("https://api.pimlico.io/v2/84532/rpc?apikey=pim-secret");
    const sent = JSON.parse(String(init!.body));
    expect(sent).toEqual({ jsonrpc: "2.0", id: 7, method: "pm_getPaymasterStubData", params: [userOp, ENTRYPOINT_V08, CHAIN, { sponsorshipPolicyId: "sp_policy" }] });
    // The key is never logged.
    expect(JSON.stringify(t.logs)).not.toContain("pim-secret");
  });

  it("accepts EntryPoint v0.6 (smart-wallet 5792 batches) and pm_sponsorUserOperation", async () => {
    const f = upstream();
    const t = makeTestApp({ env: { PIMLICO_API_KEY: "k" }, paymasterFetch: f as unknown as typeof fetch });
    expect((await rpc(t, stub(op(batch(MOCK_USDC_BASE_SEPOLIA, ANNOUNCER_ADDRESS)), [EP06, CHAIN, {}]))).status).toBe(200);
    const res = await rpc(t, { jsonrpc: "2.0", id: 1, method: "pm_sponsorUserOperation", params: [op(exec(MOCK_USDC_BASE_SEPOLIA)), ENTRYPOINT_V08] });
    expect(res.status).toBe(200);
    expect(JSON.parse(String(f.mock.calls[1]![1]!.body)).params).toHaveLength(2);
  });

  it("refuses other methods, chains, entry points, targets and batch requests without calling upstream", async () => {
    const f = upstream();
    const t = makeTestApp({ env: { PIMLICO_API_KEY: "k" }, paymasterFetch: f as unknown as typeof fetch });
    const good = op(exec(MOCK_USDC_BASE_SEPOLIA));
    const cases: [unknown, RegExp][] = [
      [{ jsonrpc: "2.0", id: 1, method: "eth_sendUserOperation", params: [good, ENTRYPOINT_V08] }, /method not allowed/],
      [{ jsonrpc: "2.0", id: 1, method: "pimlico_getUserOperationGasPrice", params: [] }, /method not allowed/],
      [stub(good, [ENTRYPOINT_V08, numberToHex(8453), {}]), /only chain 84532/],
      [stub(good, ["0x000000000000000000000000000000000000dEaD", CHAIN, {}]), /EntryPoint not sponsored/],
      [stub(op(exec(EVIL))), /not sponsored: call target/],
      [stub(op(exec(MOCK_USDC_BASE_SEPOLIA, 5n))), /must not move ETH/],
      [[stub(good)], /single JSON-RPC request/],
    ];
    for (const [body, err] of cases) {
      const res = await rpc(t, body);
      expect(res.status).toBe(400);
      expect(JSON.stringify(await j(res))).toMatch(err);
    }
    expect(f).not.toHaveBeenCalled();
  });

  it("rate-limits per IP per minute", async () => {
    const f = upstream();
    const t = makeTestApp({ env: { PIMLICO_API_KEY: "k", RATE_LIMIT_PAYMASTER_PER_IP_PER_MINUTE: "2" }, paymasterFetch: f as unknown as typeof fetch });
    const body = stub(op(exec(MOCK_USDC_BASE_SEPOLIA)));
    expect((await rpc(t, body)).status).toBe(200);
    expect((await rpc(t, body)).status).toBe(200);
    expect((await rpc(t, body)).status).toBe(429);
    t.setIp("10.0.0.2");
    expect((await rpc(t, body)).status).toBe(200);
  });

  it("maps an unreachable upstream to 502 and upstream errors to 502", async () => {
    const down = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    const t = makeTestApp({ env: { PIMLICO_API_KEY: "k" }, paymasterFetch: down as unknown as typeof fetch });
    expect((await rpc(t, stub(op(exec(MOCK_USDC_BASE_SEPOLIA))))).status).toBe(502);
    const t2 = makeTestApp({ env: { PIMLICO_API_KEY: "k" }, paymasterFetch: upstream({ error: "boom" }, 500) as unknown as typeof fetch });
    expect((await rpc(t2, stub(op(exec(MOCK_USDC_BASE_SEPOLIA))))).status).toBe(502);
  });

  it("is 404 on a chain other than Base Sepolia", async () => {
    const t = makeTestApp({ env: { PIMLICO_API_KEY: "k", CHAIN_ID: "8453" } });
    expect((await rpc(t, stub(op(exec(MOCK_USDC_BASE_SEPOLIA))))).status).toBe(404);
  });

  it("answers CORS for any origin on /paymaster only (wallets call it from their own origin)", async () => {
    const t = makeTestApp({ env: { PIMLICO_API_KEY: "k" }, paymasterFetch: upstream() as unknown as typeof fetch });
    const pre = await t.app.request("/paymaster", { method: "OPTIONS", headers: { origin: "https://keys.coinbase.com", "access-control-request-method": "POST" } });
    expect(pre.headers.get("access-control-allow-origin")).toBe("https://keys.coinbase.com");
    const other = await t.app.request("/faucet", { method: "OPTIONS", headers: { origin: "https://keys.coinbase.com", "access-control-request-method": "POST" } });
    expect(other.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("the default allow-list is the pay token, Permit2, the Universal Router, StealthDisperse and the Announcer", () => {
    const t = makeTestApp();
    expect(t.config.paymaster.allowedTargets).toEqual(
      [MOCK_USDC_BASE_SEPOLIA, PERMIT2_ADDRESS, ROUTER, STEALTH_DISPERSE_BASE_SEPOLIA, ANNOUNCER_ADDRESS].map((a) => getAddress(a)),
    );
    const o = makeTestApp({ env: { PAY_TOKEN: EVIL } });
    expect(o.config.paymaster.allowedTargets[0]).toBe(getAddress(EVIL));
  });
});
