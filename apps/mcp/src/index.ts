/**
 * Soapay MCP server over stdio (docs/mvp-spec.md §8). stdout carries MCP; logs go to stderr.
 * Keys come only from env (AGENT_MNEMONIC, AGENT_PAYER_PRIVATE_KEY) and never leave this process.
 */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { privateKeyToAddress } from "viem/accounts";
import { keysFromMnemonic } from "@soapay/sdk";
import { loadConfig } from "./config.js";
import type { Ctx } from "./context.js";
import { Caps, PlanStore } from "./guardrails.js";
import { liveApi, liveChain } from "./live.js";
import { stderrLogger } from "./log.js";
import { createServer } from "./server.js";
import { fileStateStore } from "./state.js";

async function main() {
  const log = stderrLogger();
  const { config, secrets } = loadConfig(process.env);
  const state = fileStateStore(config.stateDir);
  const ctx: Ctx = {
    config,
    log,
    state,
    caps: new Caps(config, state),
    plans: new PlanStore(config.planTtlSeconds),
    chain: liveChain(config, secrets),
    api: liveApi(config),
    keys: secrets.mnemonic ? keysFromMnemonic(secrets.mnemonic) : undefined,
    payer: secrets.payerKey ? privateKeyToAddress(secrets.payerKey) : undefined,
    now: () => Math.floor(Date.now() / 1000),
    spendDelayMs: 4_000,
  };
  const server = createServer(ctx);
  await server.connect(new StdioServerTransport());
  log.info("soapay mcp ready", {
    chainId: config.chainId,
    api: config.apiUrl,
    recipient: Boolean(ctx.keys),
    payer: ctx.payer ?? null,
    stateDir: config.stateDir,
  });
}

main().catch((e: unknown) => {
  process.stderr.write(`soapay mcp: ${(e as Error)?.message ?? e}\n`);
  process.exit(1);
});
