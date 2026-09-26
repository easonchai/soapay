import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConfigError, loadConfig } from "../src/config.js";
import { Caps, PlanStore, checkAllowlist, normalizeName, utcDay } from "../src/guardrails.js";
import { redact, redactString, stderrLogger } from "../src/log.js";
import { fileStateStore, memoryStateStore } from "../src/state.js";
import { formatUsdc, parseUsdc, toJson, ToolError } from "../src/util.js";
import { AGENT_MNEMONIC, NOW, PAYER_KEY } from "./helpers.js";

const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return (e as ToolError).code;
  }
  return "no-throw";
};

describe("USDC amounts", () => {
  it("parses decimal strings and numbers with up to 6 decimals", () => {
    expect(parseUsdc("2")).toBe(2_000_000n);
    expect(parseUsdc("2.5")).toBe(2_500_000n);
    expect(parseUsdc(0.000001)).toBe(1n);
    expect(formatUsdc(2_500_000n)).toBe("2.5");
  });
  it.each(["0", "-1", "1.0000001", "1e3", "abc", ""])("rejects %j", (v) => {
    expect(code(() => parseUsdc(v))).toBe("invalid_amount");
  });
});

describe("caps", () => {
  const cfg = { maxPerCallUsdc: 5_000_000n, maxPerDayUsdc: 8_000_000n };
  it("enforces the per-call cap", () => {
    const caps = new Caps(cfg, memoryStateStore());
    expect(code(() => caps.check(5_000_001n, NOW))).toBe("cap_per_call");
    expect(code(() => caps.check(5_000_000n, NOW))).toBe("no-throw");
  });
  it("counts spends per UTC day, persists them, and resets the next day", () => {
    const state = memoryStateStore();
    const caps = new Caps(cfg, state);
    caps.consume(5_000_000n, NOW);
    expect(state.data.spend).toEqual({ day: utcDay(NOW), usdc: "5000000" });
    expect(caps.remainingToday(NOW)).toBe(3_000_000n);
    expect(code(() => caps.consume(3_000_001n, NOW))).toBe("cap_per_day");
    expect(new Caps(cfg, state).spentToday(NOW)).toBe(5_000_000n); // survives a restart
    expect(caps.remainingToday(NOW + 86_400)).toBe(8_000_000n);
    expect(code(() => caps.check(9_000_000n, NOW, { daily: false }))).toBe("cap_per_call");
  });
});

describe("plans", () => {
  it("are single-use", () => {
    const p = new PlanStore(600);
    const { planId } = p.create("pay", { x: 1 }, NOW);
    expect(p.take(planId, "pay", NOW)).toEqual({ x: 1 });
    expect(code(() => p.take(planId, "pay", NOW))).toBe("plan_used");
  });
  it("expire after the TTL, and can't be retried after expiring", () => {
    const p = new PlanStore(600);
    const { planId } = p.create("pay", {}, NOW);
    expect(code(() => p.take(planId, "pay", NOW + 600))).toBe("plan_expired");
    expect(code(() => p.take(planId, "pay", NOW))).toBe("plan_used");
  });
  it("reject unknown ids and the wrong kind", () => {
    const p = new PlanStore(600);
    const { planId } = p.create("spend", {}, NOW);
    expect(code(() => p.take("pay_" + "0".repeat(24), "pay", NOW))).toBe("plan_unknown");
    expect(code(() => p.take(planId, "pay", NOW))).toBe("plan_kind");
  });
});

describe("allowlist and names", () => {
  it("allows only listed names, and no raw addresses, when set", () => {
    expect(code(() => checkAllowlist(null, { address: "0x1" }))).toBe("no-throw");
    expect(code(() => checkAllowlist(["alice.soapay.eth"], { name: "alice.soapay.eth" }))).toBe("no-throw");
    expect(code(() => checkAllowlist(["alice.soapay.eth"], { name: "bob.soapay.eth" }))).toBe("not_allowlisted");
    expect(code(() => checkAllowlist(["alice.soapay.eth"], { address: "0x1" }))).toBe("not_allowlisted");
  });
  it("normalises names", () => {
    expect(normalizeName(" Alice.Soapay.ETH ")).toBe("alice.soapay.eth");
    expect(code(() => normalizeName("alice"))).toBe("invalid_name");
  });
});

describe("config", () => {
  it("has testnet defaults and parses the env", () => {
    const { config, secrets } = loadConfig({ AGENT_MNEMONIC, AGENT_PAYER_PRIVATE_KEY: PAYER_KEY, PAYEE_ALLOWLIST: "Alice.soapay.eth, bob.soapay.eth" });
    expect(config.chainId).toBe(84532);
    expect(config.stealthDisperse).toBe("0x6B7a1cC570Af2DDd427DA694351438F0FE8039CA");
    expect(config.bundlerUrl).toBe("https://public.pimlico.io/v2/84532/rpc");
    expect(config.payeeAllowlist).toEqual(["alice.soapay.eth", "bob.soapay.eth"]);
    expect(config.planTtlSeconds).toBe(600);
    expect(secrets.payerKey).toBe(PAYER_KEY);
    // Secrets are not in the public config.
    expect(toJson(config)).not.toContain("junk");
    expect(toJson(config)).not.toContain(PAYER_KEY.slice(2));
  });
  it("rejects bad secrets and caps", () => {
    expect(() => loadConfig({ AGENT_MNEMONIC: "not a mnemonic" })).toThrow(ConfigError);
    expect(() => loadConfig({ AGENT_PAYER_PRIVATE_KEY: "0x1234" })).toThrow(ConfigError);
    expect(() => loadConfig({ MAX_PER_CALL_USDC: "30", MAX_PER_DAY_USDC: "20" })).toThrow(ConfigError);
    expect(() => loadConfig({ PLAN_TTL_SECONDS: "99999" })).not.toThrow();
    expect(loadConfig({ PLAN_TTL_SECONDS: "99999" }).config.planTtlSeconds).toBe(600);
  });
});

describe("logging redaction", () => {
  it("shortens addresses and drops keys and mnemonics", () => {
    expect(redactString("to 0x6B7a1cC570Af2DDd427DA694351438F0FE8039CA ok")).toBe("to 0x6B7a…39CA ok");
    expect(redactString(`k=${PAYER_KEY}`)).toBe("k=[redacted]");
    expect(redactString(AGENT_MNEMONIC)).toBe("[redacted]");
    expect(redact({ payerKey: "x", nested: { signature: "0xab", n: 1n } })).toEqual({ payerKey: "[redacted]", nested: { signature: "[redacted]", n: "1" } });
  });
  it("writes JSON lines with redacted fields", () => {
    const lines: string[] = [];
    stderrLogger((l) => lines.push(l)).info("paid 0x6B7a1cC570Af2DDd427DA694351438F0FE8039CA", { to: "0x6B7a1cC570Af2DDd427DA694351438F0FE8039CA" });
    const rec = JSON.parse(lines[0]!);
    expect(rec.msg).toBe("paid 0x6B7a…39CA");
    expect(rec.to).toBe("0x6B7a…39CA");
  });
});

describe("state file", () => {
  it("round-trips and is private (0600)", () => {
    const dir = mkdtempSync(join(tmpdir(), "soapay-mcp-"));
    const s = fileStateStore(dir);
    const d = s.read();
    d.pins["alice.soapay.eth"] = "st:eth:0x01";
    s.write(d);
    expect(s.read().pins["alice.soapay.eth"]).toBe("st:eth:0x01");
    expect(statSync(join(dir, "state.json")).mode & 0o777).toBe(0o600);
    expect(JSON.parse(readFileSync(join(dir, "state.json"), "utf8")).version).toBe(1);
  });
});
