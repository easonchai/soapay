/// <reference types="vite/client" />
interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
  readonly VITE_CHAIN_ID?: string;
  readonly VITE_BUNDLER_URL?: string;
  readonly VITE_STEALTH_DISPERSE?: string;
  readonly VITE_RPC_URL?: string;
  readonly VITE_MOCK_API?: string;
  readonly VITE_L1_RPC_URL?: string;
  readonly VITE_SWAP_VIA_API?: string;
  readonly VITE_OTHER_APP_URL?: string;
  /** CK alias of VITE_STEALTH_DISPERSE; ours wins when both are set. */
  readonly VITE_STEALTH_DISPERSE_ADDRESS?: string;
  /** CK alias: its origin is used as VITE_API_URL when that is unset. */
  readonly VITE_RELAY_URL?: string;
}
