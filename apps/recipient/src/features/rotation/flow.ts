/**
 * Meta-address rotation under option A (docs/mvp-spec.md §2.1), framework-free:
 *
 *   1. new keys: the next key generation (./keys.ts)          ← caller
 *   2. World ID: `proveSession(saved session_id)`              ← caller (<HumanCheck mode="rotate">)
 *   3. `submitRotation`: sign the RotationClaim with the registrant key, POST /names/:label/rotation
 *   4. `finishRotation`: registrant `setText(stealth)` on Sepolia, then re-register the new meta-address
 *      in ERC-6538 (names.ts cross-checks the ENS record against `stealthMetaAddressOf(registrant, 1)`,
 *      so a changed record without it would fail resolution with MetaMismatch).
 *
 * Between 3 and 4 the caller persists a `PendingRotation`, so a failed or interrupted on-chain step can
 * be retried without a second World ID proof.
 */
import type { RegistryReader, SoapayKeys } from "@soapay/sdk";
import type { Hex } from "viem";
import type { Api, RotationResult } from "../../api/client.js";
import { registerMetaAddress } from "../../onboarding/actions.js";
import type { HumanCheckResult } from "../../worldid/types.js";
import { canonicalMeta, signRotationClaim } from "./claim.js";
import type { EnsWriter } from "./ens.js";

export const ROTATION_TTL_SECONDS = 1_800n;

export type RotationStage = "sign" | "post" | "setText" | "register" | "done";

export async function submitRotation(p: {
  api: Api;
  chainId: number;
  label: string;
  oldMeta: string;
  newMeta: string;
  registrantKey: Hex;
  worldId: HumanCheckResult;
  now?: number;
  onStage?: (s: RotationStage) => void;
}): Promise<RotationResult> {
  if (canonicalMeta(p.oldMeta) === canonicalMeta(p.newMeta)) throw new Error("The new meta-address is the same as the old one.");
  p.onStage?.("sign");
  const deadline = BigInt(Math.floor((p.now ?? Date.now()) / 1000)) + ROTATION_TTL_SECONDS;
  const { signature } = await signRotationClaim({
    label: p.label,
    oldMeta: p.oldMeta,
    newMeta: p.newMeta,
    deadline,
    chainId: p.chainId,
    registrantKey: p.registrantKey,
  });
  p.onStage?.("post");
  return p.api.rotate(p.label, {
    newMeta: canonicalMeta(p.newMeta),
    deadline: deadline.toString(),
    registrantSig: signature,
    ...(p.worldId.placeholder ? {} : { worldIdResult: p.worldId.session }),
  });
}

export async function finishRotation(p: {
  api: Api;
  ens: EnsWriter;
  registry: RegistryReader;
  chainId: number;
  name: string;
  newMeta: string;
  /** Any key set whose registrant fields are generation 0's (KeyRing.current). */
  registrant: SoapayKeys;
  onStage?: (s: RotationStage) => void;
}): Promise<{ setTextTx: Hex; registerTx: Hex }> {
  p.onStage?.("setText");
  const { txHash: setTextTx } = await p.ens.setStealthRecord({
    name: p.name,
    metaAddress: canonicalMeta(p.newMeta),
    registrantKey: p.registrant.registrantKey,
  });
  p.onStage?.("register");
  const reg = await registerMetaAddress({
    api: p.api,
    client: p.registry,
    keys: p.registrant,
    chainId: p.chainId,
    metaAddressURI: p.newMeta,
  });
  p.onStage?.("done");
  return { setTextTx, registerTx: reg.txHash };
}
