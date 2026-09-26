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
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import type { Address } from "viem";
import type { InviteSigner } from "@soapay/sdk";
import { httpInviteApi, mockInviteApi, type InviteApi } from "./invites.js";

export type Services = {
  resolve: Resolver;
  lookupAttestation: AttestationLookup;
  /** Invite links (docs/mvp-spec.md §7). null without VITE_API_URL (outside mock mode). */
  invites: InviteApi | null;
  /** Present only in dev mock mode. */
  mock?: {
    /** The demo wallet can't sign; invites are signed by this throwaway in-memory key. */
    inviteSigner: InviteSigner & { address: Address };
    /** Rotates the demo keys behind `name`, with or without a World ID attestation. */
    rotate(name: string, attest: boolean): Promise<void>;
  };
};

export function createServices(app: AppConfig): Services {
  if (app.mockEns) {
    const rotations = localRotationStore();
    const attestations = localAttestationStore();
    const demoSigner = privateKeyToAccount(generatePrivateKey());
    return {
      invites: mockInviteApi({ claimAfterMs: 4_000 }),
      resolve: createMockResolver(rotations),
      lookupAttestation: createAttestationLookup({
        attester: MOCK_ATTESTER,
        chainId: app.chainId,
        source: mockAttestationSource(attestations),
      }),
      mock: {
        inviteSigner: demoSigner,
        rotate: (name, attest) => simulateRotation({ name, rotations, attestations, attest, chainId: app.chainId }),
      },
    };
  }
  return {
    invites: app.apiUrl ? httpInviteApi(app.apiUrl) : null,
    resolve: createChainResolver(app),
    lookupAttestation: createAttestationLookup({
      attester: app.attester,
      chainId: app.chainId,
      source: app.apiUrl ? httpAttestationSource(app.apiUrl) : null,
    }),
  };
}
