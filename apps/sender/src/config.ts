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

/** Hero background from the design brief. External asset; replace with our own before launch. */
export const HERO_VIDEO =
  'https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260405_074625_a81f018a-956b-43fb-9aee-4d1508e30e6a.mp4';
