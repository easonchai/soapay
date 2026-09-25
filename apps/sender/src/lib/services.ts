// Wires config into the pure modules: which resolver, which attestation source and
// which attester is pinned. The one place mock mode is decided.
import type { AppConfig } from "../config.js";
import { createAttestationLookup, httpAttestationSource, type AttestationLookup } from "./attestation.js";
import {
  createChainResolver,
  createMockResolver,
  localAttestationStore,
  localRotationStore,
  mockAttestationSource,
  MOCK_ATTESTER,
  simulateRotation,
} from "./resolver.js";
import type { Resolver } from "./roster.js";

export type Services = {
  resolve: Resolver;
  lookupAttestation: AttestationLookup;
  /** Present only in dev mock mode. */
  mock?: {
    /** Rotates the demo keys behind `name`, with or without a World ID attestation. */
    rotate(name: string, attest: boolean): Promise<void>;
  };
};

export function createServices(app: AppConfig): Services {
  if (app.mockEns) {
    const rotations = localRotationStore();
    const attestations = localAttestationStore();
    return {
      resolve: createMockResolver(rotations),
      lookupAttestation: createAttestationLookup({
        attester: MOCK_ATTESTER,
        chainId: app.chainId,
        source: mockAttestationSource(attestations),
      }),
      mock: {
        rotate: (name, attest) => simulateRotation({ name, rotations, attestations, attest, chainId: app.chainId }),
      },
    };
  }
  return {
    resolve: createChainResolver(app),
    lookupAttestation: createAttestationLookup({
      attester: app.attester,
      chainId: app.chainId,
      source: app.apiUrl ? httpAttestationSource(app.apiUrl) : null,
    }),
  };
}
