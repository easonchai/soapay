// Private grant round: fixed awards checked against a budget, plus the first tranche of a vesting
// grant, each paid to fresh stealth addresses.
//
//   pnpm --filter @soapay/examples grant                    # dry run
//   EXECUTE=1 PAYER_PRIVATE_KEY=0x… pnpm --filter @soapay/examples grant
import { parseUnits } from "viem";
import { grant, planDistribution, resolveAsset, vesting, vestingSchedule, type VestingSchedule } from "@soapay/sdk";
import { demoMetaAddresses, maybeSend, printPlan } from "./shared.js";

const CHAIN_ID = 84532; // Base Sepolia
const usdc = resolveAsset(CHAIN_ID, "USDC");
const [a, b, c, d, e, f, g, h, i, j, k] = demoMetaAddresses(11) as [string, string, string, string, string, string, string, string, string, string, string];

// 1. A grant round: ten awards, budget 50k USDC.
const awards = [a, b, c, d, e, f, g, h, i, j].map((metaAddressURI, n) => ({ metaAddressURI, amount: parseUnits(String(2_000 + n * 500), 6), id: `project-${n + 1}` }));
const round = grant(awards, { budget: parseUnits("50000", 6) });
const roundPlan = planDistribution({ ...round, asset: usdc });
printPlan(roundPlan, 6, "USDC");

// 2. A vesting grant: 12k USDC over a year, 3-month cliff, monthly releases.
const DAY = 86_400;
const start = Math.floor(Date.UTC(2026, 0, 1) / 1000);
const schedule: VestingSchedule = { total: parseUnits("12000", 6), start, cliff: 90 * DAY, duration: 360 * DAY, period: 30 * DAY };
console.log("Vesting releases:", vestingSchedule(schedule).map((r) => `${new Date(r.at * 1000).toISOString().slice(0, 10)} ${r.amount}`).join(", "));
const tranche = vesting([{ metaAddressURI: k, schedule, released: 0n, id: "core-dev" }], start + 100 * DAY);
const vestingPlan = planDistribution({ ...tranche, asset: usdc });
printPlan(vestingPlan, 6, "USDC");

// Only the grant round is sent here; send the vesting tranche the same way when it is due.
await maybeSend(roundPlan, CHAIN_ID);
