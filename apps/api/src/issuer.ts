import { createPublicClient, createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import { createEnsV2NameIssuer, type EnsV2NameIssuer, type EnsV2PublicClient } from "@soapay/sdk/ensv2";
import type { Config } from "./config.js";
import { NoopNameIssuer, type NameIssuer } from "./hooks.js";
import type { Logger } from "./util.js";

/**
 * Adapts the SDK's ENSv2 issuer to the API's NameIssuer hook.
 *
 * Only `issue` touches the chain: it creates `<label>.<parent>` with its own resolver, whose
 * `stealth` text record the registrant alone may write. There is deliberately no `updateMeta`:
 * under option A (docs/mvp-spec.md §2.1) the registrant calls `setText` itself, and the API's
 * part of a change is the World-ID-gated attestation plus the gas top-up in
 * POST /names/:label/rotation. The issuer key never writes `stealth`.
 */
export function ensV2NameIssuer(inner: EnsV2NameIssuer): NameIssuer {
  return {
    async issue({ label, registrant, metaAddress, agent }) {
      const out = await inner.issue({ label, registrant, metaAddress, ...(agent ? { agent } : {}) });
      return { txHash: out.txHash };
    },
  };
}

/** ENSv2 issuer when ISSUER_PRIVATE_KEY and L1_RPC_URL are set, else the store-only no-op. */
export function makeNameIssuer(config: Config, logger: Logger): NameIssuer {
  if (!config.issuerPrivateKey || !config.l1RpcUrl) {
    logger.warn("ISSUER_PRIVATE_KEY or L1_RPC_URL not set: names are stored only, no ENSv2 subnames are issued");
    return new NoopNameIssuer();
  }
  const transport = http(config.l1RpcUrl, { retryCount: 2, timeout: 30_000 });
  const account = privateKeyToAccount(config.issuerPrivateKey);
  const publicClient = createPublicClient({ chain: sepolia, transport });
  const walletClient = createWalletClient({ chain: sepolia, transport, account });
  logger.info("ENSv2 name issuer enabled", {
    issuer: account.address,
    parent: config.parentName,
    registry: config.ensSubnameRegistry ?? "(looked up on-chain)",
  });
  return ensV2NameIssuer(
    createEnsV2NameIssuer({
      walletClient,
      publicClient: publicClient as unknown as EnsV2PublicClient,
      parent: config.parentName,
      ...(config.ensSubnameRegistry ? { registry: config.ensSubnameRegistry } : {}),
      ...(config.ensResolverAdmin ? { resolverAdmin: config.ensResolverAdmin } : {}),
    }),
  );
}
