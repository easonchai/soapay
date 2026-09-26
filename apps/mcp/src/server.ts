import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { Ctx } from "./context.js";
import { redactString } from "./log.js";
import { createAgentIdentity, resolveName, whoami } from "./tools/identity.js";
import { pay } from "./tools/pay.js";
import { balance, scan } from "./tools/receive.js";
import { spend } from "./tools/spend.js";
import { swapInPlace } from "./tools/swap.js";
import { getTestFunds, TEST_FUNDS_CHAIN_ID } from "./tools/funds.js";
import { defaultPaymasterMode } from "@soapay/sdk";
import { errorMessage, plain, toJson, ToolError } from "./util.js";

export const SERVER_NAME = "soapay";
export const SERVER_VERSION = "0.1.0";

const amount = z
  .union([z.string().regex(/^\d+(\.\d{1,6})?$/, "a USDC amount like \"2\" or \"2.5\" (max 6 decimals)"), z.number().positive().finite()])
  .describe('USDC amount, e.g. "2.5"');
const ensName = z.string().min(3).max(255).describe("ENS name, e.g. alice.soapay.eth");
const planId = z.string().regex(/^[a-z]+_[0-9a-f]{24}$/, "a planId from a dry run");
const dryRun = z.boolean().default(true).describe("Always plans only; executing needs a second call with `confirm`");

async function run(ctx: Ctx, tool: string, fn: () => Promise<object>): Promise<CallToolResult> {
  try {
    const out = await fn();
    return { content: [{ type: "text", text: toJson(out) }], structuredContent: plain(out) as Record<string, unknown> };
  } catch (e) {
    const err =
      e instanceof ToolError
        ? { code: e.code, message: redactKeys(e.message), ...(e.details ? { details: plain(e.details) } : {}) }
        : { code: "internal", message: redactKeys(errorMessage(e)) };
    ctx.log.warn(`${tool} failed`, { code: err.code, message: err.message });
    return { isError: true, content: [{ type: "text", text: toJson({ error: err }) }] };
  }
}

/** Belt and braces: nothing key-sized ever leaves in an error message. */
function redactKeys(s: string): string {
  return s.replace(/0x[0-9a-fA-F]{64,}/g, (m) => (m.length === 66 ? "[redacted]" : m)).replace(/^([a-z]+ ){11,}[a-z]+$/, redactString);
}

export function createServer(ctx: Ctx): McpServer {
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    {
      instructions:
        "Soapay: private USDC payments to ENS names on Base via stealth addresses. Value-moving tools (pay, spend, swap_in_place) " +
        "always return a plan first; execute by calling the same tool again with { confirm: planId } within 10 minutes. " +
        "Per-call and per-day caps apply, and the consolidation guard's block cannot be overridden.",
    },
  );

  server.registerTool(
    "whoami",
    {
      title: "Who am I",
      description: "The agent's Soapay name, stealth meta-address, payer address with its USDC/ETH balances, and the remaining caps.",
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    () => run(ctx, "whoami", () => whoami(ctx)),
  );

  server.registerTool(
    "resolve_name",
    {
      title: "Resolve a name",
      description: "Resolve an ENS name (ENSv2 on Sepolia) to its stealth meta-address, cross-checked against the ERC-6538 registry on Base.",
      inputSchema: { name: ensName },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    ({ name }) => run(ctx, "resolve_name", () => resolveName(ctx, { name })),
  );

  server.registerTool(
    "create_agent_identity",
    {
      title: "Create agent identity",
      description:
        "Register this agent's stealth meta-address (sponsored ERC-6538) and claim <label>.soapay.eth with ENSIP-26 agent records " +
        "(agent-context, agent-endpoint[...]). Idempotent for a label this agent already owns.",
      inputSchema: {
        label: z.string().regex(/^[a-z0-9-]{3,32}$/, "3-32 of [a-z0-9-]").describe("Subname label, e.g. ledger-bot"),
        description: z.string().min(1).max(500).optional().describe("What the agent does (goes into agent-context)"),
        capabilities: z.array(z.string().min(1).max(40)).max(16).optional().describe("Short capability tags, e.g. [\"pay\",\"invoice\"]"),
        endpoints: z
          .record(z.string().regex(/^[a-z0-9][a-z0-9-]{0,31}$/), z.string().url().max(512))
          .optional()
          .describe("ENSIP-26 agent-endpoint[<protocol>] URLs, e.g. { mcp: \"https://…\", web: \"https://…\" }"),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    (input) => run(ctx, "create_agent_identity", () => createAgentIdentity(ctx, input)),
  );

  server.registerTool(
    "pay",
    {
      title: "Pay names",
      description:
        "Pay one or more names in USDC as one private pay run through StealthDisperse. First call returns a plan (lines, total, txs, gas) " +
        "and a planId; nothing is sent. Call again with { confirm: planId } to execute. Names are pinned on first use.",
      inputSchema: {
        payments: z.array(z.object({ name: ensName, amount })).min(1).max(350).optional(),
        dry_run: dryRun,
        confirm: planId.optional().describe("planId from a dry run: executes that exact plan"),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    },
    (input) => run(ctx, "pay", () => pay(ctx, input)),
  );

  server.registerTool(
    "scan",
    {
      title: "Scan received payments",
      description: "Find payments to this agent's stealth addresses: real on-chain USDC balances, payer, and ledger flags.",
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    () => run(ctx, "scan", () => scan(ctx)),
  );

  server.registerTool(
    "balance",
    {
      title: "Balance",
      description: "Total received USDC, grouped into clusters of addresses already linked on-chain.",
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    () => run(ctx, "balance", () => balance(ctx)),
  );

  server.registerTool(
    "spend",
    {
      title: "Spend received USDC",
      description:
        `Send received USDC to an address or a name. ${
          defaultPaymasterMode(ctx.config.chainId) === "sponsored"
            ? "Gas is sponsored on this testnet (7702 + a sponsoring paymaster)"
            : "Gas is paid in USDC (7702 + paymaster)"
        }, one userOp per source address. ` +
        "The dry run returns the consolidation guard's decision: `block` cannot be overridden; `warn` needs your judgement before confirming.",
      inputSchema: {
        to: z.string().min(3).max(255).optional().describe("0x address or ENS name"),
        amount: amount.optional(),
        dry_run: dryRun,
        confirm: planId.optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    },
    (input) => run(ctx, "spend", () => spend(ctx, input)),
  );

  server.registerTool(
    "swap_in_place",
    {
      title: "Swap in place",
      description:
        "Swap received USDC in one stealth address into ETH or a token that stays in the same address (Uniswap; neither Soapay nor Uniswap sees the stealth address). " +
        "Dry run first, then { confirm: planId }; the confirm refuses to go below the dry run's minimum output.",
      inputSchema: {
        tokenOut: z.string().min(3).max(42).optional().describe('"ETH" or a token address'),
        amount: amount.optional(),
        slippage_bps: z.number().int().min(0).max(500).optional(),
        dry_run: dryRun,
        confirm: planId.optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    },
    (input) => run(ctx, "swap_in_place", () => swapInPlace(ctx, input)),
  );

  // Base Sepolia only: the payer wallet's one-time test USDC (D-52). Not listed elsewhere.
  if (ctx.config.chainId === TEST_FUNDS_CHAIN_ID) {
    server.registerTool(
      "get_test_funds",
      {
        title: "Get test funds",
        description:
          "Base Sepolia only: ask the Soapay API's welcome drop for test USDC (Soapay's mock token) for this agent's payer wallet. " +
          "Once per address; a second call reports already_claimed.",
        inputSchema: {},
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
      },
      () => run(ctx, "get_test_funds", () => getTestFunds(ctx)),
    );
  }

  return server;
}
