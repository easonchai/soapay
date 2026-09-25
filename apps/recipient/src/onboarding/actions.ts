import {
  PARENT_NAME,
  getRegistryNonce,
  signNameClaim,
  signRegisterKeysOnBehalf,
  type RegistryReader,
  type SoapayKeys,
} from "@soapay/sdk";
import { ApiError, type Api, type NameRecord, type RegisterResult } from "../api/client.js";
import type { HumanCheckResult } from "../worldid/types.js";

/** Enrollment World ID fields for POST /register and POST /names: `proof` (uniqueness) + `session`. */
export function humanFields(human: HumanCheckResult | undefined): { proof?: unknown; session?: unknown } {
  if (!human || human.placeholder) return {};
  return {
    ...(human.proof !== undefined ? { proof: human.proof } : {}),
    ...(human.session !== undefined ? { session: human.session } : {}),
  };
}

/**
 * Gasless ERC-6538 registration: the throwaway registrant signs EIP-712 locally; the API's relayer
 * submits `registerKeysOnBehalf`. Only the registrant address, the public meta-address and the
 * signature are sent.
 */
export async function registerMetaAddress(p: {
  api: Api;
  client: RegistryReader;
  keys: SoapayKeys;
  chainId: number;
  human?: HumanCheckResult | undefined;
  /** Register a different meta-address for the same registrant (key rotation). Default: the keys' own. */
  metaAddressURI?: string;
}): Promise<RegisterResult> {
  const metaAddressURI = p.metaAddressURI ?? p.keys.metaAddressURI;
  const nonce = await getRegistryNonce(p.client, p.keys.registrantAddress);
  const signature = await signRegisterKeysOnBehalf({
    registrantKey: p.keys.registrantKey,
    metaAddressURI,
    chainId: p.chainId,
    nonce,
  });
  try {
    return await p.api.register({
      registrant: p.keys.registrantAddress,
      metaAddress: metaAddressURI,
      signature,
      ...humanFields(p.human),
    });
  } catch (e) {
    // Restoring a seed that is already registered is fine.
    if (e instanceof ApiError && e.code === "already_registered") return { txHash: "0x", status: "success", idempotent: true };
    throw e;
  }
}

export const CLAIM_TTL_SECONDS = 3_600n;

/** Signs a NameClaim with the registrant key and submits it. */
export async function claimName(p: {
  api: Api;
  keys: SoapayKeys;
  chainId: number;
  label: string;
  human?: HumanCheckResult | undefined;
  now?: number;
}): Promise<NameRecord> {
  const deadline = BigInt(Math.floor((p.now ?? Date.now()) / 1000)) + CLAIM_TTL_SECONDS;
  const signature = await signNameClaim({
    label: p.label,
    registrant: p.keys.registrantAddress,
    metaAddress: p.keys.metaAddressURI,
    deadline,
    chainId: p.chainId,
    registrantKey: p.keys.registrantKey,
  });
  return p.api.claimName({
    label: p.label,
    registrant: p.keys.registrantAddress,
    metaAddress: p.keys.metaAddressURI,
    deadline: deadline.toString(),
    signature,
    ...humanFields(p.human),
  });
}

export const fullName = (label: string) => `${label}.${PARENT_NAME}`;
