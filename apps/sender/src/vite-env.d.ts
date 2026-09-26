/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_CHAIN_ID?: string;
  readonly VITE_STEALTH_DISPERSE?: string;
  readonly VITE_RPC_URL?: string;
  readonly VITE_ENS_RPC_URL?: string;
  readonly VITE_WALLETCONNECT_PROJECT_ID?: string;
  readonly VITE_MOCK_ENS?: string;
  /** "1" makes the build default to demo mode (sample data, nothing on-chain); `?demo=0` still turns it off. */
  readonly VITE_DEMO?: string;
  readonly VITE_API_URL?: string;
  readonly VITE_ATTESTER?: string;
  readonly VITE_RECIPIENT_URL?: string;
  /** CK alias of VITE_STEALTH_DISPERSE; ours wins when both are set. */
  readonly VITE_STEALTH_DISPERSE_ADDRESS?: string;
  readonly VITE_OTHER_APP_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
