/**
 * Attach a World ID Selfie Check session to a name AFTER it was claimed (docs/mvp-spec.md §5):
 * POST /names/:label/session, signed by the registrant.
 *
 * AttachSession, EIP-712, domain {name: "Soapay Names", version: "1", chainId}:
 *   AttachSession(string label, string sessionId, uint256 deadline)
 *
 * TODO(sdk): the SDK's rotation.ts (World ID branch) exports the AttachSession type; replace the
 * mirrored `attachSessionTypes` below with it when it lands on the main line, keeping the field order.
 */
import { nameClaimDomain } from "@soapay/sdk";
import type { Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { Api } from "../../api/client.js";
import { sessionIdOf, type HumanCheckResult } from "../../worldid/types.js";

export const attachSessionTypes = {
  AttachSession: [
    { name: "label", type: "string" },
    { name: "sessionId", type: "string" },
    { name: "deadline", type: "uint256" },
  ],
} as const;

export const ATTACH_TTL_SECONDS = 1_800n;

export function attachSessionTypedData(a: { label: string; sessionId: string; deadline: bigint; chainId: number }) {
  return {
    domain: nameClaimDomain(a.chainId),
    types: attachSessionTypes,
    primaryType: "AttachSession" as const,
    message: { label: a.label, sessionId: a.sessionId, deadline: a.deadline },
  };
}

export async function attachSession(p: {
  api: Api;
  chainId: number;
  label: string;
  result: HumanCheckResult;
  registrantKey: Hex;
  now?: number;
}): Promise<{ sessionId: string }> {
  if (p.result.placeholder) throw new Error("An unverified (testnet) result can't be attached to a name.");
  const sessionId = sessionIdOf(p.result);
  if (!sessionId) throw new Error("World ID didn't return a session id.");
  const deadline = BigInt(Math.floor((p.now ?? Date.now()) / 1000)) + ATTACH_TTL_SECONDS;
  const registrantSig = await privateKeyToAccount(p.registrantKey).signTypedData(
    attachSessionTypedData({ label: p.label, sessionId, deadline, chainId: p.chainId }),
  );
  await p.api.attachSession(p.label, { session: p.result.session, sessionId, deadline: deadline.toString(), registrantSig });
  return { sessionId };
}
