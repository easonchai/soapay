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

/**
 * Accounts that started on wallet-signature keys and then moved to a recovery phrase (owner decision
 * 2026-09-26): generation 0 is the wallet-signature key set and generation g ≥ 1 is the phrase's
 * generation g − 1. `phraseOffset` is 1 for them, 0 for phrase-native accounts.
 */
export function keysForAccountGeneration(mnemonic: string, generation: number, phraseOffset = 0): SoapayKeys {
  if (generation < phraseOffset) throw new Error("This generation comes from a wallet signature, not the recovery phrase");
  return keysForGeneration(mnemonic, generation - phraseOffset);
}

export function keyRing(mnemonic: string, generation: number, gen0?: SoapayKeys, phraseOffset = 0): KeyRing {
  const all: SoapayKeys[] = [];
  for (let g = 0; g <= generation; g++) all.push(g === 0 && gen0 ? gen0 : keysForAccountGeneration(mnemonic, g, phraseOffset));
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
