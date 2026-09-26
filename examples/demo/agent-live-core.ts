// The testable half of `pnpm demo:agent-live` (agent-live.ts): redaction, the MCP → Messages API
// tool bridge, the agent loop, tool-result summaries, and the `claude -p` stream-json adapter.
// No top-level side effects and no @soapay/sdk import, so vitest can load it with mocks.
import type Anthropic from "@anthropic-ai/sdk";

export const MODEL = "claude-sonnet-5";
export const MODEL_LABEL = "Claude Sonnet 5";
export const BASESCAN = "https://sepolia.basescan.org";
export const ETHERSCAN = "https://sepolia.etherscan.io";
export const PARENT_NAME = "soapay.eth";
export const MAX_TURNS = 12;

// ---------------------------------------------------------------------------------------------
// Redaction

/** Strips secrets from anything we print. Invite codes are also caught by shape inside links. */
export class Redactor {
  private readonly secrets: string[] = [];
  add(...values: (string | undefined)[]): void {
    for (const v of values) if (v && v.length >= 8 && !this.secrets.includes(v)) this.secrets.push(v);
    // Longest first, so a secret that contains another is removed whole.
    this.secrets.sort((a, b) => b.length - a.length);
  }
  redact(s: string): string {
    let out = s;
    for (const x of this.secrets) out = out.split(x).join("[redacted]");
    // An invite link's code (`code=0x…`) is a bearer secret even if we were never told about it.
    return out.replace(/([?&#]code=)(0x)?[0-9a-fA-F]{64}/g, "$1[redacted]");
  }
}

/** The invite code inside a link (or a bare code), so the redactor can remove it everywhere. */
export function inviteCode(invite: string): string | undefined {
  return invite.match(/0x[0-9a-fA-F]{64}/)?.[0];
}

/** A URL with its path and query cut (paid RPC URLs carry the key in the path). */
export function safeUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host}${u.pathname.length > 1 || u.search ? "/…" : ""}`;
  } catch {
    return "[url]";
  }
}

// ---------------------------------------------------------------------------------------------
// Tasks

export type Command = { kind: "join"; invite: string } | { kind: "spend"; amount: string; name: string };

export const fullName = (n: string) => (n.includes(".") ? n.toLowerCase() : `${n.toLowerCase()}.${PARENT_NAME}`);

/** The tools each task may see. The model can't reach `pay` (the payer wallet) or swaps. */
export const TOOLSETS: Record<Command["kind"], string[]> = {
  join: ["whoami", "create_agent_identity", "resolve_name"],
  spend: ["whoami", "scan", "balance", "resolve_name", "spend"],
};

/** Every tool the Soapay MCP server can list; the CLI backend denies the ones outside the task's toolset. */
export const ALL_SOAPAY_TOOLS = ["whoami", "resolve_name", "create_agent_identity", "pay", "scan", "balance", "spend", "swap_in_place", "get_test_funds"];

export const SYSTEM_PROMPT = [
  "You are an autonomous AI agent with a Soapay identity: tools from the Soapay MCP server let you get paid privately",
  "(stealth addresses on Base Sepolia, a name under soapay.eth on ENSv2 Sepolia) and spend what you received.",
  "Work on your own: never ask the user questions, pick sensible values yourself, and call the tools to do the job.",
  "Before each tool call, say in one short sentence what you are about to do. Keep every message brief.",
  "Value moves take two calls: the first returns a plan with a planId; review the guard's decision yourself and, if it is",
  "allow or warn, confirm it by calling the same tool with { confirm: planId }. A block cannot be overridden: stop and say so.",
  "Never repeat an invite code, key or recovery phrase in your messages.",
  "When the job is done, finish with one short line that says what happened.",
].join(" ");

/** The natural-language task handed to the model, and the version shown on screen. */
export function taskFor(cmd: Command): { prompt: string; shown: string } {
  if (cmd.kind === "join") {
    const intro = "You are the billing agent for Meridian Labs. Join payroll with this invite and set up your Soapay identity.";
    return { prompt: `${intro}\n\nInvite link: ${cmd.invite}`, shown: `${intro}\n\nInvite link: [hidden]` };
  }
  const text = `Check what you've been paid, then pay ${cmd.amount} USDC to ${fullName(cmd.name)}. Confirm the plan yourself.`;
  return { prompt: text, shown: text };
}

// ---------------------------------------------------------------------------------------------
// MCP bridge

export type McpTool = { name: string; description?: string | undefined; inputSchema: { type: "object"; [k: string]: unknown } };
export type McpResult = { content?: unknown; isError?: boolean | undefined };
/** The slice of the MCP client the agent needs (the real one is adapted in agent-live.ts). */
export interface McpLike {
  listTools(): Promise<{ tools: McpTool[] }>;
  callTool(name: string, args: Record<string, unknown>): Promise<McpResult>;
}

/** An MCP tool as a Messages API tool definition: same name, description and JSON Schema. */
export function toAnthropicTool(t: McpTool): Anthropic.Tool {
  const { $schema: _drop, ...schema } = t.inputSchema as Record<string, unknown>;
  return {
    name: t.name,
    description: t.description ?? t.name,
    input_schema: { ...schema, type: "object" } as Anthropic.Tool.InputSchema,
  };
}

/** The server's tools, filtered to the task's toolset, in the toolset's order (stable for caching). */
export async function bridgeTools(mcp: McpLike, allow: string[]): Promise<Anthropic.Tool[]> {
  const { tools } = await mcp.listTools();
  const byName = new Map(tools.map((t) => [t.name, t]));
  return allow.flatMap((n) => {
    const t = byName.get(n);
    return t ? [toAnthropicTool(t)] : [];
  });
}

/** The text of an MCP tool result (the Soapay server replies with one JSON text block). */
export function resultText(r: McpResult): string {
  const content = Array.isArray(r.content) ? r.content : [];
  return content
    .map((c: any) => (c && typeof c === "object" && typeof c.text === "string" ? c.text : ""))
    .filter(Boolean)
    .join("\n");
}

export function parseBody(text: string): any {
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

// ---------------------------------------------------------------------------------------------
// Rendering hooks (the terminal renderer lives in agent-live.ts)

export type ToolOutcome = { name: string; input: Record<string, unknown>; isError: boolean; body: any; ms: number };
export interface Render {
  /** Waiting for the model (before its first token on a turn). */
  thinking(on: boolean): void;
  text(delta: string): void;
  reasoning(delta: string): void;
  toolStart(name: string, input: Record<string, unknown>): void;
  toolEnd(outcome: ToolOutcome): void;
  note(s: string): void;
  info(s: string): void;
}

/** `name(key: value, …)` with long values cut and secrets removed. */
export function formatCall(name: string, input: Record<string, unknown>, r: Redactor): string {
  const parts = Object.entries(input).map(([key, v]) => {
    let s = key === "invite" ? "<invite link>" : typeof v === "string" ? JSON.stringify(v) : JSON.stringify(v);
    s = r.redact(s ?? "");
    if (s.length > 60) s = `${s.slice(0, 57)}…`;
    return `${key}: ${s}`;
  });
  return `${name}(${parts.join(", ")})`;
}

const tx = (base: string, hash?: string) => (hash ? `${base}/tx/${hash}` : undefined);

/** A few human lines about a tool result, plus the links worth keeping for the final summary. */
export function summarizeResult(name: string, body: any, isError: boolean): { lines: string[]; links: string[] } {
  const lines: string[] = [];
  const links: string[] = [];
  const link = (label: string, url?: string) => {
    if (!url) return;
    links.push(url);
    lines.push(`${label} ${url}`);
  };
  if (isError) {
    const e = body?.error ?? {};
    lines.push(`error ${e.code ?? "error"}: ${e.message ?? body?.raw ?? "failed"}`);
    return { lines, links };
  }
  switch (name) {
    case "whoami":
      lines.push(`name ${body.name ?? "(none yet)"}`);
      if (body.payer) lines.push(`payer ${body.payer.usdc} USDC`);
      if (body.guardrails) lines.push(`caps ${body.guardrails.maxPerCallUsdc}/call · ${body.guardrails.remainingTodayUsdc} left today`);
      break;
    case "create_agent_identity": {
      lines.push(`${body.name} ${body.created ? "claimed now" : "(already this agent's name)"}${body.invite?.org ? ` · joined ${body.invite.org}` : ""}`);
      link("registration", tx(BASESCAN, body.registration?.txHash));
      link("ENS name tx", tx(ETHERSCAN, body.txHash));
      const records: Record<string, string> = body.records ?? {};
      for (const [key, value] of Object.entries(records)) {
        if (key === "agent-context") {
          try {
            const ctx = JSON.parse(value) as { description?: string; capabilities?: string[] };
            lines.push(`agent-context "${ctx.description ?? ""}" [${(ctx.capabilities ?? []).join(", ")}]`);
            continue;
          } catch {
            /* print raw below */
          }
        }
        lines.push(`${key} ${value.length > 70 ? `${value.slice(0, 70)}…` : value}`);
      }
      if (body.name) links.push(`https://sepolia.app.ens.domains/${body.name}`);
      break;
    }
    case "resolve_name":
      lines.push(`${body.name ?? ""} → ${String(body.metaAddress ?? body.metaAddressURI ?? "?").slice(0, 28)}…`);
      break;
    case "scan": {
      const payments: any[] = body.payments ?? [];
      const unspent = payments.filter((p) => Number(p.balanceUsdc) > 0);
      const total = unspent.reduce((s, p) => s + Number(p.balanceUsdc), 0);
      lines.push(`${payments.length} payment${payments.length === 1 ? "" : "s"} found · ${+total.toFixed(6)} USDC unspent`);
      for (const p of unspent.slice(0, 3)) lines.push(`+${p.balanceUsdc} USDC  ${p.stealthAddress}`);
      if (unspent.length > 3) lines.push(`… and ${unspent.length - 3} more`);
      break;
    }
    case "balance":
      lines.push(`${body.totalUsdc} USDC across ${body.addresses} stealth address${body.addresses === 1 ? "" : "es"}`);
      break;
    case "spend":
      if (body.results) {
        lines.push(body.ok ? `sent ${body.amountUsdc} USDC to ${body.to}` : `spend incomplete`);
        for (const r of body.results) {
          if (r.txHash) link(r.status, tx(BASESCAN, r.txHash));
          else lines.push(`${r.status} ${r.error ?? ""}`.trim());
        }
      } else {
        lines.push(`plan: guard ${body.decision}${body.reason ? ` · ${body.reason}` : ""}`);
        for (const w of body.warnings ?? []) lines.push(`warning ${w.code ?? ""} ${w.message ?? ""}`.trim());
        if (body.planId) {
          const gas = Number(body.maxFeesUsdc) === 0 ? "gas sponsored" : `max fees ${body.maxFeesUsdc} USDC`;
          lines.push(`${body.parts?.length ?? 0} part${body.parts?.length === 1 ? "" : "s"} · ${gas} · waiting for confirm`);
        }
      }
      break;
    default: {
      const s = JSON.stringify(body);
      lines.push(s.length > 100 ? `${s.slice(0, 100)}…` : s);
    }
  }
  return { lines, links };
}

// ---------------------------------------------------------------------------------------------
// The agent loop (Anthropic SDK backend)

/** The slice of `Anthropic` the loop uses: a streamed Messages API call. */
export interface LlmLike {
  messages: {
    stream(params: Anthropic.MessageStreamParams): AsyncIterable<Anthropic.MessageStreamEvent> & {
      finalMessage(): Promise<Anthropic.Message>;
    };
  };
}

export type RunSummary = { turns: number; toolCalls: ToolOutcome[]; finalText: string; stopReason: string; capped: boolean };

export async function runAgent(opts: {
  llm: LlmLike;
  mcp: McpLike;
  tools: Anthropic.Tool[];
  task: string;
  render: Render;
  redactor: Redactor;
  model?: string;
  maxTurns?: number;
  maxTokens?: number;
}): Promise<RunSummary> {
  const { llm, mcp, tools, render } = opts;
  const maxTurns = opts.maxTurns ?? MAX_TURNS;
  const messages: Anthropic.MessageParam[] = [{ role: "user", content: opts.task }];
  const toolCalls: ToolOutcome[] = [];
  let finalText = "";
  let stopReason = "";

  for (let turn = 1; turn <= maxTurns; turn++) {
    render.thinking(true);
    const stream = llm.messages.stream({
      model: opts.model ?? MODEL,
      max_tokens: opts.maxTokens ?? 4096,
      system: SYSTEM_PROMPT,
      thinking: { type: "adaptive", display: "summarized" },
      output_config: { effort: "low" },
      tools,
      messages,
    });
    let turnText = "";
    try {
      for await (const ev of stream) {
        if (ev.type !== "content_block_delta") continue;
        if (ev.delta.type === "text_delta") {
          render.thinking(false);
          turnText += ev.delta.text;
          render.text(opts.redactor.redact(ev.delta.text));
        } else if (ev.delta.type === "thinking_delta") {
          render.reasoning(opts.redactor.redact(ev.delta.thinking));
        }
      }
    } finally {
      render.thinking(false);
    }
    const message = await stream.finalMessage();
    stopReason = message.stop_reason ?? "";
    if (turnText.trim()) finalText = opts.redactor.redact(turnText.trim());

    if (message.stop_reason === "pause_turn") {
      messages.push({ role: "assistant", content: message.content });
      continue;
    }
    const uses = message.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
    if (message.stop_reason !== "tool_use" || !uses.length) {
      if (message.stop_reason === "refusal") render.note("the model declined this request (stop_reason: refusal)");
      if (message.stop_reason === "max_tokens") render.note("hit max_tokens");
      return { turns: turn, toolCalls, finalText, stopReason, capped: false };
    }

    messages.push({ role: "assistant", content: message.content });
    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const use of uses) {
      const input = (use.input && typeof use.input === "object" ? use.input : {}) as Record<string, unknown>;
      render.toolStart(use.name, input);
      const started = Date.now();
      let text: string;
      let isError: boolean;
      if (!tools.some((t) => t.name === use.name)) {
        text = JSON.stringify({ error: { code: "unknown_tool", message: `${use.name} is not available for this task` } });
        isError = true;
      } else {
        try {
          const r = await mcp.callTool(use.name, input);
          text = resultText(r);
          isError = !!r.isError;
        } catch (e) {
          text = JSON.stringify({ error: { code: "tool_failed", message: e instanceof Error ? e.message : String(e) } });
          isError = true;
        }
      }
      const outcome: ToolOutcome = { name: use.name, input, isError, body: parseBody(opts.redactor.redact(text)), ms: Date.now() - started };
      toolCalls.push(outcome);
      render.toolEnd(outcome);
      results.push({ type: "tool_result", tool_use_id: use.id, content: text || "(empty)", ...(isError ? { is_error: true } : {}) });
    }
    // All results of one turn go back in one user message.
    messages.push({ role: "user", content: results });
  }
  render.note(`stopped after ${maxTurns} turns (turn cap)`);
  return { turns: maxTurns, toolCalls, finalText, stopReason, capped: true };
}

// ---------------------------------------------------------------------------------------------
// `claude -p --output-format stream-json` backend: map its lines onto the same Render hooks

export const CLI_TOOL_PREFIX = "mcp__soapay__";

export class ClaudeStreamAdapter {
  private sawPartial = false;
  private readonly pending = new Map<string, { name: string; input: Record<string, unknown>; started: number }>();
  readonly toolCalls: ToolOutcome[] = [];
  turns = 0;
  finalText = "";
  /** From the CLI's `system/init` line: the model it actually runs and the Soapay tools it loaded. */
  init: { model?: string; tools: string[] } | undefined;
  result: { isError: boolean; text: string; numTurns?: number; costUsd?: number } | undefined;
  private turnText = "";

  constructor(
    private readonly render: Render,
    private readonly redactor: Redactor,
  ) {}

  /** Feed one line of stream-json. Unknown lines are ignored. */
  line(raw: string): void {
    let ev: any;
    try {
      ev = JSON.parse(raw);
    } catch {
      return;
    }
    if (ev.type === "system" && ev.subtype === "init") {
      const tools: string[] = Array.isArray(ev.tools) ? ev.tools.map(String) : [];
      this.init = {
        ...(typeof ev.model === "string" ? { model: ev.model } : {}),
        tools: tools.filter((t) => t.startsWith(CLI_TOOL_PREFIX)).map((t) => t.slice(CLI_TOOL_PREFIX.length)),
      };
      this.render.info(`claude CLI session: model ${this.init.model ?? "?"} · Soapay tools ${this.init.tools.join(", ") || "none"}`);
      return;
    }
    if (ev.type === "stream_event") {
      const e = ev.event;
      if (e?.type === "message_start") {
        this.sawPartial = true;
        this.turns++;
        this.turnText = "";
        this.render.thinking(true);
      } else if (e?.type === "content_block_delta") {
        this.sawPartial = true;
        if (e.delta?.type === "text_delta") {
          this.render.thinking(false);
          this.turnText += e.delta.text;
          this.render.text(this.redactor.redact(e.delta.text));
        } else if (e.delta?.type === "thinking_delta") this.render.reasoning(this.redactor.redact(e.delta.thinking));
      } else if (e?.type === "message_stop") {
        this.render.thinking(false);
        if (this.turnText.trim()) this.finalText = this.redactor.redact(this.turnText.trim());
      }
      return;
    }
    if (ev.type === "assistant") {
      this.render.thinking(false);
      const content: any[] = ev.message?.content ?? [];
      if (!this.sawPartial) {
        const text = content.filter((b) => b.type === "text").map((b) => b.text).join("");
        if (text.trim()) {
          this.turns++;
          this.render.text(this.redactor.redact(text));
          this.finalText = this.redactor.redact(text.trim());
        }
      }
      for (const b of content) {
        if (b.type !== "tool_use") continue;
        const name = String(b.name).startsWith(CLI_TOOL_PREFIX) ? String(b.name).slice(CLI_TOOL_PREFIX.length) : String(b.name);
        const input = (b.input && typeof b.input === "object" ? b.input : {}) as Record<string, unknown>;
        this.pending.set(b.id, { name, input, started: Date.now() });
        this.render.toolStart(name, input);
      }
      return;
    }
    if (ev.type === "user") {
      const content: any[] = Array.isArray(ev.message?.content) ? ev.message.content : [];
      for (const b of content) {
        if (b.type !== "tool_result") continue;
        const p = this.pending.get(b.tool_use_id);
        if (!p) continue;
        this.pending.delete(b.tool_use_id);
        const text = typeof b.content === "string" ? b.content : resultText({ content: b.content });
        const outcome: ToolOutcome = { name: p.name, input: p.input, isError: !!b.is_error, body: parseBody(this.redactor.redact(text)), ms: Date.now() - p.started };
        this.toolCalls.push(outcome);
        this.render.toolEnd(outcome);
      }
      return;
    }
    if (ev.type === "result") {
      this.render.thinking(false);
      this.result = {
        isError: !!ev.is_error,
        text: this.redactor.redact(String(ev.result ?? "")),
        ...(typeof ev.num_turns === "number" ? { numTurns: ev.num_turns } : {}),
        ...(typeof ev.total_cost_usd === "number" ? { costUsd: ev.total_cost_usd } : {}),
      };
      if (!this.finalText && ev.result) this.finalText = this.redactor.redact(String(ev.result)).trim();
    }
  }
}

/** `claude -p` arguments for the fallback backend (the task goes on stdin). */
export function claudeCliArgs(opts: { mcpConfigPath: string; tools: string[]; maxTurns?: number; model?: string }): string[] {
  return [
    "-p",
    "--model", opts.model ?? MODEL,
    "--mcp-config", opts.mcpConfigPath,
    "--strict-mcp-config",
    "--tools", "",
    "--allowedTools", opts.tools.map((t) => `${CLI_TOOL_PREFIX}${t}`).join(","),
    "--disallowedTools", ALL_SOAPAY_TOOLS.filter((t) => !opts.tools.includes(t)).map((t) => `${CLI_TOOL_PREFIX}${t}`).join(","),
    "--system-prompt", SYSTEM_PROMPT,
    "--setting-sources", "",
    "--disable-slash-commands",
    "--no-session-persistence",
    "--max-turns", String(opts.maxTurns ?? MAX_TURNS),
    "--output-format", "stream-json",
    "--include-partial-messages",
    "--verbose",
  ];
}
