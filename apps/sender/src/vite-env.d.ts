/// <reference types="vite/client" />
interface ImportMetaEnv {
  readonly VITE_CHAIN_ID?: string;
  readonly VITE_RPC_URL?: string;
  readonly VITE_MAINNET_RPC_URL?: string;
  readonly VITE_USDC_ADDRESS?: string;
  readonly VITE_SCAN_CHUNK_SIZE?: string;
  readonly VITE_RELAY_URL?: string;
  readonly VITE_STEALTH_DISPERSE_ADDRESS?: string;
  readonly VITE_OTHER_APP_URL?: string;
}
