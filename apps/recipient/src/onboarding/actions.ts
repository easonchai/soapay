import {
  ERC6538_REGISTRY,
  PARENT_NAME,
  erc6538RegistryMinimalAbi,
  getRegistryNonce,
  signNameClaim,
  signRegisterKeysOnBehalf,
  type RegistryReader,
  type SoapayKeys,
} from "@soapay/sdk";
import { ApiError, type Api, type NameRecord, type RegisterResult } from "../api/client.js";
import type { Address, Hex } from "viem";
import { detectGeneration } from "../features/rotation/keys.js";
import type { HumanCheckResult } from "../worldid/types.js";

/** The optional World ID session for POST /names, forwarded unchanged. */
export function sessionFields(r: HumanCheckResult | undefined): { worldIdSession?: unknown } {
  return r ? { worldIdSession: r } : {};
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
  /** Register a different meta-address for the same registrant (key rotation). Default: the keys' own. */
  metaAddressURI?: string;
  /**
   * Restore: the phrase, so a registry entry from a later key generation is recognised and kept
   * (`generation` in the result) instead of being overwritten with generation 0.
   */
  restore?: { mnemonic: string; phraseOffset?: number };
}): Promise<RegisterResult & { generation?: number }> {
  const metaAddressURI = p.metaAddressURI ?? p.keys.metaAddressURI;
  if (p.restore) {
    const onChain = await readRegisteredMeta(p.client, p.keys.registrantAddress);
    if (onChain) {
      const g = detectGeneration(p.restore.mnemonic, onChain, p.restore.phraseOffset ?? 0);
      if (g !== null) return { txHash: "0x", status: "success", idempotent: true, generation: g };
    }
  }
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
    });
  } catch (e) {
    // Restoring a seed that is already registered is fine.
    if (e instanceof ApiError && e.code === "already_registered") return { txHash: "0x", status: "success", idempotent: true };
    throw e;
  }
}

/** The registry's current meta-address URI for a registrant, or null when none is registered. */
export async function readRegisteredMeta(client: RegistryReader, registrant: Address): Promise<string | null> {
  const bytes = await client.readContract({
    address: ERC6538_REGISTRY,
    abi: erc6538RegistryMinimalAbi,
    functionName: "stealthMetaAddressOf",
    args: [registrant, 1n],
  });
  return typeof bytes === "string" && bytes.length > 2 ? `st:eth:${bytes.toLowerCase()}` : null;
}

export const CLAIM_TTL_SECONDS = 3_600n;

/** Signs a NameClaim with the registrant key and submits it. */
export async function claimName(p: {
  api: Api;
  keys: SoapayKeys;
  chainId: number;
  label: string;
  /** Optional World ID session (self-service recovery, §5). */
  session?: HumanCheckResult | undefined;
  /** Invite code when the employer reserved this label (§7). */
  inviteCode?: Hex | undefined;
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
    ...sessionFields(p.session),
    ...(p.inviteCode ? { inviteCode: p.inviteCode } : {}),
  });
}

export const fullName = (label: string) => `${label}.${PARENT_NAME}`;
