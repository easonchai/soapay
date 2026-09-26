// Seeds the demo company, "Meridian Labs": ten onboarded employees, so the live pay run shows real
// unlinkability (a batch of identical lines to fresh addresses; a coworker can't tell whose is whose).
// Entry point: scripts/demo-seed-company.ts.
//
//   pnpm demo:seed-company [--dry]
//
// For each employee: a fresh recovery phrase, a sponsored ERC-6538 registration (POST /register) and a
// `<label>.soapay.eth` claim (POST /names) through the live API (API_URL, default the Railway
// deployment), the same code path as demo:setup-recovery. No World ID: it needs a real World App.
// If the relayer rate-limits registrations (3 per IP per hour), a demo funder submits the same signed
// registration and pays the gas (see selfRegister). Idempotent: labels already ours (in the local file)
// are re-checked, never re-created; a label taken by someone else gets a numbered variant (maya-ml2).
//
// Writes (all git-ignored; phrases and keys are never printed):
//   scripts/.demo-company.local.json       phrases, mode 0600
//   scripts/maya-ml.recovery-kit.local.txt  the coworker persona's kit (the employee app's own format)
//   scripts/.demo-roster.local.csv         the company app's roster import (name,amount,label)
// --dry only checks availability and prints the plan; it writes nothing.
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createWalletClient, http } from "viem";
import {
  buildRegisterKeysOnBehalfCall,
  ERC6538_REGISTRY,
  erc6538RegistryMinimalAbi,
  generateMnemonic,
  parseMetaAddress,
  isValidLabel,
  MAX_LINES_PER_TX,
  PARENT_NAME,
  planDenominatedRun,
  resolveStealthMeta,
  type RegistryReader,
} from "@soapay/sdk";
import { BASE_RPC_URL, baseClient, ensClient, nameClaimer, type SelfRegister } from "./claim.js";
import { c, REPO } from "./local.js";
import { API_URL, funders } from "./recovery.js";

const DRY = process.argv.includes("--dry");
const COMPANY = "Meridian Labs";
const COMPANY_FILE = process.env.SOAPAY_COMPANY_FILE ?? resolve(REPO, "scripts/.demo-company.local.json");
const ROSTER_FILE = resolve(REPO, "scripts/.demo-roster.local.csv");
/** The coworker persona: the presenter restores her kit in a second browser profile. */
const COWORKER = "maya";

/**
 * Monthly salaries in whole USDC. All multiples of 250: with 500 USDC chunks every line is 500 except a
 * few 250 remainders, and each remainder amount appears several times, so no line amount is unique.
 */
const EMPLOYEES: { key: string; display: string; salary: number }[] = [
  { key: "maya", display: "Maya Okafor (Design)", salary: 5250 },
  { key: "lena", display: "Lena Fischer (Engineering)", salary: 6500 },
  { key: "ben", display: "Ben Carter (Support)", salary: 4750 },
  { key: "cleo", display: "Cleo Martin (Engineering)", salary: 7000 },
  { key: "dan", display: "Dan Reyes (Operations)", salary: 4000 },
  { key: "eve", display: "Eve Laurent (Product)", salary: 5750 },
  { key: "finn", display: "Finn Walsh (Marketing)", salary: 4250 },
  { key: "gia", display: "Gia Romano (Engineering)", salary: 6250 },
  { key: "hugo", display: "Hugo Brandt (Finance)", salary: 4500 },
  { key: "ines", display: "Ines Duarte (People)", salary: 5500 },
];
/** Already claimed for the recovery/thief beat (demo:setup-recovery); goes on the roster as-is. */
const EXTRA_ROWS = [{ name: `sam-demo.${PARENT_NAME}`, salary: 6000, display: "Sam Ito (Sales)" }];
/** The chunk size the summary recommends for this roster (Settings → chunk size). */
const RECOMMENDED_CHUNK = 500;

type Stored = { key: string; label: string; phrase: string };
type CompanyFile = { company: string; employees: Stored[] };

function readCompany(): CompanyFile {
  if (!existsSync(COMPANY_FILE)) return { company: COMPANY, employees: [] };
  const raw = JSON.parse(readFileSync(COMPANY_FILE, "utf8")) as Partial<CompanyFile>;
  return { company: raw.company ?? COMPANY, employees: Array.isArray(raw.employees) ? raw.employees : [] };
}

function writePrivate(path: string, text: string): void {
  writeFileSync(path, text, { mode: 0o600 });
  chmodSync(path, 0o600);
}

/**
 * When the API relayer rate-limits registrations (3 per IP per hour), a demo funder submits the same
 * signed `registerKeysOnBehalf` and pays the gas (DEMO_BASE_FUNDER_PRIVATE_KEY, or the deployer key in
 * contracts/.env under SOAPAY_ENV_ROOT). Never the API's own relayer key: sharing its nonce races the API.
 */
const selfRegister: SelfRegister = async ({ registrant, metaAddressURI, signature }) => {
  const funder = funders("base-sepolia").find((f) => !f.source.includes("apps/api"));
  if (!funder) throw new Error("POST /register is rate-limited and no demo funder is configured: set DEMO_BASE_FUNDER_PRIVATE_KEY or SOAPAY_ENV_ROOT, or retry within the hour");
  const call = buildRegisterKeysOnBehalfCall({ registrant, metaAddressURI, signature });
  const wallet = createWalletClient({ account: funder.account, chain: baseClient.chain, transport: http(BASE_RPC_URL, { retryCount: 3 }) });
  const hash = await wallet.sendTransaction({ to: call.to, data: call.data });
  const receipt = await baseClient.waitForTransactionReceipt({ hash, timeout: 180_000 });
  if (receipt.status !== "success") throw new Error(`registerKeysOnBehalf reverted: ${hash}`);
  // POST /names re-reads the registry, through a load-balanced RPC, and only retries at the landed
  // block for registrations it relayed itself. Wait until a fresh read sees ours, then a little longer,
  // so the claim isn't rejected (and a names:ip rate-limit slot wasted) on read-after-write lag.
  const want = parseMetaAddress(metaAddressURI).toLowerCase();
  for (let i = 0; i < 30; i++) {
    const got = await baseClient
      .readContract({ address: ERC6538_REGISTRY, abi: erc6538RegistryMinimalAbi, functionName: "stealthMetaAddressOf", args: [registrant, 1n] })
      .catch(() => "0x");
    if (String(got).toLowerCase() === want) break;
    await new Promise((r) => setTimeout(r, 2_000));
  }
  await new Promise((r) => setTimeout(r, 20_000));
  return hash;
};

const { api, claim, verify } = nameClaimer(API_URL, { selfRegister, waitOnNamesLimit: true });

/** Free = no API row and nothing resolving on-chain (another deployment could have issued it). */
async function isFree(label: string): Promise<boolean> {
  const got = await api(`/names/${label}`);
  if (got.status === 200) return false;
  if (got.status !== 404) throw new Error(`GET /names/${label}: ${got.body?.error?.message ?? got.status}`);
  const onchain = await resolveStealthMeta({ ensClient, baseClient: baseClient as unknown as RegistryReader, name: `${label}.${PARENT_NAME}` }).catch(() => null);
  return !onchain;
}

/** `<key>-ml`, else `<key>-ml2`, `<key>-ml3`, ... The first free one; null if none within reason. */
async function pickLabel(key: string, taken: Set<string>): Promise<string | null> {
  for (let i = 1; i <= 9; i++) {
    const label = `${key}-ml${i === 1 ? "" : i}`;
    if (!isValidLabel(label) || taken.has(label)) continue;
    if (await isFree(label)) return label;
    console.log(`  ${`${label}.${PARENT_NAME}`.padEnd(28)} ${c.dim("taken by someone else, trying a variant")}`);
  }
  return null;
}

console.log(c.bold(`${COMPANY}: seeding ${EMPLOYEES.length} employees (API ${API_URL})${DRY ? c.dim("  [dry run]") : ""}`));

// 1. Pick a label per employee: the stored one, or the first free variant. Save new phrases first.
const file = readCompany();
const used = new Set(file.employees.map((e) => e.label));
const plan: { key: string; label: string; status: "ours" | "new" }[] = [];
for (const emp of EMPLOYEES) {
  const stored = file.employees.find((e) => e.key === emp.key);
  if (stored) {
    plan.push({ key: emp.key, label: stored.label, status: "ours" });
    continue;
  }
  const label = await pickLabel(emp.key, used);
  if (!label) throw new Error(`no free label for ${emp.key} (tried ${emp.key}-ml .. ${emp.key}-ml9)`);
  used.add(label);
  plan.push({ key: emp.key, label, status: "new" });
  if (!DRY) file.employees.push({ key: emp.key, label, phrase: generateMnemonic() });
}
if (!DRY) writePrivate(COMPANY_FILE, `${JSON.stringify(file, null, 2)}\n`);

for (const p of plan) {
  const note = p.status === "ours" ? c.dim("ours (local file): check / skip") : c.green(DRY ? "free: would claim" : "free: claiming");
  console.log(`  ${`${p.label}.${PARENT_NAME}`.padEnd(28)} ${note}`);
}

// Batch shape for the roster at the recommended chunk (the company app's exact mode: whole chunks plus
// one smaller final line), computed with the SDK's own planner.
const salaries = [...EMPLOYEES.map((e) => e.salary), ...EXTRA_ROWS.map((r) => r.salary)];
const usdc = (n: number) => BigInt(n) * 1_000_000n;
function shape(chunk: number) {
  return planDenominatedRun(salaries.map((s, i) => ({ id: String(i), amount: usdc(s) })), usdc(chunk), { mode: "exact" }).stats;
}
const total = salaries.reduce((a, b) => a + b, 0);

if (DRY) {
  printBatchAdvice();
  console.log(c.dim("Dry run: nothing claimed, nothing written."));
  process.exit(0);
}

// 2. Claim through the API (idempotent), then wait until every name resolves on ENS.
const created: string[] = [];
const skipped: string[] = [];
for (const p of plan) {
  const phrase = file.employees.find((e) => e.key === p.key)!.phrase;
  const r = await claim(p.label, phrase);
  (r === "claimed" ? created : skipped).push(p.label);
}
for (const p of plan) await verify(p.label, file.employees.find((e) => e.key === p.key)!.phrase);

// 3. The coworker's recovery kit, built by the employee app's own kit code and re-parsed by its restore
//    parser before it is written. (Path held in a variable: that module is browser code outside this
//    package's typecheck.)
const kitModule = "../../apps/recipient/src/onboarding/recoveryKit.ts";
const kit = (await import(kitModule)) as {
  recoveryKitText: (i: { mnemonic: string; name?: string; createdAt: Date }) => string;
  parseRecoveryKit: (text: string) => string | null;
};
const coworker = file.employees.find((e) => e.key === COWORKER)!;
const kitText = kit.recoveryKitText({ mnemonic: coworker.phrase, name: `${coworker.label}.${PARENT_NAME}`, createdAt: new Date() });
if (kit.parseRecoveryKit(kitText) !== coworker.phrase) throw new Error("recovery kit does not round-trip through parseRecoveryKit");
const KIT_FILE = resolve(REPO, `scripts/${coworker.label}.recovery-kit.local.txt`);
writePrivate(KIT_FILE, kitText);

// 4. The roster CSV, in the company app's import format (apps/sender/src/lib/csv.ts).
// No comment lines: the importer reads the first row as the header. alex-demo and billing-agent are
// left out on purpose; they join live through invites.
const csv = [
  "name,amount,label",
  ...EMPLOYEES.map((e) => `${file.employees.find((s) => s.key === e.key)!.label}.${PARENT_NAME},${e.salary},${e.display}`),
  ...EXTRA_ROWS.map((r) => `${r.name},${r.salary},${r.display}`),
  "",
].join("\n");
writeFileSync(ROSTER_FILE, csv);

// 5. Summary.
console.log("");
console.log(c.bold("Summary"));
console.log(`  created  ${created.length ? created.join(", ") : c.dim("none")}`);
console.log(`  skipped  ${skipped.length ? skipped.join(", ") : c.dim("none")} ${skipped.length ? c.dim("(already claimed)") : ""}`);
console.log(`  roster   ${ROSTER_FILE}  (${salaries.length} rows, ${total.toLocaleString("en-US")} USDC)`);
console.log(`  kit      ${KIT_FILE}  (${coworker.label}, the coworker)`);
console.log(`  phrases  ${COMPANY_FILE}  ${c.dim("(git-ignored, 0600, never printed)")}`);
printBatchAdvice();
console.log(c.bold("Next"));
console.log("  1. Employer profile → company app → Pay run → Import CSV → the roster file above (resolve + pin each name).");
console.log(`  2. Settings → chunk size ${RECOMMENDED_CHUNK} USDC (the testnet default of 5 would split this payroll into thousands of lines).`);
console.log(`  3. Coworker profile → employee app → Restore → "Open recovery kit" → the kit file above (${coworker.label}).`);

function printBatchAdvice(): void {
  console.log("");
  console.log(c.bold(`Batch shape (${salaries.length} payees, ${total.toLocaleString("en-US")} USDC, cap ${MAX_LINES_PER_TX} lines/tx)`));
  for (const chunk of [5, 250, RECOMMENDED_CHUNK, 1000]) {
    const s = shape(chunk);
    const mark = chunk === RECOMMENDED_CHUNK ? c.green("  ← recommended") : "";
    console.log(
      `  chunk ${String(chunk).padStart(4)} USDC: ${String(s.totalLines).padStart(5)} lines, ${s.txCount} tx, ${s.distinctAmounts} distinct amounts, ${s.uniqueAmountCount} unique${mark}`,
    );
  }
}
