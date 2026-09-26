/**
 * Link World ID (Proof of Human) to a name AFTER it was claimed (docs/worldid.md, D-58):
 * POST /names/:label/session with the registrant's AttachWorldId signature over the proof's nullifier
 * (SDK typed data).
 *
 * The API makes a late link wait `WORLD_ATTACH_COOLDOWN_SECONDS` (72 h by default) before it can back a
 * rotation, so a stolen key can't link its own World ID and rotate at once.
 */
import { attachWorldIdTypedData, worldIdNullifierOf } from "@soapay/sdk";
import type { Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { Api, AttachSessionResult } from "../../api/client.js";
import type { HumanCheckResult } from "../../worldid/types.js";

export const ATTACH_TTL_SECONDS = 1_800n;

export async function attachSession(p: {
  api: Api;
  chainId: number;
  label: string;
  result: HumanCheckResult;
  registrantKey: Hex;
  now?: number;
}): Promise<AttachSessionResult> {
  const nullifier = worldIdNullifierOf(p.result);
  if (nullifier === undefined) throw new Error("World ID didn't return a Proof of Human nullifier.");
  const deadline = BigInt(Math.floor((p.now ?? Date.now()) / 1000)) + ATTACH_TTL_SECONDS;
  const signature = await privateKeyToAccount(p.registrantKey).signTypedData(
    attachWorldIdTypedData({ label: p.label, nullifier, deadline, chainId: p.chainId }),
  );
  return p.api.attachSession(p.label, { deadline: deadline.toString(), signature, worldIdResult: p.result });
}
