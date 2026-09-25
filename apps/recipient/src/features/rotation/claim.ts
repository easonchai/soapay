/**
 * RotationClaim signing (docs/mvp-spec.md §2.1). The typed data is the SDK's `rotationClaimTypedData`,
 * which the API verifies byte for byte; this only adds the signing with the registrant key.
 */
import { rotationClaimTypedData, type RotationClaim } from "@soapay/sdk";
import type { Address, Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

/** Canonical meta-address form for comparisons and storage (`st:eth:0x<lowercase>`). */
export const canonicalMeta = (m: string) => m.trim().toLowerCase();

export async function signRotationClaim(c: RotationClaim & { registrantKey: Hex }): Promise<{ signature: Hex; signer: Address }> {
  const { registrantKey, ...claim } = c;
  const account = privateKeyToAccount(registrantKey);
  const signature = await account.signTypedData(rotationClaimTypedData(claim));
  return { signature, signer: account.address };
}
