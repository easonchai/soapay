import { describe, expect, it, vi } from "vitest";
import { j, makeTestApp } from "./helpers.js";

const STEALTH = "0x1234567890123456789012345678901234567890";

function upstream(status = 200, json: unknown = { requestId: "r1", quote: { ok: true } }) {
  return vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => Response.json(json, { status }));
}

const post = (t: ReturnType<typeof makeTestApp>, path: string, body: unknown, headers: Record<string, string> = {}) =>
  t.app.request(path, {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
    headers: { "content-type": "application/json", ...headers },
  });

describe("POST /uniswap/:endpoint (Trading API proxy)", () => {
  it("forwards quote/swap/check_approval with the server's key, passing status and body through", async () => {
    const f = upstream();
    const t = makeTestApp({ env: { UNISWAP_API_KEY: "secret-key" }, uniswapFetch: f as unknown as typeof fetch });
    const body = { type: "EXACT_INPUT", swapper: STEALTH, recipient: STEALTH, amount: "1" };
    for (const ep of ["quote", "swap", "check_approval"]) {
      const res = await post(t, `/uniswap/${ep}`, body, {
        "x-universal-router-version": "2.1.2",
        "x-agent-info": '{"decision_origin":"human_mediated"}',
        "x-api-key": "client-supplied-must-be-ignored",
        cookie: "a=b",
      });
      expect(res.status).toBe(200);
      expect(await j(res)).toEqual({ requestId: "r1", quote: { ok: true } });
    }
    expect(f.mock.calls.map((c) => c[0])).toEqual([
      "https://trade-api.gateway.uniswap.org/v1/quote",
      "https://trade-api.gateway.uniswap.org/v1/swap",
      "https://trade-api.gateway.uniswap.org/v1/check_approval",
    ]);
    const init = f.mock.calls[0]![1]!;
    expect(init.headers).toEqual({
      "content-type": "application/json",
      accept: "application/json",
      "x-api-key": "secret-key",
      "x-universal-router-version": "2.1.2",
      "x-agent-info": '{"decision_origin":"human_mediated"}',
    });
    expect(JSON.parse(String(init.body))).toEqual(body);
  });

  it("passes upstream errors through with their status", async () => {
    const t = makeTestApp({ env: { UNISWAP_API_KEY: "k" }, uniswapFetch: upstream(404, { errorCode: "ResourceNotFound" }) as unknown as typeof fetch });
    const res = await post(t, "/uniswap/quote", {});
    expect(res.status).toBe(404);
    expect(await j(res)).toEqual({ errorCode: "ResourceNotFound" });
  });

  it("answers 503 uniswap_disabled without a key, so the SDK falls back", async () => {
    const f = upstream();
    const t = makeTestApp({ uniswapFetch: f as unknown as typeof fetch });
    const res = await post(t, "/uniswap/quote", {});
    expect(res.status).toBe(503);
    expect((await j(res)).code).toBe("uniswap_disabled");
    expect(f).not.toHaveBeenCalled();
  });

  it("allows only the three endpoints, JSON bodies and a capped size", async () => {
    const f = upstream();
    const t = makeTestApp({ env: { UNISWAP_API_KEY: "k", UNISWAP_BODY_LIMIT_BYTES: "512" }, uniswapFetch: f as unknown as typeof fetch });
    expect((await post(t, "/uniswap/order", {})).status).toBe(404);
    expect((await post(t, "/uniswap/..%2Fquote", {})).status).toBe(404);
    expect((await t.app.request("/uniswap/quote")).status).toBe(404);
    expect((await post(t, "/uniswap/quote", "not json")).status).toBe(400);
    expect((await post(t, "/uniswap/quote", { pad: "x".repeat(600) })).status).toBe(413);
    expect(f).not.toHaveBeenCalled();
  });

  it("rate-limits per IP per minute", async () => {
    const t = makeTestApp({ env: { UNISWAP_API_KEY: "k", RATE_LIMIT_UNISWAP_PER_IP_PER_MINUTE: "2" }, uniswapFetch: upstream() as unknown as typeof fetch });
    expect((await post(t, "/uniswap/quote", {})).status).toBe(200);
    expect((await post(t, "/uniswap/quote", {})).status).toBe(200);
    expect((await post(t, "/uniswap/quote", {})).status).toBe(429);
    t.setIp("10.0.0.2");
    expect((await post(t, "/uniswap/quote", {})).status).toBe(200);
  });

  it("maps an unreachable upstream to 502 and never logs bodies or the key", async () => {
    const t = makeTestApp({
      env: { UNISWAP_API_KEY: "secret-key" },
      uniswapFetch: (async () => Promise.reject(new Error("ECONNRESET"))) as unknown as typeof fetch,
    });
    const res = await post(t, "/uniswap/swap", { swapper: STEALTH });
    expect(res.status).toBe(502);
    const logged = JSON.stringify(t.logs);
    expect(logged).not.toContain(STEALTH.slice(2));
    expect(logged).not.toContain("secret-key");
  });
});
