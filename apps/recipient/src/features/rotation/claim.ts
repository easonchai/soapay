/**
 * RotationClaim, EIP-712 (docs/mvp-spec.md §2.1 "Shared formats"; the API verifies exactly this):
 *   domain {name: "Soapay Names", version: "1", chainId: API CHAIN_ID}
 *   RotationClaim(string label, string oldMeta, string newMeta, uint256 deadline)
 * Meta-addresses are signed in canonical lowercase `st:eth:0x…` form.
 *
 * TODO(sdk): the SDK has `signNameClaim` but no `signRotationClaim` yet; replace this module with the
 * SDK export when it lands (same domain as `nameClaimDomain`).
 */
import { nameClaimDomain } from "@soapay/sdk";
import type { Address, Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

export const rotationClaimTypes = {
  RotationClaim: [
    { name: "label", type: "string" },
    { name: "oldMeta", type: "string" },
    { name: "newMeta", type: "string" },
    { name: "deadline", type: "uint256" },
  ],
} as const;

export type RotationClaim = { label: string; oldMeta: string; newMeta: string; deadline: bigint; chainId: number };

export const canonicalMeta = (m: string) => m.trim().toLowerCase();

export function rotationClaimTypedData(c: RotationClaim) {
  return {
    domain: nameClaimDomain(c.chainId),
    types: rotationClaimTypes,
    primaryType: "RotationClaim" as const,
    message: { label: c.label, oldMeta: canonicalMeta(c.oldMeta), newMeta: canonicalMeta(c.newMeta), deadline: c.deadline },
  };
}

export async function signRotationClaim(c: RotationClaim & { registrantKey: Hex }): Promise<{ signature: Hex; signer: Address }> {
  const account = privateKeyToAccount(c.registrantKey);
  const signature = await account.signTypedData(rotationClaimTypedData(c));
  return { signature, signer: account.address };
}
