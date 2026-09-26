// One-time setup for the "plug it into anything" demo: gives each demo dividend holder a soapay
// name, the same way the recipient app does (sponsored ERC-6538 registration through the API
// relayer, then an ENSv2 subname claim), and writes examples/demo/holders.csv.
//
//   SOAPAY_API=http://localhost:8787 pnpm --filter @soapay/examples demo:setup
//
// Idempotent: names that already belong to the holder are skipped. Phrases stay in the git-ignored
// scripts/.demo-recipients.local.json and are never printed.
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { PARENT_NAME } from "@soapay/sdk";
import { nameClaimer } from "./claim.js";
import { c, loadOrCreateLocal, metaOf, REPO } from "./local.js";

const API = (process.env.SOAPAY_API ?? "http://localhost:8787").replace(/\/+$/, "");
const { claim, verify } = nameClaimer(API);

const local = loadOrCreateLocal();
console.log(c.bold(`Demo holders (API ${API})`));
for (const h of local.holders) await claim(h.label, h.phrase);
for (const h of local.holders) await verify(h.label, h.phrase);

// The AI agent is a holder like the others: one pay run, indistinguishable lines. Its name is
// claimed by `demo:pluggable-agent claim` (through the MCP server), which the demo script runs first.
const rows = [
  "# Revenue-share register for the Soapay demo (public data only): three people, one raw meta-address, one AI agent.",
  "# recipient = a soapay name (resolved on ENSv2, cross-checked against ERC-6538) or a raw meta-address.",
  "recipient,holdings,id",
  ...local.holders.map((h, i) => `${h.label}.${PARENT_NAME},${[4000, 2500, 1500][i] ?? 1000},${h.label.replace(/^dividend-/, "")}`),
  `${metaOf(local.rawHolder.phrase)},500,${local.rawHolder.id}`,
  `${local.agent.label}.${PARENT_NAME},1500,${local.agent.label}`,
];
const csvPath = resolve(REPO, "examples/demo/holders.csv");
writeFileSync(csvPath, `${rows.join("\n")}\n`);
console.log(`Wrote ${csvPath}`);
