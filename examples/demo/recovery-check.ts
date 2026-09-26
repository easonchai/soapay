// End-to-end proof of the recovery beat, without a browser (docs/demo-flow.md). Entry point:
// scripts/demo-recovery-check.ts. LIVE: it sends Sepolia and Base Sepolia transactions.
//
//   pnpm demo:recovery-check [label]     default: sam-demo
//
// 1. pin:     resolve <label>.soapay.eth and pin its meta-address, with the SDK's pin logic (the same
//             checkMetaPin + attestation lookup the company app and `soapay distribute` run)
// 2. attack:  the attacker simulation rewrites the name with the stolen registrant key
// 3. re-check: must be BLOCKED (meta changed, no valid World ID attestation)
// 4. restore: the victim's meta-address goes back; the pin matches again
// If apps/cli is built, `soapay distribute` (dry run) is run against the same pin file at each step
// and must exit 0 / 3 (pin alert) / 0. Exits non-zero if any check fails; always tries to restore.
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  applyPinDecision,
  checkMetaPin,
  emptyPinBook,
  httpRotationAttestationSource,
  parsePinBook,
  PARENT_NAME,
  pinKey,
  resolveStealthMeta,
  rotationAttestationLookup,
  type PinDecision,
  type RegistryReader,
} from "@soapay/sdk";
import { baseClient, CHAIN_ID, ensClient } from "./claim.js";
import { c, REPO, short } from "./local.js";
import { API_URL, DEFAULT_VICTIM, DRY, hijack, restore, stolenPhrase, type TxLink } from "./recovery.js";

if (DRY) {
  console.error("demo-recovery-check is a live check; unset DEMO_DRY");
  process.exit(2);
}
const label = (process.argv[2] ?? DEFAULT_VICTIM).toLowerCase();
const name = `${label}.${PARENT_NAME}`;
// The attester the payer PINS (never taken from the API response): the testnet deployment's.
const ATTESTER = process.env.SOAPAY_ATTESTER ?? "0x62377F8ad1151f5b1917708FFD67220F37dF2574";

const dir = mkdtempSync(join(tmpdir(), "soapay-recovery-check-"));
const csv = join(dir, "payroll.csv");
const pinFile = join(dir, ".soapay", "pins.json");
writeFileSync(csv, `recipient,amount\n${name},1\n`);
mkdirSync(join(dir, ".soapay"), { recursive: true });

const lookup = rotationAttestationLookup({ attester: ATTESTER, chainId: CHAIN_ID, source: httpRotationAttestationSource(API_URL) });
const failures: string[] = [];
const expect = (ok: boolean, what: string) => {
  console.log(`  ${ok ? c.green("PASS") : "FAIL"}  ${what}`);
  if (!ok) failures.push(what);
};

/** The company app's check: resolve, compare with the pin, look up an attestation if it moved. */
async function sdkCheck(): Promise<PinDecision> {
  const book = existsSync(pinFile) ? parsePinBook(readFileSync(pinFile, "utf8")) : emptyPinBook();
  const r = await resolveStealthMeta({ ensClient, baseClient: baseClient as unknown as RegistryReader, name });
  const decision = await checkMetaPin({ identifier: name, pin: book.pins[pinKey(name)], resolvedMeta: r.metaAddressURI, lookup });
  const next = applyPinDecision(book, { identifier: name, resolved: { metaAddressURI: r.metaAddressURI, registrant: r.registrant, source: "ens" }, decision, now: Date.now() });
  if (next !== book) writeFileSync(pinFile, `${JSON.stringify(next, null, 2)}\n`);
  const detail = decision.state === "blocked" ? `: ${decision.attestation.state}, "${decision.attestation.reason}"` : "";
  console.log(`  sdk   ${name} → ${short(r.metaAddressURI)}: ${c.cyan(decision.state)}${detail}`);
  return decision;
}

/**
 * `soapay distribute` dry run over the same pin file; returns its exit code (null when not built).
 * Retries a couple of times when the code isn't `expected`: load-balanced public RPCs can briefly
 * serve a node that hasn't seen the latest write on one of the two chains.
 */
async function cliCheck(expected: number): Promise<number | null> {
  const bin = resolve(REPO, "apps/cli/dist/index.js");
  if (!existsSync(bin)) return null;
  let status: number | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt) await new Promise((r) => setTimeout(r, 6_000));
    const res = spawnSync(process.execPath, [bin, "distribute", "--csv", csv, "--asset", "USDC", "--pins", pinFile, "--api", API_URL, "--attester", ATTESTER], {
      encoding: "utf8",
      env: { ...process.env, PAYER_PRIVATE_KEY: "" },
    });
    const lines = `${res.stdout}${res.stderr}`.split("\n");
    const first = lines.find((l) => /ALERT|pins |error/i.test(l)) ?? lines[0];
    console.log(`  cli   soapay distribute (dry run) exit ${res.status}: ${c.dim((first ?? "").trim())}`);
    status = res.status;
    if (status === expected) break;
  }
  return status;
}

const links: TxLink[] = [];
let attacked = false;
try {
  const phrase = stolenPhrase(label);
  console.log(c.bold(`Recovery check: ${name}, API ${API_URL}, pinned attester ${ATTESTER}`));
  console.log(c.dim(`  work dir ${dir}`));

  // Start clean: the name must be on the victim's own keys.
  links.push(...(await restore(label, phrase)));

  console.log(c.bold("\n1. Pin"));
  const first = await sdkCheck();
  expect(first.state === "new" || first.state === "ok", "first resolve pins the meta-address");
  const again = await sdkCheck();
  expect(again.state === "ok", "resolves to the pinned meta-address");
  const cli1 = await cliCheck(0);
  if (cli1 !== null) expect(cli1 === 0, "soapay distribute accepts the pinned name (exit 0)");

  console.log(c.bold("\n2. Attack"));
  attacked = true;
  const r = await hijack(label, phrase, { probeApi: true });
  links.push(...r.txs);
  expect("code" in r.api && r.api.status >= 400, `the API refuses to attest without a World ID proof (${"code" in r.api ? r.api.code : "skipped"})`);

  console.log(c.bold("\n3. Re-check"));
  const after = await sdkCheck();
  expect(after.state === "blocked", "the changed meta-address is BLOCKED");
  expect(after.state === "blocked" && after.attestation.state === "missing", "because no valid World ID attestation covers the change");
  const cli2 = await cliCheck(3);
  if (cli2 !== null) expect(cli2 === 3, "soapay distribute stops with a pin alert (exit 3), nothing sent");

  console.log(c.bold("\n4. Restore"));
  links.push(...(await restore(label, phrase)));
  attacked = false;
  const back = await sdkCheck();
  expect(back.state === "ok", "after restore the name matches its pin again");
  const cli3 = await cliCheck(0);
  if (cli3 !== null) expect(cli3 === 0, "soapay distribute accepts it again (exit 0)");
} catch (e) {
  failures.push((e instanceof Error ? e.message : String(e)).split("\n")[0]!);
  console.error(`demo-recovery-check: ${failures.at(-1)}`);
  if (attacked) {
    try {
      links.push(...(await restore(label, stolenPhrase(label))));
    } catch (e2) {
      console.error(`restore failed too; run: pnpm demo:attacker ${label} --restore (${(e2 instanceof Error ? e2.message : String(e2)).split("\n")[0]})`);
    }
  }
}

console.log(c.bold("\nTransactions"));
for (const t of links) console.log(`  ${t.what.padEnd(34)} ${t.url}`);
console.log(failures.length ? `\nFAILED: ${failures.length} check(s)` : c.green("\nAll checks passed: a stolen phrase rewrote the record, and the payer's pin check blocked it."));
process.exit(failures.length ? 1 : 0);
