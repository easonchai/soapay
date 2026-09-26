// Private dividend run: split a USDC total pro rata by shareholding, one stealth address per line,
// in identical 100 USDC denominations so line amounts do not reveal holdings.
//
//   pnpm --filter @soapay/examples dividend                 # dry run
//   EXECUTE=1 PAYER_PRIVATE_KEY=0x… pnpm --filter @soapay/examples dividend
import { parseUnits } from "viem";
import { denominated, dividend, planDistribution, resolveAsset } from "@soapay/sdk";
import { demoMetaAddresses, maybeSend, printPlan } from "./shared.js";

const CHAIN_ID = 84532; // Base Sepolia
const usdc = resolveAsset(CHAIN_ID, "USDC");

// Share register snapshot: meta-address + shares held (any integer unit; only ratios matter).
const metas = demoMetaAddresses(12);
const holders = metas.map((metaAddressURI, i) => ({ metaAddressURI, holdings: BigInt(1_000 + i * 750), id: `holder-${i + 1}` }));

const input = dividend(holders, parseUnits("25000", 6));
const plan = planDistribution({ ...input, asset: usdc, split: denominated(parseUnits("100", 6)) });

printPlan(plan, 6, "USDC");
console.log("Per holder (exact integer pro rata; sums to the total):");
input.recipients.forEach((r) => console.log(`  ${r.id}: ${r.amount}`));
await maybeSend(plan, CHAIN_ID);
