import { Hono } from "hono";
import { decodeFunctionData, getAddress, isAddress, isHex, numberToHex, parseAbi, type Address, type Hex } from "viem";
import { ENTRYPOINT_V08, SIMPLE_7702_ACCOUNT } from "@soapay/sdk";
import type { AppDeps } from "../app.js";
import { TESTNET_SPONSOR_CHAIN_ID } from "../config.js";
import { ApiError, enforceRateLimits, errorBody } from "../util.js";

/** ERC-7677 methods (viem's paymaster client) plus Pimlico's one-shot `pm_sponsorUserOperation`. */
export const PAYMASTER_METHODS = new Set(["pm_getPaymasterStubData", "pm_getPaymasterData", "pm_sponsorUserOperation"]);
const UPSTREAM_TIMEOUT_MS = 20_000;
const DAY = 86_400;

/**
 * EntryPoints we sponsor: v0.8 (stealth spends, 7702 + Simple7702Account), plus v0.6 / v0.7 for the
 * employer's EIP-5792 batch from a smart wallet (Coinbase Smart Wallet uses v0.6).
 */
export const SPONSORED_ENTRYPOINTS: readonly Address[] = [
  ENTRYPOINT_V08,
  "0x0000000071727De22E5E9d8BAf0edAc6f37da032", // v0.7
  "0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789", // v0.6
];

/** Account factories allowed in initCode / factory (a first, counterfactual smart-wallet op). */
export const SPONSORED_FACTORIES: readonly Address[] = [
  "0x0BA5ED0c6AA8c49038F819E587E2633c4A9F428a", // Coinbase Smart Wallet factory v1
];

/**
 * execute / executeBatch as Simple7702Account (eth-infinitism) and Coinbase Smart Wallet both
 * declare them: every call a sponsored account makes goes through one.
 */
const accountAbi = parseAbi([
  "function execute(address target, uint256 value, bytes data)",
  "function executeBatch((address target, uint256 value, bytes data)[] calls)",
]);

export type SponsorCheck = { ok: true; targets: Address[] } | { ok: false; reason: string };

const isFactoryAllowed = (f: string) => SPONSORED_FACTORIES.some((a) => a.toLowerCase() === f.toLowerCase());

/**
 * Decides whether a userOp may be sponsored: an execute / executeBatch call whose every target is
 * allow-listed and moves no ETH. A 7702 authorization must delegate to Simple7702Account; a factory
 * must be the 0x7702 marker or an allowed smart-wallet factory. Anything else is refused before it
 * reaches Pimlico.
 */
export function checkSponsorable(userOp: unknown, allowedTargets: readonly Address[]): SponsorCheck {
  if (!userOp || typeof userOp !== "object") return { ok: false, reason: "userOp missing" };
  const op = userOp as Record<string, unknown>;
  if (typeof op.sender !== "string" || !isAddress(op.sender, { strict: false })) return { ok: false, reason: "userOp.sender invalid" };
  if (typeof op.callData !== "string" || !isHex(op.callData)) return { ok: false, reason: "userOp.callData invalid" };
  // v0.6: initCode = factory (20 bytes) || factoryData.
  if (op.initCode !== undefined && op.initCode !== null && op.initCode !== "0x") {
    if (typeof op.initCode !== "string" || !isHex(op.initCode) || op.initCode.length < 42 || !isFactoryAllowed(op.initCode.slice(0, 42)))
      return { ok: false, reason: "initCode factory not allowed" };
  }
  const factory = typeof op.factory === "string" ? op.factory.toLowerCase() : undefined;
  if (factory && factory !== "0x" && factory !== "0x7702" && factory !== `0x7702${"0".repeat(36)}` && !(isAddress(factory, { strict: false }) && isFactoryAllowed(factory)))
    return { ok: false, reason: "factory not allowed" };
  const auth = op.eip7702Auth as { address?: unknown } | undefined | null;
  if (auth && (typeof auth.address !== "string" || !isAddress(auth.address, { strict: false }) || getAddress(auth.address) !== getAddress(SIMPLE_7702_ACCOUNT)))
    return { ok: false, reason: "7702 authorization must delegate to Simple7702Account" };

  let calls: { target: Address; value: bigint }[];
  try {
    const d = decodeFunctionData({ abi: accountAbi, data: op.callData as Hex });
    if (d.functionName === "execute") {
      const [target, value] = d.args as readonly [Address, bigint, Hex];
      calls = [{ target, value }];
    } else {
      const [batch] = d.args as readonly [readonly { target: Address; value: bigint; data: Hex }[]];
      calls = batch.map((c) => ({ target: c.target, value: c.value }));
    }
  } catch {
    return { ok: false, reason: "callData is not Simple7702Account.execute/executeBatch" };
  }
  if (calls.length === 0) return { ok: false, reason: "no calls" };
  const allowed = new Set(allowedTargets.map((a) => getAddress(a)));
  for (const c of calls) {
    if (c.value !== 0n) return { ok: false, reason: "calls must not move ETH" };
    if (!allowed.has(getAddress(c.target))) return { ok: false, reason: `call target ${getAddress(c.target)} is not sponsored` };
  }
  return { ok: true, targets: calls.map((c) => getAddress(c.target)) };
}

type RpcRequest = { jsonrpc?: unknown; id?: unknown; method?: unknown; params?: unknown };

const rpcError = (id: unknown, code: number, message: string) => ({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });

/**
 * POST /paymaster: ERC-7677 gas sponsorship on Base Sepolia (D-52), proxied to Pimlico with
 * `PIMLICO_API_KEY`, which never leaves the server. Used by stealth spends (recipient app, MCP) and
 * as the `paymasterService` of the employer's EIP-5792 batch from a smart wallet. Only paymaster
 * methods, only chain 84532, only userOps whose calls target the allow-list (pay token, Permit2,
 * Universal Router, StealthDisperse, Announcer), with per-IP and daily limits. Without the key it
 * answers 503 `sponsorship_disabled`. CORS is open on this route: wallets call it from their own
 * origin (e.g. keys.coinbase.com).
 */
export function paymasterRoutes(deps: AppDeps): Hono {
  const r = new Hono();
  const { config, db, logger } = deps;
  const cfg = config.paymaster;

  r.post("/paymaster", async (c) => {
    if (config.chainId !== TESTNET_SPONSOR_CHAIN_ID) throw new ApiError(404, "not_found", "Gas sponsorship is testnet-only");
    if (!cfg.pimlicoApiKey) {
      return c.json({ code: "sponsorship_disabled", ...errorBody("sponsorship_disabled", "Gas sponsorship is not configured on this server") }, 503);
    }
    let req: RpcRequest;
    try {
      req = (await c.req.json()) as RpcRequest;
    } catch {
      throw new ApiError(400, "invalid_json", "Body must be JSON");
    }
    if (!req || typeof req !== "object" || Array.isArray(req)) return c.json(rpcError(null, -32600, "single JSON-RPC request only"), 400);
    const { id, method } = req;
    if (typeof method !== "string" || !PAYMASTER_METHODS.has(method)) return c.json(rpcError(id, -32601, "method not allowed"), 400);
    const params = Array.isArray(req.params) ? [...req.params] : [];
    const [userOp, entryPoint] = params;
    if (typeof entryPoint !== "string" || !isAddress(entryPoint, { strict: false }) || !SPONSORED_ENTRYPOINTS.some((e) => getAddress(e) === getAddress(entryPoint)))
      return c.json(rpcError(id, -32602, "EntryPoint not sponsored"), 400);
    if (method !== "pm_sponsorUserOperation") {
      const chainId = params[2];
      if (typeof chainId !== "string" || !isHex(chainId) || BigInt(chainId) !== BigInt(TESTNET_SPONSOR_CHAIN_ID))
        return c.json(rpcError(id, -32602, `only chain ${TESTNET_SPONSOR_CHAIN_ID} is sponsored`), 400);
    }
    const check = checkSponsorable(userOp, cfg.allowedTargets);
    if (!check.ok) {
      logger.warn("paymaster: refused", { method, reason: check.reason });
      return c.json(rpcError(id, -32602, `not sponsored: ${check.reason}`), 400);
    }
    enforceRateLimits(db, [{ bucket: "paymaster:ip", key: deps.getIp(c), limit: cfg.perIpPerMinute }], 60, deps.now());
    enforceRateLimits(db, [{ bucket: "paymaster:global", key: "all", limit: cfg.perDay }], DAY, deps.now());

    // The server owns the context: clients cannot pick another sponsorship policy.
    const context = cfg.sponsorshipPolicyId ? { sponsorshipPolicyId: cfg.sponsorshipPolicyId } : undefined;
    const upstreamParams =
      method === "pm_sponsorUserOperation"
        ? [userOp, entryPoint, ...(context ? [context] : [])]
        : [userOp, entryPoint, numberToHex(TESTNET_SPONSOR_CHAIN_ID), context ?? {}];

    let res: Response;
    try {
      res = await deps.paymasterFetch(`${cfg.upstreamUrl}?apikey=${encodeURIComponent(cfg.pimlicoApiKey)}`, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: id ?? 1, method, params: upstreamParams }),
        signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      });
    } catch (e) {
      const timeout = (e as Error).name === "TimeoutError";
      logger.warn("paymaster: upstream unreachable", { method, timeout });
      throw new ApiError(timeout ? 504 : 502, "paymaster_unreachable", "The sponsorship paymaster is unreachable");
    }
    // Status only: never the key, the request or the response body.
    if (!res.ok) logger.warn("paymaster: upstream error", { method, status: res.status });
    const text = await res.text();
    return c.body(text, res.ok ? 200 : 502, { "content-type": "application/json", "cache-control": "no-store" });
  });

  return r;
}
