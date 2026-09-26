// Name resolution: the SDK's resolveStealthMeta over viem clients, or (dev only,
// VITE_MOCK_ENS=1) a deterministic generator for demos without ENS records.
import { bytesToHex, createPublicClient, hexToBytes, http, keccak256, stringToHex, type Address, type Hex } from "viem";
import { privateKeyToAccount, privateKeyToAddress } from "viem/accounts";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { formatMetaAddressURI, NameNotFound, resolveStealthMeta, type RegistryReader } from "@soapay/sdk";
import type { AppConfig } from "../config.js";
import type { Resolver } from "./roster.js";
import {
  META_ROTATION_TYPES,
  metaRotationDomain,
  soapayLabel,
  type AttestationSource,
  type MetaRotationItem,
} from "./attestation.js";

export function createChainResolver(cfg: AppConfig): Resolver {
  const ensClient = createPublicClient({ chain: cfg.ensChain, transport: http(cfg.ensRpcUrl) });
  const baseClient = createPublicClient({ chain: cfg.chain, transport: http(cfg.rpcUrl) });
  return (name) =>
    resolveStealthMeta({
      ensClient,
      baseClient: baseClient as unknown as RegistryReader,
      name,
    });
}

const ROTATIONS_KEY = "soapay.sender.mockRotations";

export type RotationStore = {
  get(name: string): number;
  bump(name: string): void;
};

export function localRotationStore(): RotationStore {
  const read = (): Record<string, number> => {
    try {
      return JSON.parse(localStorage.getItem(ROTATIONS_KEY) ?? "{}") as Record<string, number>;
    } catch {
      return {};
    }
  };
  return {
    get: (name) => read()[name] ?? 0,
    bump: (name) => {
      const r = read();
      r[name] = (r[name] ?? 0) + 1;
      localStorage.setItem(ROTATIONS_KEY, JSON.stringify(r));
    },
  };
}

export function memoryRotationStore(): RotationStore {
  const m = new Map<string, number>();
  return { get: (n) => m.get(n) ?? 0, bump: (n) => m.set(n, (m.get(n) ?? 0) + 1) };
}

function mockKey(label: string): Hex {
  // keccak output is a valid secp256k1 scalar with overwhelming probability; retry otherwise.
  for (let i = 0; ; i++) {
    const k = keccak256(stringToHex(`${label}:${i}`));
    if (secp256k1.utils.isValidSecretKey(hexToBytes(k))) return k;
  }
}

/** DEV ONLY: the demo meta-address of `name` after `rotation` key rotations. */
export function mockMetaFor(name: string, rotation: number): string {
  const spend = secp256k1.getPublicKey(hexToBytes(mockKey(`soapay-mock:spend:${name}:${rotation}`)), true);
  const view = secp256k1.getPublicKey(hexToBytes(mockKey(`soapay-mock:view:${name}:${rotation}`)), true);
  return formatMetaAddressURI(`0x${bytesToHex(spend).slice(2)}${bytesToHex(view).slice(2)}`);
}

/** DEV ONLY: the registrant the mock resolver reports for `name` (stable, so seeded pins match a later resolve). */
export function mockRegistrantFor(name: string): Address {
  return privateKeyToAddress(mockKey(`soapay-mock:registrant:${name}`));
}

/**
 * DEV ONLY. Every name resolves to a meta-address generated from the name and a local
 * rotation counter, so "simulate a key rotation" in the UI exercises the pin-change block.
 * Names whose first label starts with "missing" fail with NameNotFound.
 */
export function createMockResolver(rotations: RotationStore, delayMs = 250): Resolver {
  return async (name) => {
    if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
    if (name.split(".")[0]?.startsWith("missing")) throw new NameNotFound(name, 'no "stealth" text record');
    return {
      metaAddressURI: mockMetaFor(name, rotations.get(name)),
      registrant: mockRegistrantFor(name),
    };
  };
}

// ---------------------------------------------------------------------------
// DEV ONLY: a local stand-in for apps/api's attestation route. The mock attester key
// is public, so mock mode pins its address instead of VITE_ATTESTER; the verification
// code path (attestation.ts, viem verifyTypedData) is the real one.

export const MOCK_ATTESTER_KEY: Hex = keccak256(stringToHex("soapay-mock:attester"));
export const MOCK_ATTESTER: Address = privateKeyToAddress(MOCK_ATTESTER_KEY);

export type MockAttestationStore = {
  list(label: string): MetaRotationItem[];
  add(label: string, item: MetaRotationItem): void;
};

const ATTESTATIONS_KEY = "soapay.sender.mockAttestations";

export function localAttestationStore(): MockAttestationStore {
  const read = (): Record<string, MetaRotationItem[]> => {
    try {
      return JSON.parse(localStorage.getItem(ATTESTATIONS_KEY) ?? "{}") as Record<string, MetaRotationItem[]>;
    } catch {
      return {};
    }
  };
  return {
    list: (label) => read()[label] ?? [],
    add: (label, item) => {
      const all = read();
      all[label] = [item, ...(all[label] ?? [])];
      localStorage.setItem(ATTESTATIONS_KEY, JSON.stringify(all));
    },
  };
}

export function memoryAttestationStore(): MockAttestationStore {
  const m = new Map<string, MetaRotationItem[]>();
  return { list: (l) => m.get(l) ?? [], add: (l, i) => void m.set(l, [i, ...(m.get(l) ?? [])]) };
}

/** Serves the store like `GET /names/:label/attestations` (null = 404). */
export function mockAttestationSource(store: MockAttestationStore): AttestationSource {
  return async (label) => {
    const items = store.list(label);
    return items.length ? { attester: MOCK_ATTESTER, items } : null;
  };
}

/**
 * DEV ONLY: rotates the demo keys behind `name`. With `attest`, also records a
 * MetaRotation attestation signed by the mock attester, as apps/api would after a
 * World ID proof; without it, the rotation looks like a stolen registrant key.
 */
export async function simulateRotation(params: {
  name: string;
  rotations: RotationStore;
  attestations: MockAttestationStore;
  attest: boolean;
  chainId: number;
  now?: number;
}): Promise<void> {
  const { name, rotations } = params;
  const oldMeta = mockMetaFor(name, rotations.get(name));
  rotations.bump(name);
  const newMeta = mockMetaFor(name, rotations.get(name));
  const label = soapayLabel(name);
  if (!params.attest || !label) return;
  const verifiedAt = BigInt(Math.floor((params.now ?? Date.now()) / 1000));
  const signature = await privateKeyToAccount(MOCK_ATTESTER_KEY).signTypedData({
    domain: metaRotationDomain(params.chainId),
    types: META_ROTATION_TYPES,
    primaryType: "MetaRotation",
    message: { label, oldMeta, newMeta, verifiedAt },
  });
  params.attestations.add(label, { label, oldMeta, newMeta, verifiedAt: verifiedAt.toString(), signature });
}
