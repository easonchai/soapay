/**
 * Meta-address rotation under option A (docs/mvp-spec.md §2.1), framework-free:
 *
 *   1. `prepareRotation`: the next key generation (./keys.ts), a deadline, and the World ID signal
 *   2. World ID: `<HumanCheck mode="rotate" sessionId signal>` (proveSession)   ← caller
 *   3. `submitRotation`: sign the RotationClaim AND a `registerKeysOnBehalf` for the new meta with the
 *      registrant key, POST /names/:label/rotation. The API attests, tops up Sepolia gas, and relays
 *      the ERC-6538 re-registration on Base (step 3 of §2.1).
 *   4. `finishRotation`: the registrant's `setText(stealth)` on its ENSv2 resolver on Sepolia.
 *
 * Between 3 and 4 the caller persists a `PendingRotation`, so a failed or interrupted `setText` can be
 * retried without a second World ID proof.
 */
import { getRegistryNonce, signRegisterKeysOnBehalf, type RegistryReader, type SoapayKeys } from "@soapay/sdk";
import type { Hex } from "viem";
import type { Api, RotationResult } from "../../api/client.js";
import { registerMetaAddress } from "../../onboarding/actions.js";
import { rotateSignal, type HumanCheckResult } from "../../worldid/types.js";
import { canonicalMeta, signRotationClaim } from "./claim.js";
import type { EnsWriter } from "./ens.js";
import { keysForGeneration } from "./keys.js";

export const ROTATION_TTL_SECONDS = 1_800n;

export type RotationStage = "sign" | "post" | "setText" | "done";

export type RotationDraft = {
  label: string;
  generation: number;
  oldMeta: string;
  newMeta: string;
  deadline: bigint;
  /** What the World ID proof must commit to. */
  signal: string;
};

/** Everything the World ID step needs, computed before the proof so the signal binds this rotation. */
export function prepareRotation(p: {
  mnemonic: string;
  label: string;
  currentGeneration: number;
  oldMeta: string;
  now?: number;
}): RotationDraft {
  const generation = p.currentGeneration + 1;
  const newMeta = canonicalMeta(keysForGeneration(p.mnemonic, generation).metaAddressURI);
  const deadline = BigInt(Math.floor((p.now ?? Date.now()) / 1000)) + ROTATION_TTL_SECONDS;
  return {
    label: p.label,
    generation,
    oldMeta: canonicalMeta(p.oldMeta),
    newMeta,
    deadline,
    signal: rotateSignal(p.label, newMeta, deadline),
  };
}

export async function submitRotation(p: {
  api: Api;
  registry: RegistryReader;
  chainId: number;
  draft: RotationDraft;
  /** Generation 0's registrant (KeyRing.current carries it). */
  registrant: Pick<SoapayKeys, "registrantKey" | "registrantAddress">;
  worldId: HumanCheckResult;
  onStage?: (s: RotationStage) => void;
}): Promise<RotationResult> {
  const { draft } = p;
  if (draft.oldMeta === draft.newMeta) throw new Error("The new meta-address is the same as the old one.");
  p.onStage?.("sign");
  const { signature: registrantSig } = await signRotationClaim({
    label: draft.label,
    oldMeta: draft.oldMeta,
    newMeta: draft.newMeta,
    deadline: draft.deadline,
    chainId: p.chainId,
    registrantKey: p.registrant.registrantKey,
  });
  const nonce = await getRegistryNonce(p.registry, p.registrant.registrantAddress);
  const registerSig = await signRegisterKeysOnBehalf({
    registrantKey: p.registrant.registrantKey,
    metaAddressURI: draft.newMeta,
    chainId: p.chainId,
    nonce,
  });
  p.onStage?.("post");
  return p.api.rotate(draft.label, {
    newMeta: draft.newMeta,
    deadline: draft.deadline.toString(),
    registrantSig,
    registerSig,
    ...(p.worldId.placeholder ? {} : { worldIdResult: p.worldId.session }),
  });
}

export async function finishRotation(p: {
  ens: EnsWriter;
  name: string;
  newMeta: string;
  registrantKey: Hex;
  onStage?: (s: RotationStage) => void;
}): Promise<{ setTextTx: Hex }> {
  p.onStage?.("setText");
  const { txHash } = await p.ens.setStealthRecord({
    name: p.name,
    metaAddress: canonicalMeta(p.newMeta),
    registrantKey: p.registrantKey,
  });
  p.onStage?.("done");
  return { setTextTx: txHash };
}

/**
 * Manual path (no World ID session, §5): relay the ERC-6538 re-registration through POST /register.
 * No attestation exists, so the employer's sender app blocks the line until they approve by hand.
 */
export async function registerRotatedMeta(p: {
  api: Api;
  registry: RegistryReader;
  chainId: number;
  /** Generation 0's registrant (KeyRing.current). */
  registrant: SoapayKeys;
  newMeta: string;
}): Promise<{ txHash: Hex }> {
  const r = await registerMetaAddress({
    api: p.api,
    client: p.registry,
    keys: p.registrant,
    chainId: p.chainId,
    metaAddressURI: canonicalMeta(p.newMeta),
  });
  return { txHash: r.txHash };
}
