import { describe, it, expect } from 'vitest';
import { getChainConfig } from '../src/index.js';

describe('getChainConfig', () => {
  it('selects Base Sepolia with SDK addresses', () => {
    const c = getChainConfig({ CHAIN_ID: '84532' });
    expect(c.chainId).toBe(84532);
    expect(c.announcer).toBe('0x55649E01B5Df198D18D95b5cc5051630cfD45564');
    expect(c.registry).toBe('0x6538E6bf4B0eBd30A8Ea093027Ac2422ce5d6538');
    expect(c.usdc).toBe('0x036CbD53842c5426634e7929541eC2318f3dCF7e');
    expect(c.scanStartBlock).toBe(7552655n);
    expect(c.scanChunkSize).toBe(2000n);
    expect(c.relayUrl).toBe('http://localhost:8787/relay');
    expect(c.explorer).toBe('https://sepolia.basescan.org');
  });

  it('defaults to Base mainnet', () => {
    const c = getChainConfig({});
    expect(c.chainId).toBe(8453);
    expect(c.usdc).toBe('0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913');
    expect(c.scanStartBlock).toBe(15502414n);
    expect(c.explorer).toBe('https://basescan.org');
  });

  it('honours overrides', () => {
    const c = getChainConfig({
      USDC_ADDRESS: '0x0000000000000000000000000000000000000001',
      SCAN_CHUNK_SIZE: '500',
      STEALTH_DISPERSE_ADDRESS: '0x0000000000000000000000000000000000000002',
    });
    expect(c.usdc).toBe('0x0000000000000000000000000000000000000001');
    expect(c.scanChunkSize).toBe(500n);
    expect(c.stealthDisperse).toBe('0x0000000000000000000000000000000000000002');
    expect(getChainConfig({ STEALTH_DISPERSE_ADDRESS: '0x12' }).stealthDisperse).toBeUndefined();
  });

  it('rejects unsupported chain ids', () => {
    expect(() => getChainConfig({ CHAIN_ID: '1' })).toThrow(/unsupported/i);
  });
});
