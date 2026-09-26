// Base Sepolia demo (D-52): mock USDC, sponsored spends, and a one-time test-funds drop for the payer.
import { afterEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { MOCK_USDC_BASE_SEPOLIA, configurePayToken, getChainConfig } from "@soapay/sdk";
import { ConfigError, loadConfig } from "../src/config.js";
import { ApiError } from "../src/context.js";
import { createServer } from "../src/server.js";
import { getTestFunds } from "../src/tools/funds.js";
import { whoami } from "../src/tools/identity.js";
import { makeCtx, PAYER } from "./helpers.js";

afterEach(() => configurePayToken(84532, undefined));

async function toolNames(ctx: ReturnType<typeof makeCtx>) {
  const server = createServer(ctx.ctx);
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "1.0.0" });
  await Promise.all([server.connect(a), client.connect(b)]);
  const { tools } = await client.listTools();
  return tools;
}

describe("testnet config", () => {
  it("pays in the mock USDC and sponsors spends through the API's /paymaster by default", () => {
    const { config } = loadConfig({ API_URL: "https://api.example/" });
    expect(config.paymasterUrl).toBe("https://api.example/paymaster");
    expect(getChainConfig(84532).usdc).toBe(MOCK_USDC_BASE_SEPOLIA);
    expect(loadConfig({ PAYMASTER_URL: "https://pm.example" }).config.paymasterUrl).toBe("https://pm.example");
  });

  it("PAY_TOKEN overrides the testnet token; junk is a config error", () => {
    loadConfig({ PAY_TOKEN: "0x1111111111111111111111111111111111111111" });
    expect(getChainConfig(84532).usdc).toBe("0x1111111111111111111111111111111111111111");
    expect(() => loadConfig({ PAY_TOKEN: "nope" })).toThrow(ConfigError);
  });
});

describe("get_test_funds", () => {
  it("is listed on Base Sepolia only; spend says gas is sponsored there", async () => {
    const tools = await toolNames(makeCtx());
    expect(tools.map((t) => t.name)).toContain("get_test_funds");
    expect(tools.find((t) => t.name === "spend")!.description).toMatch(/Gas is sponsored on this testnet/);
    const main = await toolNames(makeCtx({ env: { CHAIN_ID: "8453" } }));
    expect(main.map((t) => t.name)).not.toContain("get_test_funds");
    expect(main.find((t) => t.name === "spend")!.description).toMatch(/Gas is paid in USDC/);
  });

  it("asks the API for the payer's drop and reports it with an explorer link", async () => {
    const t = makeCtx();
    const r = await getTestFunds(t.ctx);
    expect(t.api.faucet).toHaveBeenCalledWith(PAYER);
    expect(r).toMatchObject({ status: "sent", payer: PAYER, usdc: "1000000", tx: expect.stringMatching(/^https:\/\/sepolia\.basescan\.org\/tx\/0x/) });
  });

  it("says when the payer already claimed, and maps a disabled faucet", async () => {
    const t = makeCtx();
    t.api.faucet.mockResolvedValueOnce({ status: "already_claimed", address: PAYER });
    expect(await getTestFunds(t.ctx)).toMatchObject({ status: "already_claimed" });
    t.api.faucet.mockRejectedValueOnce(new ApiError(503, "faucet_disabled", "off"));
    await expect(getTestFunds(t.ctx)).rejects.toMatchObject({ code: "faucet_disabled" });
  });

  it("needs a payer and the testnet", async () => {
    await expect(getTestFunds(makeCtx({ payer: false }).ctx)).rejects.toMatchObject({ code: "no_payer" });
    await expect(getTestFunds(makeCtx({ env: { CHAIN_ID: "8453" } }).ctx)).rejects.toMatchObject({ code: "not_testnet" });
  });

  it("whoami points an empty testnet payer at get_test_funds", async () => {
    const t = makeCtx();
    t.chain.usdcBalance.mockResolvedValue(0n);
    expect((await whoami(t.ctx)).note).toMatch(/get_test_funds/);
  });
});
