// Gets a clean-slate employer wallet ready for the stage demos (docs/demos/README.md).
// Entry point: scripts/demo-bootstrap.ts.
//
//   pnpm demo:bootstrap <employer-address> [--eth 0.05] [--usdc 100000] [--no-seed] [--dry]
//
// 1. Gas: tops the employer up to --eth Base Sepolia ETH (default 0.05) from the deployer key in
//    contracts/.env (or DEMO_BASE_FUNDER_PRIVATE_KEY). Skipped when it already holds that much.
// 2. Mock USDC: when it holds less than --usdc (default 100,000), asks the API's one-time welcome drop
//    (POST /faucet); if that was already used or is off, mints 1,000,000 mock USDC with the deployer
//    (the token admin grants itself MINTER_ROLE for the mint and revokes it right after, as
//    scripts/fund-usdc.sh does). Never the API relayer's key: sharing its nonce races the live API.
// 3. The company: runs `pnpm demo:seed-company` when the roster file is missing, and checks sam-demo
//    (the thief's victim) and the fresh labels the live beats will claim.
// 4. Prints the clicks that follow.
//
// Idempotent. --dry reads everything and sends nothing. Keys and phrases are never printed.
// Env: SOAPAY_ENV_ROOT (where contracts/.env lives; default the repo), API_URL, RPC_URL, PAY_TOKEN.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createWalletClient, encodeFunctionData, formatEther, formatUnits, getAddress, http, isAddress, keccak256, parseAbi, parseEther, parseUnits, toHex, type Account, type Address, type Hash } from "viem";
import { getChainConfig, MAX_LINES_PER_TX } from "@soapay/sdk";
import { BASE_RPC_URL, baseClient, CHAIN_ID } from "./claim.js";
import { c, recoveryEntries, REPO } from "./local.js";
import { API_URL, funders } from "./recovery.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROSTER_FILE = resolve(REPO, "scripts/.demo-roster.local.csv");
const MAYA_KIT_GLOB = "scripts/maya-ml*.recovery-kit.local.txt";
const EXPLORER = "https://sepolia.basescan.org";
const APP_URL = "https://soapay.up.railway.app";
/** Labels the live beats claim; they must still be free on the day. */
const FRESH_LABELS = (process.env.DEMO_FRESH_LABELS ?? "alex-meridian,billing-agent").split(",").map((s) => s.trim()).filter(Boolean);
/** What a direct mint sends, base units (1,000,000 USDC, like the welcome drop). */
const MINT_UNITS = 1_000_000n * 1_000_000n;

const usdcAbi = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function hasRole(bytes32 role, address account) view returns (bool)",
  "function grantRole(bytes32 role, address account)",
  "function revokeRole(bytes32 role, address account)",
  "function mint(address to, uint256 amount)",
]);
const MINTER_ROLE = keccak256(toHex("MINTER_ROLE"));

// Errors end the run with one plain line, not a stack trace (the presenter reads this output).
const stop = (e: unknown) => {
  console.error(`\n${c.bold("Stopped:")} ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
};
process.on("uncaughtException", stop);
process.on("unhandledRejection", stop);

// ---------------------------------------------------------------------------------------------
// Arguments

function usage(code = 2): never {
  console.log("Usage: pnpm demo:bootstrap <employer-address> [--eth 0.05] [--usdc 100000] [--no-seed] [--dry]");
  process.exit(code);
}

const args = process.argv.slice(2);
let employerArg: string | undefined;
let ethTarget = "0.05";
let usdcMin = "100000";
let DRY = /^(1|true|yes)$/i.test(process.env.DEMO_DRY ?? "");
let SEED = true;
for (let i = 0; i < args.length; i++) {
  const a = args[i]!;
  const value = (flag: string) => {
    if (a.includes("=")) return a.slice(a.indexOf("=") + 1);
    const v = args[++i];
    if (!v) throw new Error(`${flag} needs a value`);
    return v;
  };
  if (a === "--dry") DRY = true;
  else if (a === "--no-seed") SEED = false;
  else if (a === "--eth" || a.startsWith("--eth=")) ethTarget = value("--eth");
  else if (a === "--usdc" || a.startsWith("--usdc=")) usdcMin = value("--usdc");
  else if (a === "-h" || a === "--help") usage(0);
  else if (a.startsWith("-")) {
    console.error(`Unknown option: ${a}`);
    usage();
  } else if (!employerArg) employerArg = a;
  else usage();
}
if (!employerArg || !isAddress(employerArg, { strict: false })) {
  if (employerArg) console.error(`Not an address: ${employerArg}`);
  usage();
}
if (!/^\d+(\.\d+)?$/.test(ethTarget)) throw new Error(`--eth must be an amount of ETH, got "${ethTarget}"`);
if (!/^\d+$/.test(usdcMin)) throw new Error(`--usdc must be a whole number of USDC, got "${usdcMin}"`);

const employer = getAddress(employerArg);
const ethWant = parseEther(ethTarget);
const usdcWant = parseUnits(usdcMin, 6);
const token = (process.env.PAY_TOKEN as Address | undefined) ?? getChainConfig(CHAIN_ID).usdc;

const ok = (s: string) => console.log(`  ${c.green("ok")}    ${s}`);
const todo = (s: string) => console.log(`  ${c.cyan("todo")}  ${s}`);
const info = (s: string) => console.log(`  ${c.dim("·")}     ${s}`);
const eth = (wei: bigint) => `${Number(formatEther(wei)).toFixed(4)} ETH`;
const usdc = (units: bigint) => `${Number(formatUnits(units, 6)).toLocaleString("en-US", { maximumFractionDigits: 2 })} mock USDC`;

// ---------------------------------------------------------------------------------------------
// Helpers

/** The wallet that pays for the top-ups: DEMO_BASE_FUNDER_PRIVATE_KEY, else the deployer. Never the API relayer. */
function funder(): { source: string; account: Account } {
  const f = funders("base-sepolia").find((x) => !x.source.includes("apps/api"));
  if (!f) {
    const root = process.env.SOAPAY_ENV_ROOT ?? REPO;
    throw new Error(
      `No funder key. Put DEPLOYER_PRIVATE_KEY in ${resolve(root, "contracts/.env")}, or point SOAPAY_ENV_ROOT at the checkout that has it` +
        " (e.g. SOAPAY_ENV_ROOT=/path/to/soapay pnpm demo:bootstrap …), or set DEMO_BASE_FUNDER_PRIVATE_KEY.",
    );
  }
  return f;
}

async function send(account: Account, what: string, tx: { to: Address; data?: `0x${string}`; value?: bigint }): Promise<Hash> {
  const wallet = createWalletClient({ account, chain: baseClient.chain, transport: http(BASE_RPC_URL, { retryCount: 3 }) });
  const hash = await wallet.sendTransaction({ to: tx.to, data: tx.data, value: tx.value });
  const receipt = await baseClient.waitForTransactionReceipt({ hash, timeout: 180_000 });
  if (receipt.status !== "success") throw new Error(`${what} reverted: ${EXPLORER}/tx/${hash}`);
  ok(`${what}  ${c.dim(`${EXPLORER}/tx/${hash}`)}`);
  return hash;
}

const usdcBalance = () => baseClient.readContract({ address: token, abi: usdcAbi, functionName: "balanceOf", args: [employer] });

/** Public RPCs lag behind their own receipts: wait up to ~60 s for a balance to move. */
async function waitForChange<T>(read: () => Promise<T>, before: T): Promise<T> {
  for (let i = 0; i < 12; i++) {
    const now = await read();
    if (now !== before) return now;
    await new Promise((r) => setTimeout(r, 5_000));
  }
  return read();
}

async function apiJson(path: string, init?: RequestInit): Promise<{ status: number; body: any }> {
  try {
    const res = await fetch(`${API_URL}${path}`, { ...init, signal: AbortSignal.timeout(90_000) });
    return { status: res.status, body: await res.json().catch(() => null) };
  } catch (e) {
    return { status: 0, body: { error: { message: (e as Error).message } } };
  }
}

// ---------------------------------------------------------------------------------------------
// 1. Gas

console.log(c.bold(`Soapay demo bootstrap for ${employer} (Base Sepolia)${DRY ? c.dim("  [dry run: nothing is sent]") : ""}`));
console.log(c.dim(`  API ${API_URL} · RPC ${BASE_RPC_URL} · pay token ${token}`));
console.log("");
console.log(c.bold("1. Gas (Base Sepolia ETH)"));
const ethNow = await baseClient.getBalance({ address: employer });
if (ethNow >= ethWant) {
  ok(`employer holds ${eth(ethNow)} (target ${ethTarget} ETH): skip`);
} else {
  const need = ethWant - ethNow;
  const f = funder();
  const funderBal = await baseClient.getBalance({ address: f.account.address });
  // Keep a little for the funder's own gas (the USDC mint below may need it too).
  const reserve = parseEther("0.002");
  if (funderBal < need + reserve) {
    throw new Error(
      `The funder ${f.account.address} (${f.source}) holds ${eth(funderBal)}, not enough to send ${eth(need)}. ` +
        `Top it up (a Base Sepolia faucet, or bridge Sepolia ETH), or run with a smaller --eth.`,
    );
  }
  info(`employer holds ${eth(ethNow)}; ${DRY ? "would send" : "sending"} ${eth(need)} from ${f.account.address} (${f.source}, holds ${eth(funderBal)})`);
  if (!DRY) {
    await send(f.account, `sent ${eth(need)} to the employer`, { to: employer, value: need });
    ok(`employer now holds ${eth(await waitForChange(() => baseClient.getBalance({ address: employer }), ethNow))}`);
  }
}

// ---------------------------------------------------------------------------------------------
// 2. Mock USDC

console.log("");
console.log(c.bold("2. Mock USDC"));
const usdcNow = await usdcBalance();
if (usdcNow >= usdcWant) {
  ok(`employer holds ${usdc(usdcNow)} (at least ${usdc(usdcWant)}): skip`);
} else if (DRY) {
  info(`employer holds ${usdc(usdcNow)}; would ask POST ${API_URL}/faucet (the one-time welcome drop), else mint ${usdc(MINT_UNITS)} with the deployer`);
} else {
  info(`employer holds ${usdc(usdcNow)}; asking the API's welcome drop (POST /faucet)…`);
  const drop = await apiJson("/faucet", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ address: employer }) });
  let funded = false;
  if (drop.status === 200 && drop.body?.status === "sent") {
    ok(`welcome drop sent  ${c.dim(`${EXPLORER}/tx/${drop.body.usdc?.txHash}`)}`);
    funded = (await waitForChange(usdcBalance, usdcNow)) >= usdcWant;
  } else if (drop.status === 200 && drop.body?.status === "already_claimed") {
    info("this wallet already used its welcome drop; minting instead");
  } else {
    info(`welcome drop unavailable (HTTP ${drop.status}: ${drop.body?.error?.message ?? drop.body?.message ?? drop.body?.code ?? "no answer"}); minting instead`);
  }
  if (!funded) {
    const f = funder();
    const hasRole = await baseClient.readContract({ address: token, abi: usdcAbi, functionName: "hasRole", args: [MINTER_ROLE, f.account.address] });
    if (!hasRole) {
      await send(f.account, `${f.source}: grant itself MINTER_ROLE (token admin)`, {
        to: token,
        data: encodeFunctionData({ abi: usdcAbi, functionName: "grantRole", args: [MINTER_ROLE, f.account.address] }),
      });
    }
    try {
      await send(f.account, `minted ${usdc(MINT_UNITS)} to the employer`, {
        to: token,
        data: encodeFunctionData({ abi: usdcAbi, functionName: "mint", args: [employer, MINT_UNITS] }),
      });
    } finally {
      if (!hasRole) {
        await send(f.account, "revoked the temporary MINTER_ROLE", {
          to: token,
          data: encodeFunctionData({ abi: usdcAbi, functionName: "revokeRole", args: [MINTER_ROLE, f.account.address] }),
        });
      }
    }
    ok(`employer now holds ${usdc(await waitForChange(usdcBalance, usdcNow))}`);
  } else {
    ok(`employer now holds ${usdc(await usdcBalance())}`);
  }
}

// ---------------------------------------------------------------------------------------------
// 3. The company, the thief's victim, the fresh labels

console.log("");
console.log(c.bold("3. Company roster (Meridian Labs)"));
if (existsSync(ROSTER_FILE)) {
  ok(`roster ready: ${ROSTER_FILE}  ${c.dim("(re-run pnpm demo:seed-company to re-check it)")}`);
} else if (!SEED) {
  todo(`no roster yet: run ${c.bold("pnpm demo:seed-company")} (writes ${ROSTER_FILE})`);
} else {
  info(`no roster yet: running pnpm demo:seed-company${DRY ? " --dry" : ""} (claims ten employees; takes a few minutes)…`);
  console.log("");
  const r = spawnSync(process.execPath, ["--import", "tsx", resolve(HERE, "seed-company.ts"), ...(DRY ? ["--dry"] : [])], {
    cwd: resolve(HERE, ".."),
    stdio: "inherit",
    env: process.env,
  });
  console.log("");
  if (r.status !== 0) throw new Error(`pnpm demo:seed-company failed (exit ${r.status}); fix the error above and re-run pnpm demo:bootstrap`);
  if (existsSync(ROSTER_FILE)) ok(`roster written: ${ROSTER_FILE}`);
  else if (!DRY) throw new Error(`pnpm demo:seed-company finished but ${ROSTER_FILE} is missing`);
}

if (recoveryEntries().some((e) => e.label === "sam-demo")) ok("sam-demo (the thief's victim) is set up");
else todo(`sam-demo's phrase isn't in this checkout: run ${c.bold("pnpm demo:setup-recovery")} (the thief beats need it)`);

for (const label of FRESH_LABELS) {
  const got = await apiJson(`/names/${label}`);
  if (got.status === 404) ok(`${label}.soapay.eth is free for the live sign-up`);
  else if (got.status === 200) todo(`${label}.soapay.eth is already claimed: pick another fresh label for the live beat`);
  else info(`${label}: could not check (HTTP ${got.status})`);
}

// ---------------------------------------------------------------------------------------------
// 4. Next clicks

console.log("");
console.log(c.bold("Next (Employer browser profile, MetaMask on this wallet)"));
const steps = [
  `Open ${APP_URL}/ → Log in with MetaMask (${employer}). Decline MetaMask's smart-account switch.`,
  "Create the vault with Wallet signature.",
  `Pay run → Import CSV → ${ROSTER_FILE} (each name is resolved and pinned).`,
  "Settings → Chunk size 500 → Save. Denominated payouts stays on.",
  `Pay run → Resolve names → every row Verified. About 125 lines at 500 USDC: one StealthDisperse tx (cap ${MAX_LINES_PER_TX} lines).`,
  "Settings → Back up now.",
  `Employee app (Coworker profile) → Restore from recovery phrase → open ${MAYA_KIT_GLOB}.`,
];
steps.forEach((s, i) => console.log(`  ${i + 1}. ${s}`));
console.log(c.dim("\nScripts: docs/demos/finalist.md · docs/demos/worldid.md · docs/demos/ens.md"));
