import { describe, expect, it, vi } from "vitest";
import { nameClaimTypedData } from "@soapay/sdk";
import { ensV2NameIssuer } from "../src/issuer.js";
import { j, makeTestApp, metaHex, metaUri, NOW, registrant } from "./helpers.js";

const AGENT = {
  context: "Payroll agent for Acme. Pays names in USDC on Base.",
  endpoints: { mcp: "https://mcp.acme.example" },
};

async function claim(label = "ledger-bot", deadline = BigInt(NOW + 600)) {
  const msg = { label, registrant: registrant.address, metaAddress: metaUri(), deadline };
  const signature = await registrant.signTypedData(nameClaimTypedData({ ...msg, chainId: 84532 }));
  return { ...msg, deadline: deadline.toString(), signature };
}

function setup() {
  const issue = vi.fn(async (_a: any) => ({ txHash: "0xissued" }));
  const t = makeTestApp({ nameIssuer: { issue } });
  t.client.readContract.mockImplementation(async (a: any) => (a.args[0] === registrant.address ? metaHex() : "0x"));
  return { t, issue };
}

describe("POST /names with agent records (ENSIP-25/26)", () => {
  it("passes validated agent metadata to the issuer on a new name", async () => {
    const { t, issue } = setup();
    const res = await t.post("/names", { ...(await claim()), agent: AGENT });
    expect(res.status).toBe(201);
    expect(issue).toHaveBeenCalledWith({ label: "ledger-bot", registrant: registrant.address, metaAddress: metaUri(), agent: AGENT });
  });

  it("stays backward compatible: no agent field, no agent argument", async () => {
    const { t, issue } = setup();
    expect((await t.post("/names", { ...(await claim()), agent: null })).status).toBe(201);
    expect(issue.mock.calls[0]![0]).not.toHaveProperty("agent");
  });

  it.each([
    ["empty context", { context: "" }],
    ["bad endpoint", { context: "x", endpoints: { mcp: "ftp://x" } }],
    ["reserved/unknown field", { context: "x", stealth: "st:eth:0x00" }],
    ["not an object", "bot"],
  ])("rejects %s with 400 invalid_agent and issues nothing", async (_, agent) => {
    const { t, issue } = setup();
    const res = await t.post("/names", { ...(await claim()), agent });
    expect(res.status).toBe(400);
    expect((await j(res)).error.code).toBe("invalid_agent");
    expect(issue).not.toHaveBeenCalled();
  });

  it("refuses agent records on an update of an existing name", async () => {
    const { t } = setup();
    expect((await t.post("/names", await claim())).status).toBe(201);
    const res = await t.post("/names", { ...(await claim("ledger-bot", BigInt(NOW + 900))), agent: AGENT });
    expect(res.status).toBe(400);
    expect((await j(res)).error.code).toBe("agent_immutable");
  });

  it("ensV2NameIssuer forwards agent metadata to the SDK issuer", async () => {
    const inner = { issue: vi.fn(async (_a: any) => ({ txHash: "0x01", name: "", resolver: "0x", registry: "0x" })) };
    await ensV2NameIssuer(inner as any).issue({ label: "a-bot", registrant: registrant.address, metaAddress: metaUri(), agent: AGENT });
    expect(inner.issue).toHaveBeenCalledWith({ label: "a-bot", registrant: registrant.address, metaAddress: metaUri(), agent: AGENT });
    await ensV2NameIssuer(inner as any).issue({ label: "b-bot", registrant: registrant.address, metaAddress: metaUri() });
    expect(inner.issue.mock.calls[1]![0]).not.toHaveProperty("agent");
  });
});
