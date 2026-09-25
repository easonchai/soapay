/**
 * Step 2 (run once by the soapay.eth owner): give soapay.eth its own subname registry and let the
 * API issuer register subnames under it. Idempotent: each step is skipped when already done.
 *
 *   (a) VerifiableFactory.deployProxy(UserRegistryImpl, salt, initialize([{owner, ALL_ROLES}]))
 *   (b) ETHRegistry.setSubregistry(labelhash("soapay"), registry)
 *       registry.setParent(ETHRegistry, "soapay")
 *       registry.grantRootRoles(ROLE_REGISTRAR, issuer)          <- the issuer's ONLY role
 *
 *   SEPOLIA_RPC_URL=... PARENT_OWNER_PRIVATE_KEY=0x... ISSUER_ADDRESS=0x... pnpm ensv2:setup-parent
 *
 * Env: SEPOLIA_RPC_URL, PARENT_OWNER_PRIVATE_KEY, ISSUER_ADDRESS (or ISSUER_PRIVATE_KEY, only its
 *      address is used), PARENT_LABEL (default soapay).
 */
import { getAddress, isAddress, zeroAddress, type Address } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import {
  ISSUER_ROLE_BITMAP,
  buildDeploySubnameRegistryCall,
  buildGrantIssuerRoleCall,
  buildSetParentCall,
  buildSetSubregistryCall,
  getNameOwner,
  permissionedRegistryAbi,
  predictProxyAddress,
  verifiableFactoryAbi,
} from '../../packages/sdk/src/ensv2.ts';
import { D, clients, keyFromEnv, main, parentLabel, parentName, send } from './ensv2-common.ts';

function issuerAddress(): Address {
  const a = process.env.ISSUER_ADDRESS?.trim();
  if (a) {
    if (!isAddress(a)) throw new Error('ISSUER_ADDRESS is not an address');
    return getAddress(a);
  }
  const pk = process.env.ISSUER_PRIVATE_KEY?.trim();
  if (pk) return privateKeyToAccount(pk as `0x${string}`).address;
  throw new Error('set ISSUER_ADDRESS (the API issuer key address)');
}

main(async () => {
  const c = await clients();
  const owner = keyFromEnv('PARENT_OWNER_PRIVATE_KEY');
  const label = parentLabel();
  const parent = parentName();
  const issuer = issuerAddress();
  const read = (address: Address, functionName: string, args: readonly unknown[] = []) =>
    c.publicClient.readContract({ address, abi: permissionedRegistryAbi, functionName, args } as never) as Promise<unknown>;

  const parentOwner = await getNameOwner(c.publicClient, parent);
  if (parentOwner !== owner.address) throw new Error(`${parent} is owned by ${parentOwner}, not ${owner.address}`);
  console.log(`setup ${parent} (owner ${owner.address}), issuer ${issuer}`);

  // (a) subname registry, at a deterministic address per (owner, parent, version 0).
  let registry = (await read(D.ethRegistry, 'getSubregistry', [label])) as Address;
  if (registry === zeroAddress) {
    const deploy = buildDeploySubnameRegistryCall({ parent, admin: owner.address });
    const proxyLogic = (await c.publicClient.readContract({
      address: D.verifiableFactory, abi: verifiableFactoryAbi, functionName: 'proxyLogic',
    })) as Address;
    registry = predictProxyAddress({ factory: D.verifiableFactory, proxyLogic, deployer: owner.address, salt: deploy.salt });
    const code = await c.publicClient.getCode({ address: registry });
    if (code && code !== '0x') console.log(`  registry already deployed at ${registry}`);
    else await send(c, owner, `deploy UserRegistry -> ${registry}`, deploy);
    const impl = await c.publicClient.readContract({
      address: D.verifiableFactory, abi: verifiableFactoryAbi, functionName: 'verifyContract', args: [registry],
    });
    if (impl !== D.userRegistryImpl) throw new Error(`${registry} is not a factory UserRegistry (impl ${impl})`);

    // (b) link it under soapay.eth.
    await send(c, owner, `ETHRegistry.setSubregistry(${label})`, buildSetSubregistryCall({
      parentRegistry: D.ethRegistry, label, subregistry: registry,
    }));
  } else {
    console.log(`  ${parent} already points at registry ${registry}`);
  }

  const [p, l] = (await read(registry, 'getParent')) as [Address, string];
  if (p !== D.ethRegistry || l !== label) {
    await send(c, owner, 'registry.setParent', buildSetParentCall({ registry, parentRegistry: D.ethRegistry, label }));
  } else {
    console.log('  canonical parent already set');
  }

  if (await read(registry, 'hasRootRoles', [ISSUER_ROLE_BITMAP, issuer])) {
    console.log('  issuer already holds ROLE_REGISTRAR');
  } else {
    await send(c, owner, 'registry.grantRootRoles(ROLE_REGISTRAR, issuer)', buildGrantIssuerRoleCall({ registry, issuer }));
  }
  const roles = (await read(registry, 'roles', [0n, issuer])) as bigint;
  console.log(`done: registry ${registry}; issuer root roles 0x${roles.toString(16)} (expect 0x1)`);
  console.log(`API: ENS_SUBNAME_REGISTRY=${registry} ENS_RESOLVER_ADMIN=${owner.address}`);
});
