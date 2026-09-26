// pnpm demo:agent-live, offline: redaction, the MCP → Messages API tool bridge, the agent loop
// against a mocked Anthropic client and a mocked MCP client, and the `claude -p` stream adapter.
import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import {
  ClaudeStreamAdapter,
  bridgeTools,
  claudeCliArgs,
  formatCall,
  MODEL,
  Redactor,
  runAgent,
  safeUrl,
  summarizeResult,
  taskFor,
  toAnthropicTool,
  TOOLSETS,
  type LlmLike,
  type McpLike,
  type McpTool,
  type Render,
  type ToolOutcome,
} from "../demo/agent-live-core.js";

const CODE = `0x${"ab".repeat(32)}`;
const LINK = `https://soapay.up.railway.app/app/#/join?code=${CODE}&label=billing-test&org=Meridian%20Labs`;
const MNEMONIC = "test test test test test test test test test test test junk";

// ---------------------------------------------------------------------------------------------
// Mocks

const MCP_TOOLS: McpTool[] = [
  { name: "whoami", description: "Who am I", inputSchema: { type: "object", properties: {}, $schema: "http://json-schema.org/draft-07/schema#" } },
  {
    name: "create_agent_identity",
    description: "Register and claim a name",
    inputSchema: { type: "object", properties: { invite: { type: "string" }, label: { type: "string" } }, additionalProperties: false },
  },
  { name: "resolve_name", description: "Resolve", inputSchema: { type: "object", properties: { name: { type: "string" } }, required: ["name"] } },
  { name: "pay", description: "Pay names", inputSchema: { type: "object", properties: {} } },
  { name: "scan", inputSchema: { type: "object", properties: {} } },
  { name: "balance", description: "Balance", inputSchema: { type: "object", properties: {} } },
  { name: "spend", description: "Spend", inputSchema: { type: "object", properties: { to: { type: "string" }, amount: { type: "string" }, confirm: { type: "string" } } } },
];

function mockMcp(replies: Record<string, (args: Record<string, unknown>) => unknown>) {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const mcp: McpLike = {
    listTools: async () => ({ tools: MCP_TOOLS }),
    callTool: async (name, args) => {
      calls.push({ name, args });
      const body = replies[name]?.(args) ?? { error: { code: "unexpected", message: name } };
      return { content: [{ type: "text", text: JSON.stringify(body) }], isError: "error" in (body as object) };
    },
  };
  return { mcp, calls };
}

type Block = { type: "text"; text: string } | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> };

/** A scripted Anthropic client: one reply per turn, streamed as text deltas, then finalMessage(). */
function mockLlm(turns: { content: Block[]; stop: Anthropic.StopReason }[]) {
  const requests: Anthropic.MessageStreamParams[] = [];
  let i = 0;
  const llm: LlmLike = {
    messages: {
      stream(params) {
        // Snapshot: the loop keeps appending to the same array.
        requests.push({ ...params, messages: params.messages.map((m) => ({ ...m })) });
        const turn = turns[i++];
        if (!turn) throw new Error("no more scripted turns");
        const events: Anthropic.MessageStreamEvent[] = turn.content.flatMap((b, index) =>
          b.type === "text" ? [{ type: "content_block_delta", index, delta: { type: "text_delta", text: b.text } } as Anthropic.MessageStreamEvent] : [],
        );
        const message = {
          id: `msg_${i}`,
          type: "message",
          role: "assistant",
          model: params.model,
          content: turn.content.map((b) => (b.type === "text" ? { type: "text", text: b.text, citations: null } : { ...b, caller: { type: "direct" } })),
          stop_reason: turn.stop,
          stop_sequence: null,
          usage: { input_tokens: 1, output_tokens: 1 },
        } as unknown as Anthropic.Message;
        return {
          async *[Symbol.asyncIterator]() {
            yield* events;
          },
          finalMessage: async () => message,
        };
      },
    },
  };
  return { llm, requests };
}

function recorder() {
  const log: string[] = [];
  const ends: ToolOutcome[] = [];
  const render: Render = {
    thinking: () => undefined,
    text: (d) => log.push(`text:${d}`),
    reasoning: (d) => log.push(`reason:${d}`),
    toolStart: (name, input) => log.push(`start:${name}:${JSON.stringify(input)}`),
    toolEnd: (o) => (ends.push(o), log.push(`end:${o.name}:${o.isError ? "err" : "ok"}`)),
    note: (s) => log.push(`note:${s}`),
    info: (s) => log.push(`info:${s}`),
  };
  return { render, log, ends };
}

// ---------------------------------------------------------------------------------------------

describe("redaction", () => {
  it("removes registered secrets and any invite code inside a link", () => {
    const r = new Redactor();
    r.add(MNEMONIC, "0xdeadbeefdeadbeef", undefined, "short");
    expect(r.redact(`phrase ${MNEMONIC} key 0xdeadbeefdeadbeef`)).toBe("phrase [redacted] key [redacted]");
    expect(r.redact(LINK)).not.toContain("ab".repeat(32));
    expect(r.redact(LINK)).toContain("code=[redacted]&label=billing-test");
    expect(r.redact("short stays")).toBe("short stays"); // too short to be a secret
  });

  it("formats a tool call without the invite and with long values cut", () => {
    const r = new Redactor();
    const s = formatCall("create_agent_identity", { invite: LINK, description: "x".repeat(100), capabilities: ["billing", "pay"] }, r);
    expect(s).toContain("invite: <invite link>");
    expect(s).not.toContain(CODE.slice(2));
    expect(s).toMatch(/description: "x+…/);
    expect(s).toContain('capabilities: ["billing","pay"]');
  });

  it("shows paid RPC URLs host-only", () => {
    expect(safeUrl("https://base-sepolia.core.chainstack.com/abcdef0123456789")).toBe("https://base-sepolia.core.chainstack.com/…");
    expect(safeUrl("https://soapay.up.railway.app")).toBe("https://soapay.up.railway.app");
    expect(safeUrl("not a url")).toBe("[url]");
  });

  it("puts the invite in the model's task but never in the task shown on screen", () => {
    const t = taskFor({ kind: "join", invite: LINK });
    expect(t.prompt).toContain(LINK);
    expect(t.shown).not.toContain(CODE);
    expect(t.shown).toContain("You are the billing agent for Meridian Labs. Join payroll with this invite and set up your Soapay identity.");
    expect(taskFor({ kind: "spend", amount: "0.5", name: "alex-demo" }).prompt).toBe(
      "Check what you've been paid, then pay 0.5 USDC to alex-demo.soapay.eth. Confirm the plan yourself.",
    );
  });
});

describe("tool bridge", () => {
  it("maps an MCP tool onto a Messages API tool (name, description, JSON Schema minus $schema)", () => {
    const t = toAnthropicTool(MCP_TOOLS[0]!);
    expect(t).toEqual({ name: "whoami", description: "Who am I", input_schema: { type: "object", properties: {} } });
    expect(toAnthropicTool(MCP_TOOLS[4]!).description).toBe("scan"); // no description: falls back to the name
  });

  it("exposes only the task's toolset, in toolset order; pay and swaps never reach the model", async () => {
    const { mcp } = mockMcp({});
    const join = await bridgeTools(mcp, TOOLSETS.join);
    expect(join.map((t) => t.name)).toEqual(["whoami", "create_agent_identity", "resolve_name"]);
    expect(join[1]!.input_schema).toMatchObject({ additionalProperties: false, properties: { invite: { type: "string" } } });
    const spend = await bridgeTools(mcp, TOOLSETS.spend);
    expect(spend.map((t) => t.name)).toEqual(["whoami", "scan", "balance", "resolve_name", "spend"]);
    expect([...join, ...spend].some((t) => t.name === "pay" || t.name === "swap_in_place")).toBe(false);
  });
});

describe("agent loop (mocked Anthropic + MCP)", () => {
  it("runs the model's tool calls on the MCP server and feeds results back until end_turn", async () => {
    const { mcp, calls } = mockMcp({
      scan: () => ({ payments: [{ stealthAddress: "0xAAA", balanceUsdc: "1.5" }] }),
      spend: (a) =>
        a.confirm
          ? { ok: true, to: "alex-demo.soapay.eth", amountUsdc: "0.5", results: [{ from: "0xAAA", status: "sent", txHash: "0x01" }] }
          : { decision: "allow", reason: "single source", planId: "plan-1", parts: [{}], maxFeesUsdc: "0" },
    });
    const { llm, requests } = mockLlm([
      { content: [{ type: "text", text: "Scanning." }, { type: "tool_use", id: "t1", name: "scan", input: {} }], stop: "tool_use" },
      { content: [{ type: "tool_use", id: "t2", name: "spend", input: { to: "alex-demo.soapay.eth", amount: "0.5" } }], stop: "tool_use" },
      { content: [{ type: "tool_use", id: "t3", name: "spend", input: { confirm: "plan-1" } }], stop: "tool_use" },
      { content: [{ type: "text", text: "Paid 0.5 USDC to alex-demo.soapay.eth." }], stop: "end_turn" },
    ]);
    const { render, log, ends } = recorder();
    const tools = await bridgeTools(mcp, TOOLSETS.spend);
    const r = await runAgent({ llm, mcp, tools, task: "task", render, redactor: new Redactor() });

    expect(calls.map((c) => c.name)).toEqual(["scan", "spend", "spend"]);
    expect(calls[2]!.args).toEqual({ confirm: "plan-1" });
    expect(r).toMatchObject({ turns: 4, stopReason: "end_turn", capped: false, finalText: "Paid 0.5 USDC to alex-demo.soapay.eth." });
    expect(log).toContain("text:Scanning.");
    expect(log.filter((l) => l.startsWith("end:"))).toEqual(["end:scan:ok", "end:spend:ok", "end:spend:ok"]);
    expect(ends[2]!.body.results[0].txHash).toBe("0x01");

    // Request shape: Sonnet 5, low max_tokens, brief system prompt, tools, and the tool_result round trip.
    const first = requests[0]!;
    expect(first.model).toBe(MODEL);
    expect(first.model).toBe("claude-sonnet-5");
    expect(first.max_tokens).toBeLessThanOrEqual(4096);
    expect(String(first.system)).toMatch(/never ask the user questions/);
    expect(first.tools!.map((t) => (t as Anthropic.Tool).name)).toContain("spend");
    const second = requests[1]!;
    expect(second.messages).toHaveLength(3);
    expect(second.messages[1]!.role).toBe("assistant");
    const results = second.messages[2]!.content as Anthropic.ToolResultBlockParam[];
    expect(results).toEqual([{ type: "tool_result", tool_use_id: "t1", content: JSON.stringify({ payments: [{ stealthAddress: "0xAAA", balanceUsdc: "1.5" }] }) }]);
  });

  it("returns tool errors to the model as is_error and refuses tools outside the toolset", async () => {
    const { mcp, calls } = mockMcp({});
    const { llm, requests } = mockLlm([
      { content: [{ type: "tool_use", id: "a", name: "pay", input: { payments: [] } }, { type: "tool_use", id: "b", name: "whoami", input: {} }], stop: "tool_use" },
      { content: [{ type: "text", text: "Stopping." }], stop: "end_turn" },
    ]);
    const { render, log } = recorder();
    const tools = await bridgeTools(mcp, TOOLSETS.join);
    await runAgent({ llm, mcp, tools, task: "task", render, redactor: new Redactor() });
    expect(calls.map((c) => c.name)).toEqual(["whoami"]); // `pay` never reached the server
    const results = requests[1]!.messages[2]!.content as Anthropic.ToolResultBlockParam[];
    expect(results).toHaveLength(2); // both results in one user message
    expect(results.every((x) => x.is_error)).toBe(true);
    expect(String(results[0]!.content)).toContain("unknown_tool");
    expect(log).toContain("end:pay:err");
  });

  it("stops at the turn cap", async () => {
    const { mcp } = mockMcp({ whoami: () => ({ name: null }) });
    const loop = { content: [{ type: "tool_use", id: "x", name: "whoami", input: {} }] as Block[], stop: "tool_use" as const };
    const { llm } = mockLlm([loop, loop, loop]);
    const { render, log } = recorder();
    const r = await runAgent({ llm, mcp, tools: await bridgeTools(mcp, TOOLSETS.join), task: "t", render, redactor: new Redactor(), maxTurns: 2 });
    expect(r.capped).toBe(true);
    expect(log.at(-1)).toBe("note:stopped after 2 turns (turn cap)");
  });

  it("redacts secrets the model or a tool echoes before they are rendered", async () => {
    const red = new Redactor();
    red.add(CODE, CODE.slice(2));
    const { mcp } = mockMcp({ create_agent_identity: () => ({ error: { code: "invite_claimed", message: `invite ${CODE} was used` } }) });
    const { llm } = mockLlm([
      { content: [{ type: "text", text: `Joining with ${CODE}.` }, { type: "tool_use", id: "c", name: "create_agent_identity", input: { invite: LINK } }], stop: "tool_use" },
      { content: [{ type: "text", text: "Done." }], stop: "end_turn" },
    ]);
    const { render, log, ends } = recorder();
    const r = await runAgent({ llm, mcp, tools: await bridgeTools(mcp, TOOLSETS.join), task: "t", render, redactor: red });
    // The raw tool input goes to the renderer, which prints it through formatCall (tested above).
    expect(log.filter((l) => !l.startsWith("start:")).join("\n")).not.toContain("ab".repeat(32));
    expect(log).toContain("text:Joining with [redacted].");
    expect(r.finalText).toBe("Done.");
    expect(JSON.stringify(ends[0]!.body)).not.toContain("ab".repeat(32));
    expect(ends[0]!.body.error.message).toBe("invite [redacted] was used");
  });
});

describe("result summaries", () => {
  it("create_agent_identity: name, org, both tx links and the ENSIP-26 records", () => {
    const { lines, links } = summarizeResult(
      "create_agent_identity",
      {
        name: "billing-test.soapay.eth",
        created: true,
        invite: { org: "Meridian Labs" },
        registration: { txHash: "0xreg" },
        txHash: "0xens",
        records: { "agent-context": JSON.stringify({ description: "Bills clients", capabilities: ["billing", "pay"] }) },
      },
      false,
    );
    expect(lines[0]).toBe("billing-test.soapay.eth claimed now · joined Meridian Labs");
    expect(lines).toContain("registration https://sepolia.basescan.org/tx/0xreg");
    expect(lines).toContain("ENS name tx https://sepolia.etherscan.io/tx/0xens");
    expect(lines).toContain('agent-context "Bills clients" [billing, pay]');
    expect(links).toContain("https://sepolia.app.ens.domains/billing-test.soapay.eth");
  });

  it("spend: the plan's guard decision, then the confirm's tx links; errors show their code", () => {
    expect(summarizeResult("spend", { decision: "warn", reason: "merges clusters", planId: "p", parts: [{}, {}], maxFeesUsdc: "0" }, false).lines).toEqual([
      "plan: guard warn · merges clusters",
      "2 parts · gas sponsored · waiting for confirm",
    ]);
    const done = summarizeResult("spend", { ok: true, to: "a.soapay.eth", amountUsdc: "0.5", results: [{ status: "sent", txHash: "0xabc" }] }, false);
    expect(done.links).toEqual(["https://sepolia.basescan.org/tx/0xabc"]);
    expect(summarizeResult("spend", { error: { code: "cap_exceeded", message: "over" } }, true).lines).toEqual(["error cap_exceeded: over"]);
    expect(summarizeResult("scan", { payments: [{ balanceUsdc: "1" }, { balanceUsdc: "0" }, { balanceUsdc: "0.25" }] }, false).lines[0]).toBe(
      "3 payments found · 1.25 USDC unspent",
    );
  });
});

describe("claude CLI fallback", () => {
  it("builds a headless, isolated invocation: Sonnet 5, only the task's Soapay tools", () => {
    const a = claudeCliArgs({ mcpConfigPath: "/tmp/x/mcp.json", tools: TOOLSETS.join });
    const val = (flag: string) => a[a.indexOf(flag) + 1];
    expect(a[0]).toBe("-p");
    expect(val("--model")).toBe("claude-sonnet-5");
    expect(val("--allowedTools")).toBe("mcp__soapay__whoami,mcp__soapay__create_agent_identity,mcp__soapay__resolve_name");
    expect(val("--tools")).toBe("");
    expect(val("--output-format")).toBe("stream-json");
    expect(val("--max-turns")).toBe("12");
    expect(a).toContain("--strict-mcp-config");
    expect(val("--disallowedTools")!.split(",")).toEqual([
      "mcp__soapay__pay", "mcp__soapay__scan", "mcp__soapay__balance", "mcp__soapay__spend", "mcp__soapay__swap_in_place", "mcp__soapay__get_test_funds",
    ]);
    const spend = claudeCliArgs({ mcpConfigPath: "/x", tools: TOOLSETS.spend });
    expect(spend[spend.indexOf("--disallowedTools") + 1]).toContain("mcp__soapay__create_agent_identity");
  });

  it("maps stream-json lines onto the same render hooks, with prefixes stripped and secrets redacted", () => {
    const red = new Redactor();
    red.add(CODE);
    const { render, log, ends } = recorder();
    const ad = new ClaudeStreamAdapter(render, red);
    const lines = [
      { type: "system", subtype: "init", model: "claude-sonnet-5", tools: ["mcp__soapay__whoami", "mcp__soapay__create_agent_identity", "Task"] },
      { type: "stream_event", event: { type: "message_start" } },
      { type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: "Joining payroll." } } },
      { type: "stream_event", event: { type: "message_stop" } },
      { type: "assistant", message: { content: [{ type: "text", text: "Joining payroll." }, { type: "tool_use", id: "u1", name: "mcp__soapay__create_agent_identity", input: { invite: LINK } }] } },
      { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "u1", content: [{ type: "text", text: JSON.stringify({ name: "billing-test.soapay.eth", created: true, txHash: "0xens" }) }] }] } },
      { type: "stream_event", event: { type: "message_start" } },
      { type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: `Joined; code ${CODE} used.` } } },
      { type: "stream_event", event: { type: "message_stop" } },
      { type: "result", is_error: false, result: `Joined; code ${CODE} used.`, num_turns: 2, total_cost_usd: 0.01 },
    ];
    for (const l of lines) ad.line(JSON.stringify(l));
    ad.line("not json");
    expect(ad.init).toEqual({ model: "claude-sonnet-5", tools: ["whoami", "create_agent_identity"] });
    expect(log[0]).toBe("info:claude CLI session: model claude-sonnet-5 · Soapay tools whoami, create_agent_identity");
    expect(log[1]).toBe("text:Joining payroll.");
    expect(log.filter((l) => l === "text:Joining payroll.")).toHaveLength(1); // not repeated from the assistant message
    expect(log[2]).toMatch(/^start:create_agent_identity:/);
    expect(log[3]).toBe("end:create_agent_identity:ok");
    expect(ends[0]!.body.name).toBe("billing-test.soapay.eth");
    expect(ad.turns).toBe(2);
    expect(ad.finalText).toBe("Joined; code [redacted] used.");
    expect(ad.result).toMatchObject({ isError: false, numTurns: 2, costUsd: 0.01 });
    expect(log.filter((l) => !l.startsWith("start:")).join("\n")).not.toContain("ab".repeat(32));
  });

  it("falls back to whole assistant text when partial messages are absent", () => {
    const { render, log } = recorder();
    const ad = new ClaudeStreamAdapter(render, new Redactor());
    ad.line(JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "Hello." }] } }));
    expect(log).toEqual(["text:Hello."]);
    expect(ad.finalText).toBe("Hello.");
  });
});
