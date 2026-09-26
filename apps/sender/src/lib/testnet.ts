// Testnet-sized defaults (D-47). Test USDC is scarce: Circle's faucet gives 20 USDC per address per
// chain every 2 hours. These only change defaults and examples; anyone can still type any amount.
import { formatUsdc } from "./amount.js";

/** What Circle's faucet gives one address per request (per chain, every 2 hours). */
export const FAUCET_USDC_PER_DRIP = 20;
/** Above this run total (USDC base units) the Review step asks for a confirmation on a testnet. */
export const TESTNET_RUN_CONFIRM_ABOVE = 50_000_000n;

/** Example salaries for placeholders: small on a testnet, realistic elsewhere. */
export function exampleSalaries(testnet: boolean): readonly [string, string] {
  return testnet ? ["12", "8.5"] : ["4200", "3850"];
}

/**
 * The Review step's confirmation text when a testnet run is large, else null. A confirmation, not a
 * block: the run can still be sent once the employer confirms.
 */
export function testnetRunConfirmation(total: bigint, testnet: boolean): string | null {
  if (!testnet || total <= TESTNET_RUN_CONFIRM_ABOVE) return null;
  return `This run sends ${formatUsdc(total)} test USDC; the faucet gives ${FAUCET_USDC_PER_DRIP} per 2 hours.`;
}
