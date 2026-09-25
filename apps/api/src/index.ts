import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { SOAPAY_CHAIN } from "@soapay/sdk";

// M1: static CCIP-Read records for platform subnames (*.soapay.eth).
// M3: derivation from viewing key + counter, signed responses, announce-at-resolve.
const app = new Hono();

app.get("/health", (c) => c.json({ ok: true, chainId: SOAPAY_CHAIN.id }));

const port = Number(process.env.PORT ?? 8787);
serve({ fetch: app.fetch, port });
console.log(`gateway listening on :${port}`);
