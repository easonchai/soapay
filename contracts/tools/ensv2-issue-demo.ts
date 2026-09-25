/**
 * Step 3 (demo, run by whoever holds the issuer key): the whole Soapay name lifecycle on ENSv2
 * Sepolia, exactly as apps/api will run it.
 *
 *   1. make a fresh employee (BIP-39 mnemonic -> registrant key + stealth meta-address)
 *   2. issue <label>.soapay.eth with createEnsV2NameIssuer (own PermissionedResolver + register)
 *   3. resolve `stealth`, `soapay:registrant` and `addr` through viem (ENSv2 Universal Resolver)
 *   4. top up the registrant's gas (what the API sponsors in option A) and let the REGISTRANT
 *      rotate `stealth` with its own key
 *   5. resolve again: the new meta-address is live
 *
 *   SEPOLIA_RPC_URL=... ISSUER_PRIVATE_KEY=0x... pnpm ensv2:issue-demo [label]
 *
 * Env: SEPOLIA_RPC_URL, ISSUER_PRIVATE_KEY, PARENT_LABEL (default soapay),
 *      ENS_SUBNAME_REGISTRY / ENS_RESOLVER_ADMIN (optional; looked up on-chain when unset),
 *      DEMO_GAS_TOPUP_WEI (default 2e15 = 0.002 ETH).
 */
import { getAddress, parseEther, type Address } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { generateMnemonic, keysFromMnemonic } from '../../packages/sdk/src/keys.ts';
import { TEXT_KEY_REGISTRANT, TEXT_KEY_STEALTH } from '../../packages/sdk/src/constants.ts';
import { buildSetStealthRecordCall, createEnsV2NameIssuer } from '../../packages/sdk/src/ensv2.ts';
import { D, clients, env, keyFromEnv, main, parentName, send } from './ensv2-common.ts';

main(async () => {
  const c = await clients();
  const issuerAccount = keyFromEnv('ISSUER_PRIVATE_KEY');
  const parent = parentName();
  const label = (process.argv[2] ?? `demo-${Date.now().toString(36)}`).toLowerCase();
  const name = `${label}.${parent}`;
  const optAddr = (k: string) => (process.env[k]?.trim() ? getAddress(process.env[k]!.trim()) : undefined);

  // 1. A fresh employee. Nothing here leaves this process except public values.
  const mnemonic = generateMnemonic();
  const employee = keysFromMnemonic(mnemonic);
  const registrant = privateKeyToAccount(employee.registrantKey);
  const rotated = keysFromMnemonic(mnemonic, 'rotated device');
  console.log(`employee registrant ${registrant.address}`);
  console.log(`  meta #1 ${employee.metaAddressURI}`);

  // 2. Issue.
  const issuer = createEnsV2NameIssuer({
    walletClient: c.wallet(issuerAccount),
    publicClient: c.publicClient,
    parent,
    registry: optAddr('ENS_SUBNAME_REGISTRY'),
    resolverAdmin: optAddr('ENS_RESOLVER_ADMIN'),
  });
  console.log(`issue ${name} as ${issuerAccount.address}`);
  const issued = await issuer.issue({ label, registrant: registrant.address, metaAddress: employee.metaAddressURI });
  console.log(`  ok  resolver deploy ${issued.resolverTxHash ?? '(reused)'}`);
  console.log(`  ok  register        ${issued.txHash}`);
  console.log(`  resolver ${issued.resolver}, registry ${issued.registry}`);

  // 3. Resolve through viem's ENS actions (Universal Resolver 0xeEeE... on Sepolia).
  const resolve = async () => {
    const opts = { name, universalResolverAddress: D.universalResolver as Address };
    const [stealth, reg, addr] = await Promise.all([
      c.publicClient.getEnsText({ ...opts, key: TEXT_KEY_STEALTH }),
      c.publicClient.getEnsText({ ...opts, key: TEXT_KEY_REGISTRANT }),
      c.publicClient.getEnsAddress(opts),
    ]);
    console.log(`  ${name}: stealth=${stealth}\n    soapay:registrant=${reg} addr=${addr ?? '(unset)'}`);
    return { stealth, reg, addr };
  };
  const first = await resolve();
  if (first.stealth !== employee.metaAddressURI) throw new Error('stealth record mismatch after issuance');
  if (first.reg !== registrant.address) throw new Error('registrant record mismatch');
  if (first.addr) throw new Error('addr must stay unset');

  // 4. Option A rotation: the API tops up gas, the registrant signs setText itself.
  const topUp = BigInt(env('DEMO_GAS_TOPUP_WEI', parseEther('0.002').toString()));
  await send(c, issuerAccount, `gas top-up ${topUp} wei -> registrant`, { to: registrant.address, data: '0x', value: topUp });
  console.log(`rotate stealth -> ${rotated.metaAddressURI}`);
  await send(c, registrant, 'registrant setText(stealth)', buildSetStealthRecordCall({
    name, metaAddress: rotated.metaAddressURI, resolver: issued.resolver,
  }));

  // 5. Resolve again.
  const second = await resolve();
  if (second.stealth !== rotated.metaAddressURI) throw new Error('rotation not visible through the resolver');
  console.log(`done: ${name} issued and rotated.`);
});
