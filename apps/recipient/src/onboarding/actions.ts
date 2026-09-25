import {
  PARENT_NAME,
  getRegistryNonce,
  signNameClaim,
  signRegisterKeysOnBehalf,
  type RegistryReader,
  type SoapayKeys,
} from "@soapay/sdk";
import { ApiError, type Api, type NameRecord, type RegisterResult } from "../api/client.js";

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
  proof?: unknown;
}): Promise<RegisterResult> {
  const nonce = await getRegistryNonce(p.client, p.keys.registrantAddress);
  const signature = await signRegisterKeysOnBehalf({
    registrantKey: p.keys.registrantKey,
    metaAddressURI: p.keys.metaAddressURI,
    chainId: p.chainId,
    nonce,
  });
  try {
    return await p.api.register({
      registrant: p.keys.registrantAddress,
      metaAddress: p.keys.metaAddressURI,
      signature,
      ...(p.proof !== undefined ? { proof: p.proof } : {}),
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
  proof?: unknown;
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
    ...(p.proof !== undefined ? { proof: p.proof } : {}),
  });
}

export const fullName = (label: string) => `${label}.${PARENT_NAME}`;
