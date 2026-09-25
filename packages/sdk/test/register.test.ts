import { describe, it, expect } from 'vitest';
import { verifyTypedData } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { deriveKeysFromSignature, SIGN_MESSAGE } from '../src/index.js';
import { signRegisterOnBehalf } from '../src/index.js';

describe('signRegisterOnBehalf', () => {
  it('produces an EIP-712 signature the registry domain verifies', async () => {
    const wallet = privateKeyToAccount('0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d');
    const keys = deriveKeysFromSignature(await wallet.signMessage({ message: SIGN_MESSAGE }));
    const registry = '0x6538E6bf4B0eBd30A8Ea093027Ac2422ce5d6538' as const;
    const req = await signRegisterOnBehalf({ keys, chainId: 84532, registry, nonce: 0n });
    expect(req.registrant).toBe(keys.registrant);
    expect(req.schemeId).toBe(1);
    expect(req.stealthMetaAddress).toBe(keys.stealthMetaAddress);
    const ok = await verifyTypedData({
      address: keys.registrant,
      domain: { name: 'ERC6538Registry', version: '1.0', chainId: 84532, verifyingContract: registry },
      types: { Erc6538RegistryEntry: [
        { name: 'schemeId', type: 'uint256' }, { name: 'stealthMetaAddress', type: 'bytes' }, { name: 'nonce', type: 'uint256' },
      ] },
      primaryType: 'Erc6538RegistryEntry',
      message: { schemeId: 1n, stealthMetaAddress: keys.stealthMetaAddress, nonce: 0n },
      signature: req.signature,
    });
    expect(ok).toBe(true);
  });
});

describe('findRegistrationBlock', () => {
  it('returns the block of the StealthMetaAddressSet event for the registrant, or null', async () => {
    const { findRegistrationBlock } = await import('../src/index.js');
    const calls: unknown[] = [];
    const pc = {
      getLogs: async (args: unknown) => { calls.push(args); return [{ blockNumber: 123n }]; },
      getBlockNumber: async () => 999n,
    };
    const reg = '0x6538E6bf4B0eBd30A8Ea093027Ac2422ce5d6538' as const;
    const who = '0x00000000000000000000000000000000000000aa' as const;
    expect(await findRegistrationBlock(pc as never, reg, who, 100n)).toBe(123n);
    expect(calls[0]).toMatchObject({ address: reg, args: { registrant: who }, fromBlock: 100n, toBlock: 999n });
    const empty = { getLogs: async () => [], getBlockNumber: async () => 999n };
    expect(await findRegistrationBlock(empty as never, reg, who, 100n)).toBeNull();
  });
});
