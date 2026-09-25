/**
 * Step 1 (run once by the soapay.eth owner): register `soapay.eth` on ENSv2 Sepolia through the
 * real ETHRegistrar (commit, wait MIN_COMMITMENT_AGE, register), paid in the registrar's testnet
 * MockUSDC (public mint). The parent gets NO resolver and no subregistry here: a parent resolver
 * could answer (ENSIP-10 wildcard) for revoked subnames, and the subregistry is step 2.
 *
 *   SEPOLIA_RPC_URL=... PARENT_OWNER_PRIVATE_KEY=0x... pnpm ensv2:register-parent
 *
 * Env: SEPOLIA_RPC_URL, PARENT_OWNER_PRIVATE_KEY, PARENT_LABEL (default soapay),
 *      REGISTER_DAYS (default 365; the registrar minimum is 28).
 */
import { encodeFunctionData, keccak256, parseAbi, zeroAddress, zeroHash, type Address, type Hex } from 'viem';
import { generatePrivateKey } from 'viem/accounts';
import { D, assertCanHoldNames, clients, env, keyFromEnv, main, parentLabel, send } from './ensv2-common.ts';
import { permissionedRegistryAbi, labelId, REGISTRY_STATUS, type RegistryState } from '../../packages/sdk/src/ensv2.ts';

const registrarAbi = parseAbi([
  'function MIN_COMMITMENT_AGE() view returns (uint64)',
  'function MAX_COMMITMENT_AGE() view returns (uint64)',
  'function MIN_REGISTER_DURATION() view returns (uint64)',
  'function isAvailable(string label) view returns (bool)',
  'function commit(bytes32 commitment)',
  'function makeCommitment(string label, address owner, bytes32 secret, address subregistry, address resolver, uint64 duration, bytes32 referrer) pure returns (bytes32)',
  'function getRegisterPrice(string label, uint64 duration, address paymentToken) view returns (uint256 base, uint256 premium)',
  'function register(string label, address owner, bytes32 secret, address subregistry, address resolver, uint64 duration, address paymentToken, bytes32 referrer) returns (uint256 tokenId)',
]);
const erc20Abi = parseAbi([
  'function mint(address to, uint256 amount)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function balanceOf(address) view returns (uint256)',
]);

main(async () => {
  const c = await clients();
  const owner = keyFromEnv('PARENT_OWNER_PRIVATE_KEY');
  const label = parentLabel();
  const read = <T>(functionName: string, args: readonly unknown[] = []) =>
    c.publicClient.readContract({ address: D.ethRegistrar, abi: registrarAbi, functionName, args } as never) as Promise<T>;

  console.log(`register ${label}.eth for ${owner.address}`);
  if (!(await read<boolean>('isAvailable', [label]))) {
    const st = (await c.publicClient.readContract({
      address: D.ethRegistry,
      abi: permissionedRegistryAbi,
      functionName: 'getState',
      args: [labelId(label)],
    })) as RegistryState;
    if (st.status === REGISTRY_STATUS.REGISTERED && st.latestOwner.toLowerCase() === owner.address.toLowerCase()) {
      console.log(`  ${label}.eth is already yours; nothing to do`);
      return;
    }
    throw new Error(`${label}.eth is not available (owner ${st.latestOwner}); set PARENT_LABEL to another label`);
  }

  await assertCanHoldNames(c, owner.address, 'PARENT_OWNER');

  const minDuration = await read<bigint>('MIN_REGISTER_DURATION');
  let duration = BigInt(env('REGISTER_DAYS', '365')) * 86_400n;
  if (duration < minDuration) duration = minDuration;
  const minAge = await read<bigint>('MIN_COMMITMENT_AGE');
  const [base, premium] = await read<[bigint, bigint]>('getRegisterPrice', [label, duration, D.mockUsdc]);
  const price = base + premium;
  console.log(`  price ${price} MockUSDC units for ${duration / 86_400n} days; commitment age ${minAge}s`);

  // A fresh secret each run; it only has to survive until `register` below.
  const secret = keccak256(generatePrivateKey()) as Hex;
  const commitment = await read<Hex>('makeCommitment', [
    label, owner.address, secret, zeroAddress, zeroAddress, duration, zeroHash,
  ]);

  const usdc = (functionName: 'mint' | 'approve', args: readonly unknown[]) => ({
    to: D.mockUsdc as Address,
    data: encodeFunctionData({ abi: erc20Abi, functionName, args } as never),
  });
  const balance = (await c.publicClient.readContract({
    address: D.mockUsdc, abi: erc20Abi, functionName: 'balanceOf', args: [owner.address],
  })) as bigint;
  if (balance < price) await send(c, owner, 'MockUSDC.mint', usdc('mint', [owner.address, price - balance]));
  await send(c, owner, 'MockUSDC.approve(ETHRegistrar, price)', usdc('approve', [D.ethRegistrar, price]));

  const commitTx = await send(c, owner, 'ETHRegistrar.commit', {
    to: D.ethRegistrar,
    data: encodeFunctionData({ abi: registrarAbi, functionName: 'commit', args: [commitment] }),
  });
  const commitBlock = await c.publicClient.getBlock({
    blockNumber: (await c.publicClient.getTransactionReceipt({ hash: commitTx })).blockNumber,
  });
  // register requires block.timestamp > commit time + MIN_COMMITMENT_AGE: wait for a block past it.
  const readyAt = commitBlock.timestamp + minAge + 1n;
  process.stdout.write(`  waiting until chain time ${readyAt} `);
  for (;;) {
    const head = await c.publicClient.getBlock();
    if (head.timestamp > readyAt) break;
    process.stdout.write('.');
    await new Promise((r) => setTimeout(r, 6_000));
  }
  console.log('');

  await send(c, owner, `ETHRegistrar.register(${label})`, {
    to: D.ethRegistrar,
    data: encodeFunctionData({
      abi: registrarAbi,
      functionName: 'register',
      args: [label, owner.address, secret, zeroAddress, zeroAddress, duration, D.mockUsdc, zeroHash],
    }),
  });
  const st = (await c.publicClient.readContract({
    address: D.ethRegistry, abi: permissionedRegistryAbi, functionName: 'getState', args: [labelId(label)],
  })) as RegistryState;
  if (st.status !== REGISTRY_STATUS.REGISTERED) throw new Error('registration did not land');
  console.log(`done: ${label}.eth owned by ${st.latestOwner}, expires ${new Date(Number(st.expiry) * 1000).toISOString()}`);
});
