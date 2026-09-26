/**
 * Attach a World ID Selfie Check session to a name AFTER it was claimed (docs/worldid.md):
 * POST /names/:label/session with the registrant's AttachSession signature (SDK typed data).
 *
 * The API makes a late-attached session wait `WORLD_ATTACH_COOLDOWN_SECONDS` (72 h by default) before it
 * can back a rotation, so a stolen key can't attach its own session and rotate at once.
 */
import { attachSessionTypedData } from "@soapay/sdk";
import type { Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { Api, AttachSessionResult } from "../../api/client.js";
import { sessionIdOf, type HumanCheckResult } from "../../worldid/types.js";

export const ATTACH_TTL_SECONDS = 1_800n;

export async function attachSession(p: {
  api: Api;
  chainId: number;
  label: string;
  result: HumanCheckResult;
  registrantKey: Hex;
  now?: number;
}): Promise<AttachSessionResult> {
  const sessionId = sessionIdOf(p.result);
  if (!sessionId) throw new Error("World ID didn't return a session id.");
  const deadline = BigInt(Math.floor((p.now ?? Date.now()) / 1000)) + ATTACH_TTL_SECONDS;
  const signature = await privateKeyToAccount(p.registrantKey).signTypedData(
    attachSessionTypedData({ label: p.label, sessionId, deadline, chainId: p.chainId }),
  );
  return p.api.attachSession(p.label, { deadline: deadline.toString(), signature, worldIdResult: p.result });
}
