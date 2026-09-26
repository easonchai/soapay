// The AI agent side of the "plug it into anything" demo, live on Base Sepolia, driven through the
// real MCP server (apps/mcp) over stdio, exactly as an agent host (Claude, an agent framework) would.
//
// The agent is a payee like any person: it gets <label>.soapay.eth, is paid in the same pay run as
// the humans (indistinguishable lines on-chain), scans with its own viewing key, and spends
// gaslessly (7702; on Base Sepolia the gas is sponsored through the API's /paymaster, on Base the
// Circle paymaster takes it in USDC). It holds no payer key and no ETH.
//
//   pnpm --filter @soapay/mcp build
//   pnpm --filter @soapay/examples demo:agent claim
//   AGENT_SINCE_BLOCK=<block before the pay run> pnpm --filter @soapay/examples demo:agent receive
//
// Env: SOAPAY_MCP_API (default the public demo API), RPC_URL, ENS_RPC_URL,
//      AGENT_SPEND_TO (default dividend-cleo.soapay.eth), AGENT_SPEND_USDC (default 0.02), SPEND_DRY=1.
import { existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { createPublicClient, http } from "viem";
import { fetchAnnouncements, getChain, PARENT_NAME } from "@soapay/sdk";
import { c, loadOrCreateLocal, REPO, short } from "./local.js";

const API = (process.env.SOAPAY_MCP_API ?? "https://soapay.up.railway.app/api").replace(/\/+$/, "");
const RPC_URL = process.env.RPC_URL ?? "https://sepolia.base.org";
const ENS_RPC_URL = process.env.ENS_RPC_URL ?? "https://ethereum-sepolia-rpc.publicnode.com";
const SPEND_TO = process.env.AGENT_SPEND_TO ?? "dividend-cleo.soapay.eth";
const SPEND_USDC = process.env.AGENT_SPEND_USDC ?? "0.02";
const SERVER = resolve(REPO, "apps/mcp/dist/index.js");
const chain = getChain(84532);
const explorer = (h: string) => `${chain.chain.blockExplorers!.default.url}/tx/${h}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const command = process.argv[2];
if (command !== "claim" && command !== "receive") throw new Error("usage: agent.ts claim | receive");
if (!existsSync(SERVER)) throw new Error(`build the MCP server first: pnpm --filter @soapay/mcp build (${SERVER} is missing)`);

const local = loadOrCreateLocal();
const agentName = `${local.agent.label}.${PARENT_NAME}`;
const say = (what: string) => console.log(`${c.cyan("▸")} ${c.bold(local.agent.label)} ${c.dim("(MCP)")} ${what}`);

async function connect(): Promise<Client> {
  const dir = resolve(REPO, "scripts/.demo-state/agent");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [SERVER],
    // The agent's recovery phrase goes to its own server process through the environment only.
    env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", API_URL: API, CHAIN_ID: "84532", RPC_URL, ENS_RPC_URL, STATE_DIR: dir, AGENT_MNEMONIC: local.agent.phrase },
    stderr: process.env.SOAPAY_DEMO_DEBUG ? "inherit" : "ignore",
  });
  const client = new Client({ name: "soapay-demo-agent-host", version: "1.0.0" });
  await client.connect(transport);
  return client;
}

async function call(client: Client, name: string, args: Record<string, unknown> = {}): Promise<any> {
  const r: any = await client.callTool({ name, arguments: args });
  const body = JSON.parse(r.content?.[0]?.text ?? "{}");
  if (r.isError) throw new Error(`${name}: ${body.error?.code}: ${body.error?.message}`);
  return body;
}

async function claim(agent: Client) {
  say(`create_agent_identity ${c.dim(`label=${local.agent.label}`)}`);
  const id = await call(agent, "create_agent_identity", {
    label: local.agent.label,
    description: "Invoices clients and takes its revenue share, paid privately in USDC.",
    capabilities: ["invoice", "revenue-share"],
    endpoints: { web: "https://soapay.up.railway.app" },
  });
  console.log(`  ${c.green(id.name)} ${id.created ? c.green("claimed now") : c.dim("(already this agent's)")}  ${c.dim(`meta ${short(id.metaAddress)}`)}`);
  const ens = createPublicClient({ chain: chain.ensChain!, transport: http(ENS_RPC_URL, { retryCount: 3 }) });
  for (let i = 0; i < 10; i++) {
    const ctx = await ens.getEnsText({ name: agentName, key: "agent-context" }).catch(() => null);
    if (ctx) {
      const parsed = JSON.parse(ctx) as { description?: string; capabilities?: string[] };
      console.log(`  ENSIP-26 agent-context: ${c.dim(`"${parsed.description}" [${(parsed.capabilities ?? []).join(", ")}]`)}`);
      return;
    }
    await sleep(3_000);
  }
}

async function receive(agent: Client) {
  const since = BigInt(process.env.AGENT_SINCE_BLOCK ?? "0");

  // 1. Scan with the agent's viewing key until this run's lines are indexed.
  say("scan");
  let mine: any[] = [];
  let scan: any;
  for (let i = 0; i < 30; i++) {
    scan = await call(agent, "scan");
    mine = scan.payments.filter((p: any) => BigInt(p.block ?? 0) >= since && p.balanceUsdc !== "0");
    if (mine.length) break;
    await sleep(4_000);
  }
  if (!mine.length) throw new Error("this run's payment didn't reach the API index within 2 minutes; run `receive` again");
  const payTx = mine[0].txHash as string;
  const batch = (await fetchAnnouncements({ apiUrl: API, fromBlock: since })).announcements.filter((a) => a.txHash.toLowerCase() === payTx.toLowerCase());
  const sum = mine.reduce((s: number, p: any) => s + Number(p.balanceUsdc), 0);
  console.log(`  the pay run has ${batch.length} lines; ${c.green(`${mine.length} are mine, ${+sum.toFixed(6)} USDC`)}. The rest are not mine to see.`);
  for (const p of mine) console.log(`  ${c.green(`+${p.balanceUsdc} USDC`)} at ${p.stealthAddress} ${c.dim(`(${scan.matches} payments to this agent so far)`)}`);

  // 2. Spend gaslessly: plan (consolidation guard), then confirm. Gas is sponsored on the testnet.
  say(`spend ${SPEND_USDC} USDC to ${SPEND_TO}`);
  const plan = await call(agent, "spend", { to: SPEND_TO, amount: SPEND_USDC });
  if (!plan.planId) throw new Error(`guard ${plan.decision}: ${plan.reason}`);
  console.log(`  guard: ${plan.decision}${plan.warnings?.length ? ` (${plan.warnings.map((w: any) => w.code).join(", ")})` : ""} · ${plan.userOps} userOp, max fee ${plan.maxFeesUsdc} USDC${Number(plan.maxFeesUsdc) === 0 ? " (gas sponsored on this testnet)" : " paid in USDC"}, no ETH`);
  if (process.env.SPEND_DRY) {
    console.log(c.dim("  SPEND_DRY set: not confirming."));
    return;
  }
  const done = await call(agent, "spend", { confirm: plan.planId });
  for (const r of done.results) console.log(`  ${r.status === "sent" ? c.green("sent") : r.status}  ${r.txHash ? explorer(r.txHash) : (r.userOpHash ?? r.error ?? "")}`);
  if (!done.ok) throw new Error("spend did not complete");
}

const agent = await connect();
try {
  await (command === "claim" ? claim(agent) : receive(agent));
} finally {
  await agent.close().catch(() => undefined);
}
