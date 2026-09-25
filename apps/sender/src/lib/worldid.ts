// World ID re-verification of a meta-address change (docs/mvp-spec.md §5).
//
// When an employee rotates the meta-address behind their name, apps/api will record
// whether the change came with a fresh Proof of Human from the same human who
// enrolled (same nullifier, action `soapay-meta-update`). The sender shows that as a
// badge next to the "possible salary redirect" warning. The badge is advisory: the
// employer must still re-approve the new pin explicitly.

export type WorldIdStatus =
  /** The API confirmed a fresh proof from the enrolling human for exactly this meta-address. */
  | { state: "verified"; verifiedAt: number }
  /** The API has the change on record without a valid proof (different human, cancelled, expired). */
  | { state: "unverified"; reason: string }
  /** Nothing to check against yet (API route not live, or offline). */
  | { state: "unknown" };

export type WorldIdLookup = (params: { ensName: string; metaAddressURI: string }) => Promise<WorldIdStatus>;

/**
 * TODO(world-id): call the apps/api route that exposes meta-change verification once it
 * lands (e.g. `GET /names/:label/meta-changes?meta=st:eth:0x…` → `{verified, verifiedAt}`),
 * or read an ENSv2 record if the verification is published on-chain. Until then every
 * change is "unknown" and the employer decides on the warning alone.
 */
export const lookupWorldIdVerification: WorldIdLookup = async () => ({ state: "unknown" });
