/**
 * JSON-RPC error codes a wallet answers dApps with (EIP-1193, EIP-1474, EIP-5792), and the methods
 * this wallet serves over WalletConnect (D-61).
 */

export const RPC = {
  userRejected: 4001,
  unauthorized: 4100,
  unsupportedMethod: 4200,
  unrecognizedChain: 4902,
  invalidParams: -32602,
  internal: -32603,
  /** EIP-5792 */
  unsupportedCapability: 5700,
  unsupportedChain: 5710,
  duplicateId: 5720,
  unknownBundle: 5730,
} as const;

export class RpcError extends Error {
  override name = "RpcError";
  constructor(
    readonly code: number,
    message: string,
  ) {
    super(message);
  }
}

/** Methods the router answers. Anything else gets 4200. `eth_sign` and `eth_signTransaction` are deliberately absent. */
export const SUPPORTED_METHODS = [
  "eth_accounts",
  "eth_requestAccounts",
  "eth_chainId",
  "wallet_switchEthereumChain",
  "eth_sendTransaction",
  "personal_sign",
  "eth_signTypedData_v4",
  "wallet_sendCalls",
  "wallet_getCallsStatus",
  "wallet_getCapabilities",
] as const;

export const SESSION_EVENTS = ["accountsChanged", "chainChanged"] as const;

/** WalletConnect SDK error reasons (the `getSdkError` values), without pulling in @walletconnect/utils. */
export const WC_REASON = {
  userRejected: { code: 5000, message: "User rejected." },
  unsupportedChains: { code: 5100, message: "Unsupported chains." },
  unsupportedMethods: { code: 5101, message: "Unsupported methods." },
  unsupportedNamespaceKey: { code: 5104, message: "Unsupported namespace key." },
  userDisconnected: { code: 6000, message: "User disconnected." },
} as const;

export function toRpcError(e: unknown): { code: number; message: string } {
  if (e instanceof RpcError) return { code: e.code, message: e.message };
  const message = e instanceof Error ? e.message.replace(/^Soapay( spend| dapp)?: /, "") : String(e);
  return { code: RPC.internal, message };
}
