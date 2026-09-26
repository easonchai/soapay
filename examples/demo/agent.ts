// The agent beats of the live demo (docs/demo-desktop.md, beats 4 and 6), run from a terminal on
// stage. It starts the real Soapay MCP server (apps/mcp/dist/index.js) over stdio and drives its
// tools with the MCP SDK client, exactly as an agent host would, but with no LLM in the loop.
// Entry point: scripts/demo-agent.ts. From the repo root:
//
//   pnpm demo:agent init                         create scripts/.demo-agent.local.env (fresh phrase)
//   pnpm demo:agent status                       whoami + balance
//   pnpm demo:agent join                         create_agent_identity: paste the employer's invite
//                                                link at the prompt (or pass it, quoted)
//   pnpm demo:agent spend 0.5 alex-demo          scan, then spend (plan, confirm, Basescan link)
//
// Flags: --pause (wait for Enter before each step), --yes (don't ask before confirming a spend),
//        --env <file> (another env file; also DEMO_AGENT_ENV).
// Env file keys: AGENT_MNEMONIC, AGENT_PAYER_PRIVATE_KEY, STATE_DIR, API_URL, RPC_URL, ENS_RPC_URL,
// and any other MCP server setting (MAX_PER_CALL_USDC, …). The process environment wins over the file.
// When AGENT_PAYER_PRIVATE_KEY is unset, the payer is contracts/.env's DEPLOYER_PRIVATE_KEY.
//
// Keys and the recovery phrase go to the server process through its environment only. They are
// never printed, and the invite code (a bearer secret) is never printed either.
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { createPublicClient, formatEther, http, type Address } from "viem";
import { fetchAnnouncements, generateMnemonic, getChain, PARENT_NAME } from "@soapay/sdk";
import { REPO } from "./local.js";

// ---------------------------------------------------------------------------------------------
// Output

const color = !process.env.NO_COLOR && (process.stdout.isTTY || !!process.env.FORCE_COLOR);
const sgr = (code: string) => (s: string) => (color ? `\x1b[${code}m${s}\x1b[0m` : s);
const k = {
  bold: sgr("1"),
  dim: sgr("2"),
  green: sgr("1;32"),
  red: sgr("1;31"),
  yellow: sgr("1;33"),
  cyan: sgr("1;36"),
  tag: sgr("1;30;46"),
};
const out = (s = "") => process.stdout.write(`${s}\n`);
const tty = !!process.stdout.isTTY;

/** Removes anything secret from text we print (error messages come from other processes). */
const secrets: string[] = [];
const redact = (s: string) => secrets.reduce((acc, x) => (x ? acc.split(x).join("[redacted]") : acc), s);

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith("--")));
const positional: string[] = [];
let envArg: string | undefined;
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--env") envArg = args[++i];
  else if (!args[i]!.startsWith("--")) positional.push(args[i]!);
}
flags.delete("--env");
const PAUSE = flags.has("--pause");
const YES = flags.has("--yes");
const unknownFlags = [...flags].filter((f) => !["--pause", "--yes"].includes(f));

const stdinRl = () => createInterface({ input: process.stdin, output: process.stdout });

async function waitEnter(): Promise<void> {
  if (!PAUSE || !process.stdin.isTTY) return;
  const rl = stdinRl();
  await rl.question(k.dim("   ⏎ Enter to continue "));
  rl.close();
}

/** A step header: `▸ tool_name  what it does`. */
async function step(tool: string | null, text: string): Promise<void> {
  await waitEnter();
  out("");
  out(`${k.cyan("▸")} ${tool ? `${k.tag(` ${tool} `)} ` : ""}${k.bold(text)}`);
}
const line = (s: string) => out(`   ${s}`);
const ok = (s: string) => out(`   ${k.green("✓")} ${s}`);

const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
/** Runs `p` with a spinner and elapsed seconds (a plain line when stdout isn't a terminal). */
async function spin<T>(label: string, p: Promise<T> | (() => Promise<T>)): Promise<T> {
  const started = Date.now();
  const promise = typeof p === "function" ? p() : p;
  if (!tty) {
    out(k.dim(`   … ${label}`));
    return promise;
  }
  let i = 0;
  const draw = () => {
    const secs = ((Date.now() - started) / 1000).toFixed(1);
    process.stdout.write(`\r\x1b[2K   ${k.cyan(FRAMES[i++ % FRAMES.length]!)} ${label} ${k.dim(`${secs}s`)}`);
  };
  draw();
  const timer = setInterval(draw, 100);
  try {
    return await promise;
  } finally {
    clearInterval(timer);
    process.stdout.write("\r\x1b[2K");
    out(k.dim(`   ${label} (${((Date.now() - started) / 1000).toFixed(1)}s)`));
  }
}

const fail = (msg: string): never => {
  throw new Error(msg);
};

// ---------------------------------------------------------------------------------------------
// Config

const ENV_FILE = (() => {
  const p = envArg ?? process.env.DEMO_AGENT_ENV;
  return p ? (isAbsolute(p) ? p : resolve(process.env.INIT_CWD ?? process.cwd(), p)) : resolve(REPO, "scripts/.demo-agent.local.env");
})();

function parseEnvFile(path: string): Record<string, string> {
  if (!existsSync(path)) return {};
  const vars: Record<string, string> = {};
  for (const raw of readFileSync(path, "utf8").split("\n")) {
    const m = raw.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    vars[m[1]!] = m[2]!.trim().replace(/^(["'])(.*)\1$/, "$2");
  }
  return vars;
}

const DEFAULTS = {
  API_URL: "https://soapay.up.railway.app/api",
  RPC_URL: "https://sepolia.base.org",
  ENS_RPC_URL: "https://ethereum-sepolia-rpc.publicnode.com",
};

function init(): void {
  const existing = parseEnvFile(ENV_FILE);
  if (existing.AGENT_MNEMONIC) {
    out(`${k.green("✓")} ${ENV_FILE} already has an agent recovery phrase (not shown). Nothing to do.`);
    return;
  }
  mkdirSync(dirname(ENV_FILE), { recursive: true });
  const prior = existsSync(ENV_FILE) ? readFileSync(ENV_FILE, "utf8") : "";
  const header = prior
    ? ""
    : [
        "# pnpm demo:agent settings. Git-ignored; holds the demo agent's recovery phrase. Never commit or paste.",
        `API_URL=${DEFAULTS.API_URL}`,
        `RPC_URL=${DEFAULTS.RPC_URL}`,
        `ENS_RPC_URL=${DEFAULTS.ENS_RPC_URL}`,
        "# STATE_DIR=scripts/.demo-state/demo-agent",
        "# AGENT_PAYER_PRIVATE_KEY=0x…   (unset: contracts/.env DEPLOYER_PRIVATE_KEY)",
        "",
      ].join("\n");
  const body = `${prior}${prior && !prior.endsWith("\n") ? "\n" : ""}${header}AGENT_MNEMONIC="${generateMnemonic()}"\n`;
  writeFileSync(ENV_FILE, body, { mode: 0o600 });
  chmodSync(ENV_FILE, 0o600);
  out(`${k.green("✓")} wrote a fresh agent recovery phrase to ${ENV_FILE} (mode 0600, not shown)`);
  out(k.dim("  Next: pnpm demo:agent status"));
}

function deployerKey(): string | undefined {
  const file = resolve(process.env.SOAPAY_ENV_ROOT ?? REPO, "contracts/.env");
  return parseEnvFile(file).DEPLOYER_PRIVATE_KEY || undefined;
}

/** MCP server settings passed through from the env file / environment (see apps/mcp/.env.example). */
const SERVER_VARS = [
  "API_URL", "CHAIN_ID", "RPC_URL", "ENS_RPC_URL", "BUNDLER_URL", "PAYMASTER_URL", "PAY_TOKEN", "STEALTH_DISPERSE",
  "MAX_PER_CALL_USDC", "MAX_PER_DAY_USDC", "PAYEE_ALLOWLIST", "KNOWN_PAYERS", "IDENTIFIABLE_ADDRESSES",
];

function loadSettings() {
  const file = parseEnvFile(ENV_FILE);
  const get = (key: string) => process.env[key] || file[key] || undefined;
  const mnemonic = get("AGENT_MNEMONIC");
  if (!mnemonic) fail(`no AGENT_MNEMONIC: run \`pnpm demo:agent init\` first (writes ${ENV_FILE})`);
  const payer = get("AGENT_PAYER_PRIVATE_KEY") ?? deployerKey();
  secrets.push(mnemonic!, ...(payer ? [payer, payer.replace(/^0x/, "")] : []));
  const stateRaw = get("STATE_DIR") ?? "scripts/.demo-state/demo-agent";
  const stateDir = isAbsolute(stateRaw) ? stateRaw : resolve(REPO, stateRaw);
  const env: Record<string, string> = { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "" };
  for (const key of SERVER_VARS) {
    const v = get(key) ?? (DEFAULTS as Record<string, string>)[key];
    if (v) env[key] = v;
  }
  env.STATE_DIR = stateDir;
  env.AGENT_MNEMONIC = mnemonic!;
  if (payer) env.AGENT_PAYER_PRIVATE_KEY = payer;
  return { env, stateDir, apiUrl: env.API_URL!.replace(/\/+$/, ""), rpcUrl: env.RPC_URL!, ensRpcUrl: env.ENS_RPC_URL!, hasPayer: !!payer };
}

// ---------------------------------------------------------------------------------------------
// MCP

const SERVER = resolve(REPO, "apps/mcp/dist/index.js");
const chain = getChain(84532);
const BASESCAN = chain.chain.blockExplorers!.default.url.replace(/\/+$/, "");
const ETHERSCAN = "https://sepolia.etherscan.io";

type Settings = ReturnType<typeof loadSettings>;

class ToolError extends Error {
  constructor(readonly tool: string, readonly code: string, message: string) {
    super(`${tool}: ${code}: ${message}`);
  }
}

async function connect(s: Settings): Promise<Client> {
  if (!existsSync(SERVER)) fail(`build the MCP server first: pnpm --filter @soapay/mcp build (${SERVER} is missing)`);
  mkdirSync(s.stateDir, { recursive: true, mode: 0o700 });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [SERVER],
    env: s.env,
    stderr: process.env.SOAPAY_DEMO_DEBUG ? "inherit" : "ignore",
  });
  const client = new Client({ name: "soapay-demo-agent", version: "1.0.0" });
  await spin("starting the Soapay MCP server (stdio)", client.connect(transport));
  return client;
}

async function call(client: Client, tool: string, input: Record<string, unknown>, label: string): Promise<any> {
  const r: any = await spin(label, client.callTool({ name: tool, arguments: input }, undefined, { timeout: 600_000 }));
  const text: string = r.content?.map((c: any) => c.text ?? "").join("\n") ?? "";
  let body: any;
  try {
    body = JSON.parse(text);
  } catch {
    body = { raw: text };
  }
  if (r.isError) throw new ToolError(tool, body?.error?.code ?? "error", redact(body?.error?.message ?? text));
  return body;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const fullName = (n: string) => (n.includes(".") ? n.toLowerCase() : `${n.toLowerCase()}.${PARENT_NAME}`);
const usdc = (s: string | number) => `${s} USDC`;

// ---------------------------------------------------------------------------------------------
// Commands

async function status(client: Client, s: Settings): Promise<void> {
  await step("whoami", "Who is this agent?");
  const me = await call(client, "whoami", {}, "asking the MCP server");
  line(`name        ${me.name ? k.green(me.name) : k.yellow("no name yet (run join with an invite)")}`);
  line(`meta        ${k.dim(me.metaAddress)}`);
  if (me.payer) line(`payer       ${me.payer.address} ${k.dim(`${me.payer.usdc} USDC · ${Number(me.payer.eth).toFixed(4)} ETH`)}`);
  else if (!s.hasPayer) line(k.dim("payer       none configured (the agent can still be paid, scan and spend)"));
  if (me.guardrails) line(`caps        ${me.guardrails.maxPerCallUsdc} USDC per call · ${me.guardrails.remainingTodayUsdc} of ${me.guardrails.maxPerDayUsdc} USDC left today`);
  if (me.name) line(k.dim(`ENS         https://sepolia.app.ens.domains/${me.name}`));

  await step("balance", "What has it received?");
  const bal = await call(client, "balance", {}, "scanning with the agent's viewing key");
  line(`${k.green(usdc(bal.totalUsdc))} across ${bal.addresses} stealth address${bal.addresses === 1 ? "" : "es"} ${k.dim(`(${bal.clusters?.length ?? 0} unlinked cluster${bal.clusters?.length === 1 ? "" : "s"})`)}`);
  for (const cl of bal.clusters ?? []) for (const a of cl.addresses ?? []) line(k.dim(`  ${a.address}  ${a.usdc} USDC`));
}

/** The invite link's label and org, for display only (the API's reserved label is what counts). */
function inviteHint(link: string): { label: string | undefined; org: string | undefined } {
  const q = link.includes("?") ? link.slice(link.indexOf("?") + 1) : "";
  const p = new URLSearchParams(q);
  return { label: p.get("label") ?? undefined, org: p.get("org") ?? undefined };
}

async function readInvite(): Promise<string | undefined> {
  if (process.stdin.isTTY) {
    const rl = stdinRl();
    const v = (await rl.question(k.bold("Paste the invite link: "))).trim();
    rl.close();
    if (tty) process.stdout.write("\x1b[1A\r\x1b[2K"); // don't leave the link on screen
    return v || undefined;
  }
  let data = "";
  for await (const chunk of process.stdin) data += chunk;
  return data.trim() || undefined;
}

async function join(client: Client, s: Settings, invite: string): Promise<void> {
  const code = invite.match(/0x[0-9a-fA-F]{64}/)?.[0];
  if (code) secrets.push(code, code.slice(2));
  const hint = inviteHint(invite);
  await step(
    "create_agent_identity",
    `Join ${hint.org ? `${hint.org} payroll` : "the employer's payroll"} with the invite${hint.label ? ` for ${hint.label}.${PARENT_NAME}` : ""}`,
  );
  line(k.dim("registers the agent's own keys (ERC-6538, gas relayed), then claims the name on ENSv2 Sepolia"));
  const id = await call(
    client,
    "create_agent_identity",
    {
      invite,
      description: process.env.AGENT_DESCRIPTION ?? "Bills clients and gets paid privately in USDC.",
      capabilities: (process.env.AGENT_CAPABILITIES ?? "billing,invoice,pay").split(",").map((x) => x.trim()).filter(Boolean),
    },
    "registering and claiming the name",
  );
  ok(`${k.green(id.name)} ${id.created ? "claimed now" : k.dim("(already this agent's name)")}${id.invite?.org ? ` · joined ${k.bold(id.invite.org)}` : ""}`);
  line(`meta-address   ${k.dim(id.metaAddress)}`);
  if (id.registration?.txHash) line(`registration   ${BASESCAN}/tx/${id.registration.txHash}`);
  if (id.txHash) line(`ENS name tx    ${k.cyan(`${ETHERSCAN}/tx/${id.txHash}`)}`);

  await step(null, "ENSIP-26 agent records, next to its `stealth` record");
  const records: Record<string, string> = id.records ?? {};
  for (const [key, value] of Object.entries(records)) {
    if (key === "agent-context") {
      try {
        const ctx = JSON.parse(value) as { description?: string; capabilities?: string[]; payments?: { scheme?: string } };
        line(`${k.bold("agent-context")}  "${ctx.description}"`);
        line(k.dim(`               capabilities [${(ctx.capabilities ?? []).join(", ")}] · paid by ${ctx.payments?.scheme ?? "ERC-5564"}`));
        continue;
      } catch {
        /* fall through: print raw */
      }
    }
    line(`${k.bold(key)}  ${k.dim(value.length > 90 ? `${value.slice(0, 90)}…` : value)}`);
  }
  if (!Object.keys(records).length) line(k.dim("(no agent records in the reply)"));
  const ens = createPublicClient({ chain: chain.ensChain!, transport: http(s.ensRpcUrl, { retryCount: 2, timeout: 8_000 }) });
  const live = await spin("reading agent-context back from ENS (Sepolia)", async () => {
    for (let i = 0; i < 5; i++) {
      const v = await ens.getEnsText({ name: id.name, key: "agent-context" }).catch(() => null);
      if (v) return v;
      await sleep(2_000);
    }
    return null;
  });
  if (live) ok(`resolves on ENS: getEnsText("${id.name}", "agent-context")`);
  else line(k.yellow("not visible on the RPC yet (Sepolia lag); the tx above is final"));
  line(k.dim(`ENS app   https://sepolia.app.ens.domains/${id.name}`));
}

async function spend(client: Client, s: Settings, amount: string, toArg: string): Promise<void> {
  const to = fullName(toArg);
  if (!/^\d+(\.\d{1,6})?$/.test(amount) || Number(amount) <= 0) fail(`"${amount}" is not a USDC amount (e.g. 0.5)`);

  // 1. Scan. The pay run may land a few seconds before the API indexes it: retry for ~20 s.
  await step("scan", "What was I paid?");
  let scan: any;
  let mine: any[] = [];
  const deadline = Date.now() + 20_000;
  for (let attempt = 0; ; attempt++) {
    scan = await call(client, "scan", {}, attempt ? "waiting for the indexer…" : "scanning announcements with the agent's viewing key");
    mine = (scan.payments ?? []).filter((p: any) => Number(p.balanceUsdc) > 0);
    if (mine.length || Date.now() > deadline) break;
    await spin("waiting for the indexer…", sleep(4_000));
  }
  if (!mine.length) fail("nothing received yet (the pay run isn't indexed, or everything is spent). Run it again in a few seconds.");

  // The newest pay run that paid this agent, and how many lines it had in total.
  const latest = mine.reduce((a: any, b: any) => (BigInt(b.block ?? 0) > BigInt(a.block ?? 0) ? b : a));
  const inRun = mine.filter((p: any) => p.txHash?.toLowerCase() === latest.txHash?.toLowerCase());
  let total: number | undefined;
  try {
    const block = BigInt(latest.block);
    const { announcements } = await fetchAnnouncements({ apiUrl: s.apiUrl, fromBlock: block, toBlock: block });
    total = announcements.filter((a) => a.txHash.toLowerCase() === latest.txHash.toLowerCase()).length;
  } catch {
    total = undefined;
  }
  const runSum = inRun.reduce((sum: number, p: any) => sum + Number(p.balanceUsdc), 0);
  out("");
  out(`   ${k.bold(`${total ?? "?"} lines in this pay run; ${inRun.length} ${inRun.length === 1 ? "is" : "are"} mine`)} ${k.green(`(${+runSum.toFixed(6)} USDC)`)}`);
  line(k.dim("the rest are strangers' addresses: the agent can't tell whose they are"));
  for (const p of inRun) line(`${k.green(`+${p.balanceUsdc} USDC`)}  ${p.stealthAddress}  ${k.dim(p.payerKnown ? "known payer" : "unknown payer")}`);
  line(k.dim(`pay run  ${BASESCAN}/tx/${latest.txHash}`));
  if (mine.length > inRun.length) line(k.dim(`(+${mine.length - inRun.length} unspent address${mine.length - inRun.length === 1 ? "" : "es"} from earlier runs; balances are real, read on-chain)`));

  // 2. Plan: the consolidation guard decides; nothing moves yet.
  await step("spend", `Plan: send ${amount} USDC to ${to}`);
  const plan = await call(client, "spend", { to, amount }, "planning (consolidation guard, fresh stealth address for the payee)");
  const verdict = plan.decision === "allow" ? k.green("allow") : plan.decision === "warn" ? k.yellow("warn") : k.red(plan.decision);
  line(`guard     ${verdict} ${k.dim(`· ${plan.reason}`)}`);
  for (const w of plan.warnings ?? []) line(k.yellow(`warning   ${w.code ?? ""} ${w.message ?? ""}`.trim()));
  if (!plan.planId) fail(`the guard blocked this spend: ${plan.reason}`);
  for (const part of plan.parts ?? []) line(`from      ${part.from}  →  a fresh stealth address of ${to}  ${k.dim(`(${part.amountUsdc} USDC)`)}`);
  const sponsored = Number(plan.maxFeesUsdc) === 0;
  line(`gas       ${sponsored ? k.green("sponsored") + k.dim(" (paymaster; the stealth address holds no ETH)") : `max ${plan.maxFeesUsdc} USDC, paid in USDC`} · ${plan.userOps} userOp${plan.userOps === 1 ? "" : "s"}`);

  // 3. Confirm (the second call is what moves value).
  if (!YES) {
    if (!process.stdin.isTTY) fail("not a terminal: pass --yes to confirm the plan");
    const rl = stdinRl();
    const answer = (await rl.question(`\n   ${k.bold("Confirm this spend? [Y/n] ")}`)).trim().toLowerCase();
    rl.close();
    if (answer && answer !== "y" && answer !== "yes") {
      out(k.dim("   not confirmed; nothing was sent (the plan expires in 10 minutes)"));
      return;
    }
  }
  await step("spend", "Confirm");
  const done = await call(client, "spend", { confirm: plan.planId }, "signing the userOp (7702) and sending it through the bundler");
  for (const r of done.results ?? []) {
    if (r.txHash) ok(`${r.status}  ${k.cyan(`${BASESCAN}/tx/${r.txHash}`)}`);
    else line(k.red(`${r.status}  ${redact(r.error ?? r.userOpHash ?? "")}`));
  }
  if (!done.ok) fail("the spend did not complete");

  // 4. The source stealth addresses never held gas money.
  await step(null, "Did the stealth address need ETH for gas?");
  const base = createPublicClient({ chain: chain.chain, transport: http(s.rpcUrl, { retryCount: 2, timeout: 8_000 }) });
  for (const r of done.results ?? []) {
    const eth = await spin(`reading ${r.from}`, base.getBalance({ address: r.from as Address }));
    ok(`source address ${r.from} ${k.bold(`ETH: ${formatEther(eth)}`)}`);
    line(k.dim(`${BASESCAN}/address/${r.from}`));
  }
}

// ---------------------------------------------------------------------------------------------

const USAGE = `usage: pnpm demo:agent <command> [--pause] [--yes] [--env <file>]
  init                     create the env file with a fresh agent recovery phrase (never printed)
  status                   whoami + balance
  join ['<invite link>']   join an employer's payroll (create_agent_identity); no link: paste it at the prompt
  spend <amount> <name>    scan, then spend to <name> (a label means <label>.${PARENT_NAME})`;

async function main(): Promise<void> {
  const [cmd, ...rest] = positional;
  if (unknownFlags.length) fail(`unknown flag ${unknownFlags.join(" ")}\n${USAGE}`);
  if (!cmd || cmd === "help") {
    out(USAGE);
    if (!cmd) process.exitCode = 2;
    return;
  }
  if (cmd === "init") return init();
  if (!["status", "join", "spend"].includes(cmd)) fail(`unknown command "${cmd}"\n${USAGE}`);
  if (cmd === "spend" && (!rest[0] || !rest[1])) fail(`spend needs an amount and a name\n${USAGE}`);

  const s = loadSettings();
  // No link on the command line: ask for it (or read it from stdin). This keeps the link (a bearer
  // secret) out of the shell history and pnpm's echo of the command, and avoids quoting its `&`.
  const invite = cmd === "join" ? (rest[0] ?? (await readInvite())) : undefined;
  if (cmd === "join" && !invite) fail(`join needs the invite link\n${USAGE}`);
  out(k.bold(`Soapay agent · MCP over stdio`) + k.dim(`  API ${s.apiUrl} · Base Sepolia`));
  const client = await connect(s);
  try {
    if (cmd === "status") await status(client, s);
    else if (cmd === "join") await join(client, s, invite!);
    else await spend(client, s, rest[0]!, rest[1]!);
  } finally {
    await client.close().catch(() => undefined);
  }
  out("");
}

try {
  await main();
} catch (e) {
  const msg = redact(e instanceof Error ? e.message : String(e));
  process.stdout.write("\n");
  console.error(`${k.red("✗")} ${msg}`);
  process.exit(1);
}
