import {
  concat,
  encodePacked,
  getAddress,
  hexToBigInt,
  maxUint256,
  numberToHex,
  parseAbi,
  size,
  slice,
  type Address,
  type Chain,
  type Hex,
  type LocalAccount,
  type PublicClient,
  type Transport,
} from "viem";
import type { UserOperation } from "viem/account-abstraction";
import { getChainConfig } from "../constants.js";
import type { PaymasterAdapter, PaymasterContext, PaymasterFields } from "./types.js";

/**
 * Circle Paymaster v0.8 (TokenPaymasterV08 behind a UUPS proxy), permissionless, USDC only.
 * Source: https://developers.circle.com/paymaster/addresses-and-events (v0.8 tab). Both checked
 * on-chain with eth_getCode; `entryPoint()` returns EntryPoint v0.8 and `token()` returns the
 * chain's USDC.
 */
export const CIRCLE_PAYMASTER_V08 = {
  8453: "0x0578cFB241215b77442a541325d6A4E6dFE700Ec",
  84532: "0x3BA9A96eE3eFf3A69E2B18886AcF52027EFF8966",
} as const satisfies Record<number, Address>;

/** Circle docs quickstart values. postOp must be >= `additionalGasCharge()` (35000 on Base). */
export const CIRCLE_PAYMASTER_VERIFICATION_GAS_LIMIT = 200_000n;
export const CIRCLE_PAYMASTER_POST_OP_GAS_LIMIT = 35_000n;
/** Mode byte; the contract reserves it and currently only 0 is used. */
export const CIRCLE_PAYMASTER_MODE = 0;

/** Byte offsets inside `paymasterAndData`, copied from BaseTokenPaymaster.sol. */
export const CIRCLE_PAYMASTER_TOKEN_ADDRESS_OFFSET = 20 + 32 + 1;
export const CIRCLE_PAYMASTER_PERMIT_AMOUNT_OFFSET = CIRCLE_PAYMASTER_TOKEN_ADDRESS_OFFSET + 20;
export const CIRCLE_PAYMASTER_PERMIT_SIGNATURE_OFFSET = CIRCLE_PAYMASTER_PERMIT_AMOUNT_OFFSET + 32;

export const circlePaymasterAbi = parseAbi([
  "function fetchPrice() view returns (uint256)",
  "function additionalGasCharge() view returns (uint32)",
  "function feeSpread() view returns (uint32)",
  "function token() view returns (address)",
]);

const eip2612Abi = parseAbi([
  "function name() view returns (string)",
  "function version() view returns (string)",
  "function nonces(address owner) view returns (uint256)",
]);

/**
 * paymasterData = encodePacked(uint8 mode, address token, uint256 permitAmount, bytes permitSignature).
 * The EIP-2612 permit has spender = paymaster and deadline = MAX_UINT256 (the paymaster cannot read
 * block.timestamp under ERC-4337 rules).
 */
export function encodeCirclePaymasterData(args: { token: Address; permitAmount: bigint; permitSignature: Hex }): Hex {
  return encodePacked(
    ["uint8", "address", "uint256", "bytes"],
    [CIRCLE_PAYMASTER_MODE, args.token, args.permitAmount, args.permitSignature],
  );
}

/** Mirrors `BaseTokenPaymaster.parsePermitData(paymasterAndData)` for tests and debugging. */
export function parseCirclePaymasterAndData(paymasterAndData: Hex) {
  if (size(paymasterAndData) < CIRCLE_PAYMASTER_PERMIT_SIGNATURE_OFFSET) throw new Error("Circle paymaster: malformed paymasterAndData");
  return {
    paymaster: getAddress(slice(paymasterAndData, 0, 20)),
    verificationGasLimit: hexToBigInt(slice(paymasterAndData, 20, 36)),
    postOpGasLimit: hexToBigInt(slice(paymasterAndData, 36, 52)),
    mode: Number(hexToBigInt(slice(paymasterAndData, 52, 53))),
    token: getAddress(slice(paymasterAndData, CIRCLE_PAYMASTER_TOKEN_ADDRESS_OFFSET, CIRCLE_PAYMASTER_PERMIT_AMOUNT_OFFSET)),
    permitAmount: hexToBigInt(slice(paymasterAndData, CIRCLE_PAYMASTER_PERMIT_AMOUNT_OFFSET, CIRCLE_PAYMASTER_PERMIT_SIGNATURE_OFFSET)),
    permitSignature: slice(paymasterAndData, CIRCLE_PAYMASTER_PERMIT_SIGNATURE_OFFSET),
  };
}

/** EntryPoint v0.8 `paymasterAndData` packing: paymaster | uint128 verifGas | uint128 postOpGas | data. */
export function packPaymasterAndData(f: Required<Pick<PaymasterFields, "paymaster" | "paymasterData" | "paymasterVerificationGasLimit" | "paymasterPostOpGasLimit">>): Hex {
  return concat([
    f.paymaster,
    numberToHex(f.paymasterVerificationGasLimit, { size: 16 }),
    numberToHex(f.paymasterPostOpGasLimit, { size: 16 }),
    f.paymasterData,
  ]);
}

/** EntryPoint v0.7/v0.8 `_getRequiredPrefund`: all gas limits times maxFeePerGas. */
export function userOpMaxCost(op: Pick<UserOperation<"0.8">, "callGasLimit" | "verificationGasLimit" | "preVerificationGas" | "maxFeePerGas"> & {
  paymasterVerificationGasLimit?: bigint | undefined;
  paymasterPostOpGasLimit?: bigint | undefined;
}): bigint {
  const gas =
    op.verificationGasLimit +
    op.callGasLimit +
    (op.paymasterVerificationGasLimit ?? 0n) +
    (op.paymasterPostOpGasLimit ?? 0n) +
    op.preVerificationGas;
  return gas * op.maxFeePerGas;
}

/**
 * The USDC the Circle paymaster pulls in `validatePaymasterUserOp` (FeeLib.calculateUserChargeWithSpread):
 *   base = ((additionalGasCharge * maxFeePerGas + maxCost) * price) / 1e18 + 1
 *   total = base + base * feeSpread / 10000
 * `price` is `fetchPrice()`: 1 ETH in token base units. postOp refunds the unused part.
 */
export function circlePrefund(args: {
  maxCost: bigint;
  maxFeePerGas: bigint;
  nativeTokenPrice: bigint;
  additionalGasCharge: bigint;
  feeSpreadBips: bigint;
}): bigint {
  const base = ((args.additionalGasCharge * args.maxFeePerGas + args.maxCost) * args.nativeTokenPrice) / 10n ** 18n + 1n;
  return base + (base * args.feeSpreadBips) / 10_000n;
}

export type CirclePaymasterOptions = {
  /** Paymaster address overrides per chain id. */
  addresses?: Partial<Record<number, Address>>;
  /** Headroom on the quoted fee for oracle moves between quote and inclusion. Default 500 (5%). */
  priceBufferBps?: bigint;
};

export async function signUsdcPermit(args: {
  publicClient: PublicClient<Transport, Chain>;
  owner: LocalAccount;
  token: Address;
  spender: Address;
  value: bigint;
  chainId: number;
}): Promise<Hex> {
  const { publicClient, owner, token } = args;
  const [name, version, nonce] = await Promise.all([
    publicClient.readContract({ address: token, abi: eip2612Abi, functionName: "name" }),
    publicClient.readContract({ address: token, abi: eip2612Abi, functionName: "version" }),
    publicClient.readContract({ address: token, abi: eip2612Abi, functionName: "nonces", args: [owner.address] }),
  ]);
  if (!owner.signTypedData) throw new Error("Circle paymaster: owner cannot sign typed data");
  // Raw 65-byte ECDSA signature. Once the account is delegated, USDC checks it through
  // ERC-1271, and Simple7702Account.isValidSignature recovers it against address(this).
  return owner.signTypedData({
    domain: { name, version, chainId: args.chainId, verifyingContract: token },
    types: {
      Permit: [
        { name: "owner", type: "address" },
        { name: "spender", type: "address" },
        { name: "value", type: "uint256" },
        { name: "nonce", type: "uint256" },
        { name: "deadline", type: "uint256" },
      ],
    },
    primaryType: "Permit",
    message: { owner: owner.address, spender: args.spender, value: args.value, nonce, deadline: maxUint256 },
  });
}

/**
 * Circle Paymaster v0.8 adapter. The permit amount is the fee cap (`maxFeeUsdc`), so the paymaster's
 * allowance is never unbounded. The permit does not depend on the userOp, so a real one is signed
 * for gas estimation too, and the stub is final.
 */
export function circlePaymaster(options: CirclePaymasterOptions = {}): PaymasterAdapter {
  const bufferBps = options.priceBufferBps ?? 500n;
  const addressFor = (chainId: number): Address => {
    const a = options.addresses?.[chainId] ?? (CIRCLE_PAYMASTER_V08 as Record<number, Address>)[chainId];
    if (!a) throw new Error(`Circle paymaster: no v0.8 deployment known for chain ${chainId}`);
    return a;
  };
  const feeToken = (chainId: number) => getChainConfig(chainId).usdc;

  async function fields(ctx: PaymasterContext): Promise<PaymasterFields> {
    const paymaster = addressFor(ctx.chainId);
    const token = feeToken(ctx.chainId);
    const permitSignature = await signUsdcPermit({
      publicClient: ctx.publicClient,
      owner: ctx.owner,
      token,
      spender: paymaster,
      value: ctx.maxFee,
      chainId: ctx.chainId,
    });
    return {
      paymaster,
      paymasterData: encodeCirclePaymasterData({ token, permitAmount: ctx.maxFee, permitSignature }),
      paymasterVerificationGasLimit: CIRCLE_PAYMASTER_VERIFICATION_GAS_LIMIT,
      paymasterPostOpGasLimit: CIRCLE_PAYMASTER_POST_OP_GAS_LIMIT,
      isFinal: true,
    };
  }

  return {
    name: "circle",
    feeToken,
    getPaymasterStubData: (_op, ctx) => fields(ctx),
    getPaymasterData: (_op, ctx) => fields(ctx),
    async quoteMaxFee(op, ctx) {
      const address = addressFor(ctx.chainId);
      const [price, additionalGasCharge, feeSpread] = await Promise.all([
        ctx.publicClient.readContract({ address, abi: circlePaymasterAbi, functionName: "fetchPrice" }),
        ctx.publicClient.readContract({ address, abi: circlePaymasterAbi, functionName: "additionalGasCharge" }),
        ctx.publicClient.readContract({ address, abi: circlePaymasterAbi, functionName: "feeSpread" }),
      ]);
      const prefund = circlePrefund({
        maxCost: userOpMaxCost(op),
        maxFeePerGas: op.maxFeePerGas,
        nativeTokenPrice: price,
        additionalGasCharge: BigInt(additionalGasCharge),
        feeSpreadBips: BigInt(feeSpread),
      });
      return ceilDiv(prefund * (10_000n + bufferBps), 10_000n);
    },
  };
}

function ceilDiv(a: bigint, b: bigint): bigint {
  return (a + b - 1n) / b;
}
