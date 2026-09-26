// Private dividend run: split a USDC total pro rata by shareholding, one stealth address per line,
// in identical denominations so line amounts do not reveal holdings. On a testnet the amounts are
// testnet-sized (2.5 USDC in 0.1 USDC chunks; faucet USDC is scarce), else 25,000 USDC in 100 USDC chunks.
//
//   pnpm --filter @soapay/examples dividend                 # dry run
//   EXECUTE=1 PAYER_PRIVATE_KEY=0x… pnpm --filter @soapay/examples dividend
import { parseUnits } from "viem";
import { denominated, dividend, isTestnetChain, planDistribution, resolveAsset } from "@soapay/sdk";
import { demoMetaAddresses, maybeSend, printPlan } from "./shared.js";

const CHAIN_ID = 84532; // Base Sepolia
const usdc = resolveAsset(CHAIN_ID, "USDC");
const TESTNET = isTestnetChain(CHAIN_ID);
const TOTAL = TESTNET ? "2.5" : "25000";
const CHUNK = TESTNET ? "0.1" : "100";

// Share register snapshot: meta-address + shares held (any integer unit; only ratios matter).
const metas = demoMetaAddresses(12);
const holders = metas.map((metaAddressURI, i) => ({ metaAddressURI, holdings: BigInt(1_000 + i * 750), id: `holder-${i + 1}` }));

const input = dividend(holders, parseUnits(TOTAL, 6));
const plan = planDistribution({ ...input, asset: usdc, split: denominated(parseUnits(CHUNK, 6)) });

printPlan(plan, 6, "USDC");
console.log("Per holder (exact integer pro rata; sums to the total):");
input.recipients.forEach((r) => console.log(`  ${r.id}: ${r.amount}`));
await maybeSend(plan, CHAIN_ID);
