// The live agent beat: a real LLM agent (Claude Sonnet 5) onboards itself and spends through the
// Soapay MCP server. Unlike `pnpm demo:agent` (agent.ts, scripted, no LLM), the model gets a
// natural-language task and the server's tools, and decides which tools to call and with what.
// Entry point: scripts/demo-agent-live.ts. From the repo root:
//
//   pnpm demo:agent-live join                    paste the invite link at the prompt (hidden)
//   pnpm demo:agent-live spend 0.5 alex-demo     "check what you've been paid, then pay 0.5 USDC to …"
//
// Flags: --env <file> (default scripts/.demo-agent.local.env, same file as demo:agent),
//        --backend cli|sdk (default: cli), --max-turns <n> (default 12).
// Backends:
//   cli  (primary) The installed `claude` CLI, headless: `claude -p --model claude-sonnet-5 --mcp-config …
//        --output-format stream-json`, using the machine's Claude login (no API key needed). Its built-in
//        tools are off; only the task's Soapay MCP tools are allowed.
//   sdk  (optional) Anthropic TypeScript SDK, streamed Messages API; this process bridges the MCP server's
//        tools into the tool loop. Needs ANTHROPIC_API_KEY (env or env file). Used when asked with
//        --backend sdk, or when there is no `claude` CLI but a key is set.
// Same model, same tools, same rendering either way.
// Keys, the recovery phrase and the invite code are never printed; RPC URLs are shown host-only.
import { spawn } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join as joinPath, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import Anthropic from "@anthropic-ai/sdk";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import {
  ClaudeStreamAdapter,
  claudeCliArgs,
  bridgeTools,
  formatCall,
  inviteCode,
  MAX_TURNS,
  MODEL,
  MODEL_LABEL,
  Redactor,
  runAgent,
  safeUrl,
  summarizeResult,
  taskFor,
  TOOLSETS,
  type Command,
  type McpLike,
  type Render,
  type ToolOutcome,
} from "./agent-live-core.js";
import { REPO } from "./local.js";

// ---------------------------------------------------------------------------------------------
// Terminal

const color = !process.env.NO_COLOR && (process.stdout.isTTY || !!process.env.FORCE_COLOR);
const sgr = (code: string) => (s: string) => (color ? `\x1b[${code}m${s}\x1b[0m` : s);
const k = { bold: sgr("1"), dim: sgr("2"), italic: sgr("2;3"), green: sgr("1;32"), red: sgr("1;31"), yellow: sgr("1;33"), cyan: sgr("1;36"), tag: sgr("1;30;46") };
const tty = !!process.stdout.isTTY;
const w = (s: string) => process.stdout.write(s);
const out = (s = "") => w(`${s}\n`);
const redactor = new Redactor();
const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

class Terminal implements Render {
  private timer: NodeJS.Timeout | undefined;
  private col = 0; // 0: at line start
  private mode: "none" | "text" | "reasoning" = "none";
  private reasoningChars = 0;
  readonly links: string[] = [];

  private stopSpin(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = undefined;
    w("\r\x1b[2K");
  }
  private startSpin(label: string): void {
    this.stopSpin();
    if (!tty) return;
    const started = Date.now();
    let i = 0;
    const draw = () => w(`\r\x1b[2K   ${k.cyan(FRAMES[i++ % FRAMES.length]!)} ${k.dim(`${label} ${((Date.now() - started) / 1000).toFixed(1)}s`)}`);
    draw();
    this.timer = setInterval(draw, 100);
  }
  private endLine(): void {
    if (this.col) out();
    this.col = 0;
    this.mode = "none";
  }
  private stream(s: string, style: (x: string) => string, prefix: string): void {
    for (const ch of s.split(/(\n)/)) {
      if (ch === "\n") {
        if (this.col) out();
        this.col = 0;
        continue;
      }
      if (!ch) continue;
      if (!this.col) w(prefix);
      w(style(ch));
      this.col += ch.length;
    }
  }

  thinking(on: boolean): void {
    if (on) {
      this.endLine();
      this.reasoningChars = 0;
      this.startSpin("thinking");
    } else this.stopSpin();
  }
  reasoning(delta: string): void {
    // Summarized reasoning, dimmed and capped per turn: enough to see it think, not a wall of text.
    if (this.reasoningChars >= 280) return;
    const room = 280 - this.reasoningChars;
    const piece = delta.length > room ? `${delta.slice(0, room)}…` : delta;
    this.reasoningChars += delta.length;
    this.stopSpin();
    if (this.mode !== "reasoning") this.endLine(), (this.mode = "reasoning");
    this.stream(piece.replace(/\n+/g, " "), k.italic, `   ${k.dim("∴")} `);
    if (this.reasoningChars >= 280) this.endLine();
  }
  text(delta: string): void {
    this.stopSpin();
    if (this.mode !== "text") this.endLine(), (this.mode = "text");
    this.stream(delta, (x) => x, `   ${k.bold("◆")} `);
  }
  toolStart(name: string, input: Record<string, unknown>): void {
    this.stopSpin();
    this.endLine();
    out(`   ${k.cyan("▸")} ${k.tag(` ${formatCall(name, input, redactor)} `)}`);
    this.startSpin(`${name} running on the Soapay MCP server`);
  }
  toolEnd(o: ToolOutcome): void {
    this.stopSpin();
    const { lines, links } = summarizeResult(o.name, o.body, o.isError);
    this.links.push(...links);
    const secs = k.dim(`(${(o.ms / 1000).toFixed(1)}s)`);
    out(`     ${o.isError ? k.red("✗") : k.green("✓")} ${k.bold(o.name)}  ${redactor.redact(lines[0] ?? "")} ${secs}`);
    for (const l of lines.slice(1)) {
      const s = redactor.redact(l);
      out(`       ${/https?:\/\//.test(s) ? s.replace(/(https?:\/\/\S+)/, k.cyan("$1")) : k.dim(s)}`);
    }
  }
  note(s: string): void {
    this.stopSpin();
    this.endLine();
    out(`   ${k.yellow("!")} ${redactor.redact(s)}`);
  }
  info(s: string): void {
    this.stopSpin();
    this.endLine();
    out(k.dim(`   ${redactor.redact(s)}`));
    this.startSpin("thinking");
  }
  close(): void {
    this.stopSpin();
    this.endLine();
  }
}

const fail = (msg: string): never => {
  throw new Error(msg);
};

// ---------------------------------------------------------------------------------------------
// Args and settings (same env file and keys as demo:agent)

const argv = process.argv.slice(2);
const positional: string[] = [];
const opt: Record<string, string> = {};
for (let i = 0; i < argv.length; i++) {
  const a = argv[i]!;
  if (a === "--env" || a === "--backend" || a === "--max-turns") opt[a.slice(2)] = argv[++i] ?? "";
  else if (a.startsWith("--")) opt[a.slice(2)] = "unknown";
  else positional.push(a);
}

const ENV_FILE = (() => {
  const p = opt.env ?? process.env.DEMO_AGENT_ENV;
  return p ? (isAbsolute(p) ? p : resolve(process.env.INIT_CWD ?? process.cwd(), p)) : resolve(REPO, "scripts/.demo-agent.local.env");
})();

function parseEnvFile(path: string): Record<string, string> {
  if (!existsSync(path)) return {};
  const vars: Record<string, string> = {};
  for (const raw of readFileSync(path, "utf8").split("\n")) {
    const m = raw.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m) vars[m[1]!] = m[2]!.trim().replace(/^(["'])(.*)\1$/, "$2");
  }
  return vars;
}

const DEFAULTS: Record<string, string> = {
  API_URL: "https://soapay.up.railway.app/api",
  RPC_URL: "https://sepolia.base.org",
  ENS_RPC_URL: "https://ethereum-sepolia-rpc.publicnode.com",
};
const SERVER_VARS = [
  "API_URL", "CHAIN_ID", "RPC_URL", "ENS_RPC_URL", "BUNDLER_URL", "PAYMASTER_URL", "PAY_TOKEN", "STEALTH_DISPERSE",
  "MAX_PER_CALL_USDC", "MAX_PER_DAY_USDC", "PAYEE_ALLOWLIST", "KNOWN_PAYERS", "IDENTIFIABLE_ADDRESSES",
];
const SERVER = resolve(REPO, "apps/mcp/dist/index.js");

function loadSettings() {
  if (!existsSync(ENV_FILE) && !process.env.AGENT_MNEMONIC) fail(`no env file at ${ENV_FILE}: run \`pnpm demo:agent init\` first (or pass --env)`);
  const file = parseEnvFile(ENV_FILE);
  const get = (key: string) => process.env[key] || file[key] || undefined;
  const mnemonic = get("AGENT_MNEMONIC") ?? fail(`no AGENT_MNEMONIC in ${ENV_FILE}: run \`pnpm demo:agent init\``);
  const deployer = parseEnvFile(resolve(process.env.SOAPAY_ENV_ROOT ?? REPO, "contracts/.env")).DEPLOYER_PRIVATE_KEY || undefined;
  const payer = get("AGENT_PAYER_PRIVATE_KEY") ?? deployer;
  const anthropicKey = get("ANTHROPIC_API_KEY");
  redactor.add(mnemonic, payer, payer?.replace(/^0x/, ""), anthropicKey);
  const stateRaw = get("STATE_DIR") ?? "scripts/.demo-state/demo-agent";
  const stateDir = isAbsolute(stateRaw) ? stateRaw : resolve(REPO, stateRaw);
  const env: Record<string, string> = { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "" };
  for (const key of SERVER_VARS) {
    const v = get(key) ?? DEFAULTS[key];
    if (v) env[key] = v;
  }
  // Paid RPC URLs carry their key in the path: never print them whole.
  redactor.add(env.RPC_URL, env.ENS_RPC_URL, env.BUNDLER_URL, env.PAYMASTER_URL);
  env.STATE_DIR = stateDir;
  env.AGENT_MNEMONIC = mnemonic;
  if (payer) env.AGENT_PAYER_PRIVATE_KEY = payer;
  return { env, stateDir, anthropicKey };
}
type Settings = ReturnType<typeof loadSettings>;

async function readInvite(): Promise<string | undefined> {
  if (process.stdin.isTTY) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const v = (await rl.question(k.bold("Paste the invite link: "))).trim();
    rl.close();
    if (tty) w("\x1b[1A\r\x1b[2K"); // don't leave the link on screen
    return v || undefined;
  }
  let data = "";
  for await (const chunk of process.stdin) data += chunk;
  return data.trim() || undefined;
}

function onPath(bin: string): boolean {
  return (process.env.PATH ?? "").split(":").some((d) => d && existsSync(joinPath(d, bin)));
}

// ---------------------------------------------------------------------------------------------
// Backends

type Outcome = { turns: number; toolCalls: ToolOutcome[]; finalText: string; capped: boolean; ok: boolean; extra?: string };

async function runSdk(s: Settings, cmd: Command, term: Terminal, maxTurns: number): Promise<Outcome> {
  mkdirSync(s.stateDir, { recursive: true, mode: 0o700 });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [SERVER],
    env: s.env,
    stderr: process.env.SOAPAY_DEMO_DEBUG ? "inherit" : "ignore",
  });
  const client = new Client({ name: "soapay-live-agent", version: "1.0.0" });
  await client.connect(transport);
  const mcp: McpLike = {
    listTools: async () => (await client.listTools()) as Awaited<ReturnType<McpLike["listTools"]>>,
    callTool: (name, args) => client.callTool({ name, arguments: args }, undefined, { timeout: 600_000 }) as Promise<{ content?: unknown; isError?: boolean }>,
  };
  try {
    const tools = await bridgeTools(mcp, TOOLSETS[cmd.kind]);
    out(k.dim(`   ${tools.length} tools bridged from MCP into the Messages API: ${tools.map((t) => t.name).join(", ")}`));
    out();
    const llm = new Anthropic({ apiKey: s.anthropicKey!, maxRetries: 3 });
    const r = await runAgent({ llm, mcp, tools, task: taskFor(cmd).prompt, render: term, redactor, maxTurns });
    return { ...r, ok: !r.capped && r.stopReason === "end_turn" };
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) fail("ANTHROPIC_API_KEY was rejected (401)");
    if (e instanceof Anthropic.NotFoundError) fail(`model ${MODEL} not found for this key (404)`);
    if (e instanceof Anthropic.RateLimitError) fail("rate limited by the Anthropic API (429); retry in a moment");
    throw e;
  } finally {
    await client.close().catch(() => undefined);
  }
}

async function runCli(s: Settings, cmd: Command, term: Terminal, maxTurns: number): Promise<Outcome> {
  mkdirSync(s.stateDir, { recursive: true, mode: 0o700 });
  // The MCP config holds no secrets: its env refers to variables that only the claude process has.
  const dir = mkdtempSync(joinPath(tmpdir(), "soapay-live-agent-"));
  const configPath = joinPath(dir, "mcp.json");
  const serverEnv = Object.fromEntries(Object.keys(s.env).map((key) => [key, `\${SOAPAY_MCP_${key}}`]));
  writeFileSync(configPath, JSON.stringify({ mcpServers: { soapay: { type: "stdio", command: process.execPath, args: [SERVER], env: serverEnv } } }), { mode: 0o600 });
  chmodSync(configPath, 0o600);
  const childEnv: Record<string, string> = {};
  for (const [key, v] of Object.entries(process.env)) if (v !== undefined && !key.startsWith("SOAPAY_MCP_")) childEnv[key] = v;
  for (const [key, v] of Object.entries(s.env)) childEnv[`SOAPAY_MCP_${key}`] = v;
  delete childEnv.AGENT_MNEMONIC;
  delete childEnv.AGENT_PAYER_PRIVATE_KEY;

  out(k.dim(`   tools allowed: ${TOOLSETS[cmd.kind].join(", ")} (Claude Code's built-in tools are off)`));
  out();
  const adapter = new ClaudeStreamAdapter(term, redactor);
  term.thinking(true);
  try {
    const code = await new Promise<number>((resolveExit, reject) => {
      const child = spawn("claude", claudeCliArgs({ mcpConfigPath: configPath, tools: TOOLSETS[cmd.kind], maxTurns }), {
        env: childEnv,
        cwd: dir,
        stdio: ["pipe", "pipe", "pipe"],
      });
      let buf = "";
      let err = "";
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (d: string) => {
        buf += d;
        let i: number;
        while ((i = buf.indexOf("\n")) >= 0) {
          adapter.line(buf.slice(0, i));
          buf = buf.slice(i + 1);
        }
      });
      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (d: string) => (err += d));
      child.on("error", reject);
      child.on("close", (c) => {
        if (buf.trim()) adapter.line(buf);
        if (c && !adapter.result) term.note(`claude exited ${c}: ${redactor.redact(err.trim().split("\n").slice(-3).join(" ")) || "no output"}`);
        resolveExit(c ?? 0);
      });
      child.stdin.end(taskFor(cmd).prompt);
    });
    const res = adapter.result;
    const capped = !!res?.isError && /max.?turns/i.test(res.text);
    if (capped) term.note(`stopped after ${maxTurns} turns (turn cap)`);
    return {
      turns: res?.numTurns ?? adapter.turns,
      toolCalls: adapter.toolCalls,
      finalText: adapter.finalText,
      capped,
      ok: code === 0 && !!res && !res.isError,
      ...(res?.costUsd !== undefined ? { extra: `$${res.costUsd.toFixed(4)}` } : {}),
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------------------------

const USAGE = `usage: pnpm demo:agent-live <command> [--env <file>] [--backend cli|sdk] [--max-turns <n>]
  join                     the agent joins payroll: paste the invite link at the prompt (hidden)
  spend <amount> <name>    the agent checks what it was paid, then pays <amount> USDC to <name>`;

async function main(): Promise<void> {
  const bad = Object.entries(opt).filter(([, v]) => v === "unknown").map(([key]) => `--${key}`);
  if (bad.length) fail(`unknown flag ${bad.join(" ")}\n${USAGE}`);
  const [name, ...rest] = positional;
  if (!name || name === "help") {
    out(USAGE);
    if (!name) process.exitCode = 2;
    return;
  }
  if (name !== "join" && name !== "spend") fail(`unknown command "${name}"\n${USAGE}`);
  if (name === "spend" && (!rest[0] || !rest[1])) fail(`spend needs an amount and a name\n${USAGE}`);
  if (name === "spend" && (!/^\d+(\.\d{1,6})?$/.test(rest[0]!) || Number(rest[0]) <= 0)) fail(`"${rest[0]}" is not a USDC amount (e.g. 0.5)`);
  const maxTurns = opt["max-turns"] ? Number(opt["max-turns"]) : MAX_TURNS;
  if (!Number.isInteger(maxTurns) || maxTurns < 1 || maxTurns > 40) fail("--max-turns must be 1..40");
  if (!existsSync(SERVER)) fail(`build the MCP server first: pnpm --filter @soapay/mcp build (${SERVER} is missing)`);

  const s = loadSettings();
  const hasCli = onPath("claude");
  const backend = opt.backend ?? (hasCli || !s.anthropicKey ? "cli" : "sdk");
  if (backend !== "sdk" && backend !== "cli") fail(`--backend must be cli or sdk`);
  if (backend === "sdk" && !s.anthropicKey) fail(`--backend sdk needs ANTHROPIC_API_KEY (environment or ${ENV_FILE})`);
  if (backend === "cli" && !hasCli) fail("no `claude` CLI on PATH: install Claude Code and log in (or set ANTHROPIC_API_KEY and pass --backend sdk)");

  let cmd: Command;
  if (name === "join") {
    const invite = rest[0] ?? (await readInvite()) ?? fail(`join needs the invite link\n${USAGE}`);
    const code = inviteCode(invite);
    redactor.add(code, code?.slice(2));
    cmd = { kind: "join", invite };
  } else cmd = { kind: "spend", amount: rest[0]!, name: rest[1]! };

  out();
  out(`${k.bold(`Agent: ${MODEL_LABEL}`)} ${k.dim("·")} ${k.bold("tools from the Soapay MCP server")}`);
  out(k.dim(`   ${backend === "sdk" ? "Anthropic API (TypeScript SDK), streamed tool loop" : "claude CLI, headless (claude -p)"} · model ${MODEL} · MCP over stdio · ${safeUrl(s.env.API_URL!)} · Base Sepolia`));
  out();
  out(`${k.bold("Task")}  ${k.italic(taskFor(cmd).shown.replace(/\n+/g, " "))}`);

  const term = new Terminal();
  const started = Date.now();
  let r: Outcome;
  try {
    r = backend === "sdk" ? await runSdk(s, cmd, term, maxTurns) : await runCli(s, cmd, term, maxTurns);
  } finally {
    term.close();
  }

  out();
  out(k.bold("Summary"));
  const calls = r.toolCalls.map((c) => `${c.isError ? k.red(c.name) : c.name}`).join(" → ") || "none";
  out(`   tools the agent chose  ${calls}`);
  out(k.dim(`   ${r.toolCalls.length} tool call${r.toolCalls.length === 1 ? "" : "s"} · ${r.turns} model turn${r.turns === 1 ? "" : "s"} · ${((Date.now() - started) / 1000).toFixed(1)}s${r.extra ? ` · ${r.extra}` : ""}`));
  for (const l of [...new Set(term.links)]) out(`   ${k.cyan(redactor.redact(l))}`);
  if (r.finalText) out(`   ${k.bold("◆")} ${redactor.redact(r.finalText.split("\n").filter(Boolean).slice(-1)[0] ?? "")}`);
  out();
  if (!r.ok) process.exitCode = 1;
}

try {
  await main();
} catch (e) {
  process.stdout.write("\n");
  console.error(`${k.red("✗")} ${redactor.redact(e instanceof Error ? e.message : String(e))}`);
  process.exit(1);
}
