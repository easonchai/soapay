/** Testnet funds for the agent's payer wallet (Base Sepolia only, D-52): the API's welcome drop. */
import { explorerTx } from "@soapay/sdk";
import { ApiError, type Ctx } from "../context.js";
import { formatUsdc, ToolError } from "../util.js";

/** The chain the mock token and the faucet live on. */
export const TEST_FUNDS_CHAIN_ID = 84532;

export async function getTestFunds(ctx: Ctx) {
  if (ctx.config.chainId !== TEST_FUNDS_CHAIN_ID) throw new ToolError("not_testnet", "Test funds exist only on Base Sepolia (84532).");
  const payer = ctx.payer;
  if (!payer) throw new ToolError("no_payer", "AGENT_PAYER_PRIVATE_KEY is not set, so there is no payer wallet to fund.");
  let r;
  try {
    r = await ctx.api.faucet(payer);
  } catch (e) {
    if (e instanceof ApiError && e.status === 503) throw new ToolError("faucet_disabled", "The Soapay API's test-funds drop is off.");
    if (e instanceof ApiError && e.status === 429) throw new ToolError("faucet_limited", e.message);
    throw e;
  }
  if (r.status === "already_claimed") {
    return { status: "already_claimed", payer, note: "This payer already received its one-time test USDC. Check `whoami` for its balance." };
  }
  return {
    status: "sent",
    payer,
    usdc: formatUsdc(BigInt(r.usdc.amount)),
    tx: explorerTx(ctx.config.chainId, r.usdc.txHash) ?? r.usdc.txHash,
    ...(r.eth ? { eth: r.eth.amount, ethTx: explorerTx(ctx.config.chainId, r.eth.txHash) ?? r.eth.txHash } : {}),
    note: "Soapay test USDC (a mock token on Base Sepolia). Paying through StealthDisperse still needs a little Base Sepolia ETH for gas.",
  };
}
