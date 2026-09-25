// Name resolution: the SDK's resolveStealthMeta over viem clients, or (dev only,
// VITE_MOCK_ENS=1) a deterministic generator for demos without ENS records.
import { bytesToHex, createPublicClient, hexToBytes, http, keccak256, stringToHex, type Hex } from "viem";
import { privateKeyToAddress } from "viem/accounts";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { formatMetaAddressURI, NameNotFound, resolveStealthMeta, type RegistryReader } from "@soapay/sdk";
import type { AppConfig } from "../config.js";
import type { Resolver } from "./roster.js";

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

/**
 * DEV ONLY. Every name resolves to a meta-address generated from the name and a local
 * rotation counter, so "simulate a key rotation" in the UI exercises the pin-change block.
 * Names whose first label starts with "missing" fail with NameNotFound.
 */
export function createMockResolver(rotations: RotationStore, delayMs = 250): Resolver {
  return async (name) => {
    if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
    if (name.split(".")[0]?.startsWith("missing")) throw new NameNotFound(name, 'no "stealth" text record');
    const r = rotations.get(name);
    const spend = secp256k1.getPublicKey(hexToBytes(mockKey(`soapay-mock:spend:${name}:${r}`)), true);
    const view = secp256k1.getPublicKey(hexToBytes(mockKey(`soapay-mock:view:${name}:${r}`)), true);
    return {
      metaAddressURI: formatMetaAddressURI(`0x${bytesToHex(spend).slice(2)}${bytesToHex(view).slice(2)}`),
      registrant: privateKeyToAddress(mockKey(`soapay-mock:registrant:${name}`)),
    };
  };
}
