/**
 * Key generations for meta-address rotation (docs/mvp-spec.md §2.1).
 *
 * Generation 0 is `keysFromMnemonic(mnemonic)`. Generation n ≥ 1 is a fresh spend/view key set from
 * the SAME seed, derived with the BIP-39 passphrase `soapay:rotation:<n>`, so the seed alone still
 * recovers every generation (try n = 1, 2, … until the scanner finds nothing).
 *
 * The registrant is ALWAYS generation 0's: it holds the ENSv2 `stealth` writer role and the ERC-6538
 * registry entry, so it signs the RotationClaim and sends the `setText`.
 *
 * TODO(sdk): move this into @soapay/sdk as an account index (e.g. `keysFromMnemonic(m, { account: n })`
 * at m/5564'/1'/… per generation) and switch here. Apps must not own derivation long-term (PRD P0);
 * this uses only the SDK's own `keysFromMnemonic`, so no private derivation code exists in the app.
 */
import { keysFromMnemonic, type ScanKeys, type SoapayKeys } from "@soapay/sdk";

export const rotationPassphrase = (generation: number) => `soapay:rotation:${generation}`;

export function keysForGeneration(mnemonic: string, generation: number): SoapayKeys {
  if (!Number.isInteger(generation) || generation < 0) throw new Error("Invalid key generation");
  return generation === 0 ? keysFromMnemonic(mnemonic) : keysFromMnemonic(mnemonic, rotationPassphrase(generation));
}

export type KeyRing = {
  generation: number;
  /** Keys payments go to now. The registrant fields are generation 0's (see above). */
  current: SoapayKeys;
  /** Every generation, oldest first. Scan and spend with all of them. */
  all: SoapayKeys[];
};

export function keyRing(mnemonic: string, generation: number, gen0?: SoapayKeys): KeyRing {
  const all: SoapayKeys[] = [];
  for (let g = 0; g <= generation; g++) all.push(g === 0 && gen0 ? gen0 : keysForGeneration(mnemonic, g));
  const base = all[0]!;
  const top = all[generation]!;
  return {
    generation,
    current: { ...top, registrantKey: base.registrantKey, registrantAddress: base.registrantAddress },
    all,
  };
}

export const scanKeysOf = (ring: KeyRing): ScanKeys[] =>
  ring.all.map((k) => ({ spendingPublicKey: k.spendingPublicKey, viewingPrivateKey: k.viewingKey }));
