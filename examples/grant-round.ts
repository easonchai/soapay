// Private grant round: fixed awards checked against a budget, plus the first tranche of a vesting
// grant, each paid to fresh stealth addresses.
//
//   pnpm --filter @soapay/examples grant                    # dry run
//   EXECUTE=1 PAYER_PRIVATE_KEY=0x… pnpm --filter @soapay/examples grant
import { parseUnits } from "viem";
import { grant, isTestnetChain, planDistribution, resolveAsset, vesting, vestingSchedule, type VestingSchedule } from "@soapay/sdk";
import { demoMetaAddresses, maybeSend, printPlan } from "./shared.js";

const CHAIN_ID = 84532; // Base Sepolia
const usdc = resolveAsset(CHAIN_ID, "USDC");
// Testnet-sized amounts on a testnet (kept small for the demo; "USDC" there is Soapay's mock token,
// D-52): every figure below is divided by 10,000,
// so the round sends 4.25 test USDC instead of 42,500.
const SCALE = isTestnetChain(CHAIN_ID) ? 10_000 : 1;
const usd = (n: number) => parseUnits(String(n / SCALE), 6);
const [a, b, c, d, e, f, g, h, i, j, k] = demoMetaAddresses(11) as [string, string, string, string, string, string, string, string, string, string, string];

// 1. A grant round: ten awards, budget 50k USDC (5 on a testnet).
const awards = [a, b, c, d, e, f, g, h, i, j].map((metaAddressURI, n) => ({ metaAddressURI, amount: usd(2_000 + n * 500), id: `project-${n + 1}` }));
const round = grant(awards, { budget: usd(50_000) });
const roundPlan = planDistribution({ ...round, asset: usdc });
printPlan(roundPlan, 6, "USDC");

// 2. A vesting grant: 12k USDC (1.2 on a testnet) over a year, 3-month cliff, monthly releases.
const DAY = 86_400;
const start = Math.floor(Date.UTC(2026, 0, 1) / 1000);
const schedule: VestingSchedule = { total: usd(12_000), start, cliff: 90 * DAY, duration: 360 * DAY, period: 30 * DAY };
console.log("Vesting releases:", vestingSchedule(schedule).map((r) => `${new Date(r.at * 1000).toISOString().slice(0, 10)} ${r.amount}`).join(", "));
const tranche = vesting([{ metaAddressURI: k, schedule, released: 0n, id: "core-dev" }], start + 100 * DAY);
const vestingPlan = planDistribution({ ...tranche, asset: usdc });
printPlan(vestingPlan, 6, "USDC");

// Only the grant round is sent here; send the vesting tranche the same way when it is due.
await maybeSend(roundPlan, CHAIN_ID);
