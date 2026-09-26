// Attacker simulation for the World ID recovery beat (docs/demo-flow.md, D-55). Entry point:
// scripts/demo-attacker.ts.
//
//   pnpm demo:attacker [label]            hijack <label>.soapay.eth (default sam-demo)
//   pnpm demo:attacker [label] --restore  put the victim's own meta-address back
//
// Flags: --ens-only (skip the ERC-6538 rewrite; the payer then sees "record disagrees with the
// registry" instead of a pin change), --no-api (don't ask the API for an attestation).
// Env: DEMO_DRY=1 (no transactions), DEMO_VICTIM_PHRASE (else scripts/.demo-recipients.local.json),
// API_URL, ENS_RPC_URL, RPC_URL, SOAPAY_ENV_ROOT (where contracts/.env and apps/api/.env live).
//
// The stolen phrase and the attacker's fresh phrase are never printed or written.
import { c } from "./local.js";
import { API_URL, DEFAULT_VICTIM, DRY, hijack, restore, stolenPhrase } from "./recovery.js";

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith("--")));
const unknown = [...flags].filter((f) => !["--restore", "--ens-only", "--no-api"].includes(f));
if (unknown.length) {
  console.error(`unknown flag ${unknown.join(" ")}; usage: demo-attacker [label] [--restore] [--ens-only] [--no-api]`);
  process.exit(2);
}
const label = (args.find((a) => !a.startsWith("--")) ?? DEFAULT_VICTIM).toLowerCase();

try {
  const phrase = stolenPhrase(label);
  console.log(c.bold(`Soapay attacker simulation${DRY ? " (DEMO_DRY: nothing is sent)" : ""}`) + c.dim(`  API ${API_URL}`));
  if (flags.has("--restore")) {
    await restore(label, phrase);
    console.log(`\n${label} is back on its own keys. The payer's pin matches again.`);
  } else {
    const r = await hijack(label, phrase, { ensOnly: flags.has("--ens-only"), probeApi: !flags.has("--no-api") });
    const refused = "skipped" in r.api ? `not asked (${r.api.skipped})` : `refused (${r.api.code})`;
    console.log("");
    console.log(c.bold("Summary"));
    for (const t of r.txs) console.log(`  ${t.what.padEnd(34)} ${t.url}`);
    console.log(`${DRY ? "Record rewrite planned (dry run)." : "Record rewritten on-chain ✓."} Attestation: ${refused}. At the next pay run, the company app will block ${label}'s line.`);
    console.log(c.dim(`Undo with: pnpm demo:attacker ${label} --restore`));
  }
} catch (e) {
  console.error(`demo-attacker: ${(e instanceof Error ? e.message : String(e)).split("\n")[0]}`);
  process.exit(1);
}
