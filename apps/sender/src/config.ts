import { getChainConfig } from '@soapay/sdk';

/** Vite exposes VITE_* only; map them onto the SDK's env keys. */
export const chainConfig = getChainConfig({
  CHAIN_ID: import.meta.env.VITE_CHAIN_ID,
  RPC_URL: import.meta.env.VITE_RPC_URL,
  MAINNET_RPC_URL: import.meta.env.VITE_MAINNET_RPC_URL,
  USDC_ADDRESS: import.meta.env.VITE_USDC_ADDRESS,
  SCAN_CHUNK_SIZE: import.meta.env.VITE_SCAN_CHUNK_SIZE,
  RELAY_URL: import.meta.env.VITE_RELAY_URL,
  STEALTH_DISPERSE_ADDRESS: import.meta.env.VITE_STEALTH_DISPERSE_ADDRESS,
});

export const OTHER_APP_URL: string =
  import.meta.env.VITE_OTHER_APP_URL ?? (import.meta.env.DEV ? 'http://localhost:5173' : '/');

export const GITHUB = 'https://github.com/easonchai/soapay';


const ORG_KEY = 'soapay:org';
export function getOrgName(): string {
  try {
    return localStorage.getItem(ORG_KEY) ?? '';
  } catch {
    return '';
  }
}
export function setOrgName(v: string) {
  try {
    if (v.trim()) localStorage.setItem(ORG_KEY, v.trim());
    else localStorage.removeItem(ORG_KEY);
  } catch {
    /* ignore */
  }
}
