import type { Address, Chain, Hex, LocalAccount, PublicClient, Transport } from "viem";
import type { BundlerClient, UserOperation } from "viem/account-abstraction";

/** The userOp as viem hands it to paymaster hooks (gas fields may still be missing at stub time). */
export type PaymasterUserOperation = Partial<UserOperation<"0.8">> &
  Pick<UserOperation<"0.8">, "sender" | "callData" | "nonce">;

/** Paymaster-related userOp fields (EntryPoint v0.7/v0.8 shape, as viem expects them). */
export type PaymasterFields = {
  paymaster: Address;
  paymasterData: Hex;
  paymasterVerificationGasLimit?: bigint;
  paymasterPostOpGasLimit?: bigint;
  /** true when these fields are final and viem must not call `getPaymasterData` again. */
  isFinal?: boolean;
};

/** A call the stealth account makes. `value` is always 0: stealth addresses never touch ETH. */
export type SpendCall = { to: Address; data: Hex; value: 0n };

/** Everything an adapter needs. The owner key stays in memory; adapters may only sign with it. */
export type PaymasterContext = {
  chainId: number;
  entryPoint: Address;
  publicClient: PublicClient<Transport, Chain>;
  bundlerClient: BundlerClient;
  /** The stealth EOA (7702 owner == account address). */
  owner: LocalAccount;
  /** Upper bound on the fee, in fee-token base units. Adapters may use it as the permit/approve amount. */
  maxFee: bigint;
};

/**
 * Pluggable ERC-20 paymaster. The Circle adapter is the default; Pimlico's is an alternative.
 *
 * Contract: the stub and final `paymasterData` must have the same byte length, so the gas the
 * bundler estimated with the stub stays valid.
 */
export interface PaymasterAdapter {
  readonly name: string;
  /** Token the fee is charged in on `chainId`. */
  feeToken(chainId: number): Address;
  /** Extra calls to run before the transfer (e.g. an approve). Default: none. */
  prepareCalls?(ctx: PaymasterContext): Promise<readonly SpendCall[]>;
  /** Fields used for gas estimation. */
  getPaymasterStubData(userOp: PaymasterUserOperation, ctx: PaymasterContext): Promise<PaymasterFields>;
  /** Final fields, called after gas and fees are filled (skipped when the stub returned `isFinal`). */
  getPaymasterData(userOp: PaymasterUserOperation, ctx: PaymasterContext): Promise<PaymasterFields>;
  /**
   * The most fee-token the paymaster can pull for this fully-prepared userOp. The UI shows this as
   * the fee; the unused part is refunded to the stealth address in postOp.
   */
  quoteMaxFee(userOp: UserOperation<"0.8">, ctx: PaymasterContext): Promise<bigint>;
}
