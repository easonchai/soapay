/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_CHAIN_ID?: string;
  readonly VITE_STEALTH_DISPERSE?: string;
  readonly VITE_RPC_URL?: string;
  readonly VITE_ENS_RPC_URL?: string;
  readonly VITE_WALLETCONNECT_PROJECT_ID?: string;
  readonly VITE_MOCK_ENS?: string;
  readonly VITE_API_URL?: string;
  readonly VITE_ATTESTER?: string;
  readonly VITE_RECIPIENT_URL?: string;
  /** CK alias of VITE_STEALTH_DISPERSE; ours wins when both are set. */
  readonly VITE_STEALTH_DISPERSE_ADDRESS?: string;
  readonly VITE_OTHER_APP_URL?: string;
  /** Base Sepolia pay token (D-52). Empty = Soapay's mock USDC. */
  readonly VITE_PAY_TOKEN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
