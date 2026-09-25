import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { createPublicClient, createWalletClient, http, isAddress, isHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { ERC6538RegistryAbi } from "@scopelift/stealth-address-sdk";
import { getChainConfig, type RelayRequest } from "@soapay/sdk";

// M1: registration relayer (registerKeysOnBehalf) so the registrant never needs ETH and the
//     employee's wallet never sends a public transaction. Dev key only; hosted relayer later.
// M1: static CCIP-Read records for platform subnames (*.soapay.eth).
// M3: derivation from viewing key + counter, signed responses, announce-at-resolve.
const cfg = getChainConfig({
  CHAIN_ID: process.env.CHAIN_ID,
  RPC_URL: process.env.RPC_URL,
});
const app = new Hono();

app.use("*", cors({ origin: (process.env.CORS_ORIGINS ?? "http://localhost:5173,http://localhost:5174").split(",") }));

app.get("/health", (c) => c.json({ ok: true, chainId: cfg.chainId, relayer: Boolean(process.env.RELAYER_PRIVATE_KEY) }));

app.post("/relay", async (c) => {
  const pk = process.env.RELAYER_PRIVATE_KEY;
  if (!pk || !isHex(pk) || pk.length !== 66) {
    return c.json({ error: "Relayer not configured: set RELAYER_PRIVATE_KEY for apps/gateway" }, 503);
  }
  let body: RelayRequest;
  try {
    body = (await c.req.json()) as RelayRequest;
  } catch {
    return c.json({ error: "Invalid JSON" }, 400);
  }
  if (
    !body ||
    !isAddress(body.registrant) ||
    body.schemeId !== 1 ||
    !isHex(body.stealthMetaAddress) ||
    body.stealthMetaAddress.length !== 134 ||
    !isHex(body.signature)
  ) {
    return c.json({ error: "Invalid relay request" }, 400);
  }
  const account = privateKeyToAccount(pk);
  const publicClient = createPublicClient({ chain: cfg.chain, transport: http(cfg.rpcUrl) });
  const wallet = createWalletClient({ account, chain: cfg.chain, transport: http(cfg.rpcUrl) });
  try {
    const { request } = await publicClient.simulateContract({
      account,
      address: cfg.registry,
      abi: ERC6538RegistryAbi,
      functionName: "registerKeysOnBehalf",
      args: [body.registrant, 1n, body.signature, body.stealthMetaAddress],
    });
    const txHash = await wallet.writeContract(request);
    return c.json({ txHash });
  } catch (e) {
    const msg = (e as Error).message.split("\n")[0];
    return c.json({ error: `Relay submit failed: ${msg}` }, 502);
  }
});

const port = Number(process.env.PORT ?? 8787);
serve({ fetch: app.fetch, port });
console.log(`gateway listening on :${port} (chain ${cfg.chainId}, relayer ${process.env.RELAYER_PRIVATE_KEY ? "on" : "off"})`);
