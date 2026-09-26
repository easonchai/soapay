// Setup for the World ID recovery beat (docs/demo-flow.md). Entry point: scripts/demo-setup-recovery.ts.
//
//   pnpm demo:setup-recovery [label...]     default: sam-demo
//
// Claims each demo employee's name through the live API (API_URL, default the Railway deployment), the
// same way the recipient app does, and stores its recovery phrase ONLY in the git-ignored
// scripts/.demo-recipients.local.json (mode 0600, merged: other entries are kept). Idempotent. Prints
// names and addresses only.
//
// Linking World ID to a name needs the owner's real World App, so it is a manual step. For a name
// that will rotate with World ID on stage (alex-demo), claim it in the recipient app WITH World ID:
// a session attached later can only back a rotation after the 72 h attach cooldown.
import { generateMnemonic, keysFromMnemonic, PARENT_NAME, isValidLabel } from "@soapay/sdk";
import { nameClaimer } from "./claim.js";
import { c, LOCAL_FILE, readLocalRaw, recoveryEntries, short, writeLocalRaw, type RecoveryEntry } from "./local.js";
import { API_URL, DEFAULT_VICTIM } from "./recovery.js";

const labels = process.argv.slice(2).filter((a) => !a.startsWith("--"));
if (!labels.length) labels.push(DEFAULT_VICTIM);
for (const l of labels) if (!isValidLabel(l)) throw new Error(`invalid label ${l}`);

// 1. A phrase per label: reuse the stored one, or make one and save it before anything else happens.
const entries: RecoveryEntry[] = recoveryEntries();
let added = false;
for (const label of labels) {
  if (entries.some((e) => e.label === label)) continue;
  entries.push({ label, phrase: generateMnemonic() });
  added = true;
}
if (added) writeLocalRaw({ ...readLocalRaw(), recovery: entries });

// 2. Claim through the API, then wait until each name resolves (ENS stealth = ERC-6538).
const { claim, verify } = nameClaimer(API_URL);
console.log(c.bold(`Recovery-beat employees (API ${API_URL})`));
for (const label of labels) await claim(label, entries.find((e) => e.label === label)!.phrase);
for (const label of labels) await verify(label, entries.find((e) => e.label === label)!.phrase);

console.log("");
for (const label of labels) {
  const k = keysFromMnemonic(entries.find((e) => e.label === label)!.phrase);
  console.log(`  ${`${label}.${PARENT_NAME}`.padEnd(28)} registrant ${k.registrantAddress}  meta ${short(k.metaAddressURI)}`);
}
console.log(c.dim(`Phrases: ${LOCAL_FILE} (git-ignored, 0600). Never printed.`));
console.log(c.dim("Manual: add these names in the company app's Recipients (resolve + pin). World ID needs a real World App."));
