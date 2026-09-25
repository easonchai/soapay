/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_CHAIN_ID?: string;
  readonly VITE_STEALTH_DISPERSE?: string;
  readonly VITE_RPC_URL?: string;
  readonly VITE_ENS_RPC_URL?: string;
  readonly VITE_WALLETCONNECT_PROJECT_ID?: string;
  readonly VITE_MOCK_ENS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
