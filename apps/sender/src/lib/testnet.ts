// Testnet-sized defaults (D-47, D-52). On Base Sepolia the company pays in Soapay's mock USDC and
// each wallet gets a 1,000,000 USDC welcome drop, so amounts are no longer scarce; the small examples
// and chunks just keep demo runs readable. Anyone can still type any amount.
import { formatUsdc } from "./amount.js";

/** The welcome drop each wallet gets once on Base Sepolia (D-52), in whole USDC. */
export const WELCOME_DROP_USDC = 1_000_000;
/** Above this run total (USDC base units) the Review step asks for a confirmation on a testnet: the drop. */
export const TESTNET_RUN_CONFIRM_ABOVE = BigInt(WELCOME_DROP_USDC) * 1_000_000n;

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
  return `This run sends ${formatUsdc(total)} test USDC, more than the ${WELCOME_DROP_USDC.toLocaleString("en-US")} USDC welcome drop.`;
}
