import { describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../src/server.js";
import { agentKeys, makeCtx, PAYER } from "./helpers.js";

async function connect(ctx = makeCtx()) {
  const server = createServer(ctx.ctx);
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "1.0.0" });
  await Promise.all([server.connect(a), client.connect(b)]);
  return { client, ...ctx };
}

const body = (r: any) => JSON.parse(r.content[0].text);

describe("MCP server (in-memory client)", () => {
  it("lists every tool with an input schema", async () => {
    const { client } = await connect();
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(
      ["balance", "create_agent_identity", "get_test_funds", "pay", "resolve_name", "scan", "spend", "swap_in_place", "whoami"].sort(),
    );
    const pay = tools.find((t) => t.name === "pay")!;
    expect(Object.keys(pay.inputSchema.properties ?? {})).toEqual(["payments", "dry_run", "confirm"]);
    expect(pay.annotations?.destructiveHint).toBe(true);
    expect(tools.find((t) => t.name === "whoami")!.annotations?.readOnlyHint).toBe(true);
  });

  it("tells the model it can join an employer's payroll with an invite link", async () => {
    const { client } = await connect();
    const { tools } = await client.listTools();
    const create = tools.find((t) => t.name === "create_agent_identity")!;
    expect(create.description).toMatch(/invite link/);
    expect(Object.keys(create.inputSchema.properties ?? {})).toEqual(expect.arrayContaining(["label", "invite"]));
    expect(create.inputSchema.required ?? []).not.toContain("label");
    expect(client.getInstructions()).toMatch(/invite/);
  });

  it("calls whoami", async () => {
    const { client } = await connect();
    const r: any = await client.callTool({ name: "whoami", arguments: {} });
    expect(r.isError).toBeFalsy();
    expect(r.structuredContent).toMatchObject({ metaAddress: agentKeys.metaAddressURI, payer: { address: PAYER } });
  });

  it("pays in dry run by default and sends nothing", async () => {
    const { client, chain } = await connect();
    const r: any = await client.callTool({
      name: "pay",
      arguments: { payments: [{ name: "alice.soapay.eth", amount: "2" }, { name: "bob.soapay.eth", amount: "1" }] },
    });
    expect(r.isError).toBeFalsy();
    const plan = body(r);
    expect(plan).toMatchObject({ totalUsdc: "3", lineCount: 2 });
    expect(plan.planId).toMatch(/^pay_[0-9a-f]{24}$/);
    expect(chain.sendTransaction).not.toHaveBeenCalled();

    const done: any = await client.callTool({ name: "pay", arguments: { confirm: plan.planId } });
    expect(body(done).ok).toBe(true);
    const again: any = await client.callTool({ name: "pay", arguments: { confirm: plan.planId } });
    expect(again.isError).toBe(true);
    expect(body(again).error.code).toBe("plan_used");
  });

  it("rejects bad inputs with zod before any tool code runs", async () => {
    const { client, chain } = await connect();
    for (const args of [
      { payments: [{ name: "alice.soapay.eth", amount: "1.1234567" }] },
      { payments: [{ name: "alice.soapay.eth", amount: -1 }] },
      { payments: [] },
      { confirm: "not-a-plan" },
    ]) {
      const r: any = await client.callTool({ name: "pay", arguments: args });
      expect(r.isError).toBe(true);
      expect(r.content[0].text).toMatch(/validation|Invalid/i);
    }
    const bad: any = await client.callTool({ name: "create_agent_identity", arguments: { label: "Bad Label!" } });
    expect(bad.isError).toBe(true);
    expect(chain.resolveName).not.toHaveBeenCalled();
  });

  it("returns tool errors as structured JSON with a code", async () => {
    const { client } = await connect(makeCtx({ env: { PAYEE_ALLOWLIST: "alice.soapay.eth" } }));
    const r: any = await client.callTool({ name: "pay", arguments: { payments: [{ name: "bob.soapay.eth", amount: "1" }] } });
    expect(r.isError).toBe(true);
    expect(body(r).error.code).toBe("not_allowlisted");
  });
});
