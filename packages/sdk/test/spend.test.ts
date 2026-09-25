import { describe, expect, it } from "vitest";
import {
  createPublicClient,
  custom,
  decodeFunctionData,
  encodeFunctionResult,
  erc20Abi,
  getAddress,
  hexToBigInt,
  maxUint256,
  numberToHex,
  parseAbi,
  recoverTypedDataAddress,
  type Address,
  type Hex,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import { recoverAuthorizationAddress } from "viem/utils";
import { getUserOperationTypedData } from "viem/account-abstraction";
import {
  CHAINS,
  CIRCLE_PAYMASTER_PERMIT_AMOUNT_OFFSET,
  CIRCLE_PAYMASTER_PERMIT_SIGNATURE_OFFSET,
  CIRCLE_PAYMASTER_TOKEN_ADDRESS_OFFSET,
  CIRCLE_PAYMASTER_V08,
  DEFAULT_MAX_FEE_USDC,
  ENTRYPOINT_V08,
  FeeTooHighError,
  InsufficientBalanceError,
  SIMPLE_7702_ACCOUNT,
  circlePrefund,
  createSpendClient,
  encodeCirclePaymasterData,
  estimateSpend,
  isDelegated,
  maxSendable,
  packPaymasterAndData,
  parseCirclePaymasterAndData,
  parseDelegationDesignator,
  spendFromStealth,
  spendMany,
  userOpMaxCost,
} from "../src/index.js";

const CHAIN_ID = baseSepolia.id;
const USDC = CHAINS[CHAIN_ID].usdc;
const PAYMASTER = CIRCLE_PAYMASTER_V08[CHAIN_ID];
const DEST = "0x000000000000000000000000000000000000dEaD" as Address;

// Fixed gas world so fee math is checkable by hand.
const GAS = { preVerificationGas: 50_000n, verificationGasLimit: 100_000n, callGasLimit: 60_000n };
const FEES = { maxFeePerGas: 2_000_000n, maxPriorityFeePerGas: 1_000_000n };
const PRICE = 3_000_000_000n; // 1 ETH = 3000 USDC (6 decimals), as fetchPrice() returns
const ADDITIONAL_GAS = 35_000n;

const simpleAbi = parseAbi([
  "function execute(address target, uint256 value, bytes data)",
  "function executeBatch((address target, uint256 value, bytes data)[] calls)",
]);
const mockAbi = parseAbi([
  "function name() view returns (string)",
  "function version() view returns (string)",
  "function nonces(address) view returns (uint256)",
  "function balanceOf(address) view returns (uint256)",
  "function fetchPrice() view returns (uint256)",
  "function additionalGasCharge() view returns (uint32)",
  "function feeSpread() view returns (uint32)",
  "function getNonce(address sender, uint192 key) view returns (uint256)",
]);

type RpcUserOp = Record<string, Hex | Record<string, Hex> | undefined> & { sender: Address; callData: Hex };

function mockWorld(opts: { code?: Record<string, Hex>; balances?: Record<string, bigint>; feeSpread?: number } = {}) {
  const code = Object.fromEntries(Object.entries(opts.code ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
  const balances = Object.fromEntries(Object.entries(opts.balances ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
  const sent: RpcUserOp[] = [];
  const estimated: RpcUserOp[] = [];
  const log: string[] = [];

  const chain = custom({
    async request({ method, params }: { method: string; params?: unknown }) {
      log.push(method);
      const p = (params ?? []) as unknown[];
      switch (method) {
        case "eth_chainId":
          return numberToHex(CHAIN_ID);
        case "eth_getCode":
          return code[(p[0] as string).toLowerCase()] ?? "0x";
        case "eth_getTransactionCount":
          return "0x0";
        case "eth_call": {
          const { to, data } = p[0] as { to: Address; data: Hex };
          const { functionName, args } = decodeFunctionData({ abi: mockAbi, data });
          const ret = (value: unknown) => encodeFunctionResult({ abi: mockAbi, functionName, result: value } as never);
          if (getAddress(to) === getAddress(USDC)) {
            if (functionName === "name") return ret("USDC");
            if (functionName === "version") return ret("2");
            if (functionName === "nonces") return ret(0n);
            if (functionName === "balanceOf") return ret(balances[(args![0] as string).toLowerCase()] ?? 0n);
          }
          if (getAddress(to) === getAddress(PAYMASTER)) {
            if (functionName === "fetchPrice") return ret(PRICE);
            if (functionName === "additionalGasCharge") return ret(Number(ADDITIONAL_GAS));
            if (functionName === "feeSpread") return ret(opts.feeSpread ?? 0);
          }
          if (getAddress(to) === getAddress(ENTRYPOINT_V08) && functionName === "getNonce") return ret(0n);
          throw new Error(`unexpected eth_call ${to} ${functionName}`);
        }
        default:
          throw new Error(`unexpected chain rpc ${method}`);
      }
    },
  });

  const bundler = custom({
    async request({ method, params }: { method: string; params?: unknown }) {
      log.push(method);
      const p = (params ?? []) as unknown[];
      switch (method) {
        case "eth_chainId":
          return numberToHex(CHAIN_ID);
        case "eth_estimateUserOperationGas":
          estimated.push(p[0] as RpcUserOp);
          expect(p[1]).toBe(ENTRYPOINT_V08);
          return {
            preVerificationGas: numberToHex(GAS.preVerificationGas),
            verificationGasLimit: numberToHex(GAS.verificationGasLimit),
            callGasLimit: numberToHex(GAS.callGasLimit),
          };
        case "eth_sendUserOperation":
          sent.push(p[0] as RpcUserOp);
          expect(p[1]).toBe(ENTRYPOINT_V08);
          return numberToHex(sent.length, { size: 32 });
        case "eth_getUserOperationReceipt":
          return {
            userOpHash: p[0],
            entryPoint: ENTRYPOINT_V08,
            sender: sent.at(-1)!.sender,
            nonce: "0x0",
            actualGasCost: "0x1",
            actualGasUsed: "0x1",
            success: true,
            logs: [],
            receipt: {
              transactionHash: numberToHex(0xabc, { size: 32 }),
              blockHash: numberToHex(1, { size: 32 }),
              blockNumber: "0x1",
              transactionIndex: "0x0",
              from: DEST,
              to: ENTRYPOINT_V08,
              cumulativeGasUsed: "0x1",
              gasUsed: "0x1",
              effectiveGasPrice: "0x1",
              contractAddress: null,
              logs: [],
              logsBloom: `0x${"00".repeat(256)}`,
              status: "0x1",
              type: "0x2",
            },
          };
        default:
          throw new Error(`unexpected bundler rpc ${method}`);
      }
    },
  });

  const publicClient = createPublicClient({ chain: baseSepolia, transport: chain });
  const client = createSpendClient({
    chainId: CHAIN_ID,
    publicClient,
    bundlerTransport: bundler,
    estimateFeesPerGas: async () => FEES,
  });
  return { client, sent, estimated, log };
}

const designator = (a: Address) => `0xef0100${a.slice(2).toLowerCase()}` as Hex;

function decodeTransfer(callData: Hex) {
  const exec = decodeFunctionData({ abi: simpleAbi, data: callData });
  expect(exec.functionName).toBe("execute");
  const [target, value, data] = exec.args as readonly [Address, bigint, Hex];
  expect(value).toBe(0n); // never ETH
  const t = decodeFunctionData({ abi: erc20Abi, data });
  expect(t.functionName).toBe("transfer");
  return { target, to: t.args![0] as Address, amount: t.args![1] as bigint };
}

// Hand-computed Circle prefund for GAS/FEES/PRICE with 5% headroom.
const TOTAL_GAS = GAS.preVerificationGas + GAS.verificationGasLimit + GAS.callGasLimit + 200_000n + 35_000n;
const EXPECTED_PREFUND = ((ADDITIONAL_GAS * FEES.maxFeePerGas + TOTAL_GAS * FEES.maxFeePerGas) * PRICE) / 10n ** 18n + 1n;
const EXPECTED_FEE = (EXPECTED_PREFUND * 10_500n + 9_999n) / 10_000n;

describe("delegation designator", () => {
  it("parses 0xef0100 || address and rejects anything else", () => {
    expect(parseDelegationDesignator(designator(SIMPLE_7702_ACCOUNT))).toBe(SIMPLE_7702_ACCOUNT);
    expect(parseDelegationDesignator("0x")).toBeNull();
    expect(parseDelegationDesignator(undefined)).toBeNull();
    expect(parseDelegationDesignator(`0xef0101${SIMPLE_7702_ACCOUNT.slice(2)}`)).toBeNull();
    expect(parseDelegationDesignator(`${designator(SIMPLE_7702_ACCOUNT)}00`)).toBeNull();
    expect(parseDelegationDesignator("0x6080604052")).toBeNull();
  });

  it("isDelegated distinguishes EOA, our delegate, another delegate and a contract", async () => {
    const other = "0x1111111111111111111111111111111111111111" as Address;
    const a = "0x00000000000000000000000000000000000000a1" as Address;
    const b = "0x00000000000000000000000000000000000000b2" as Address;
    const c = "0x00000000000000000000000000000000000000c3" as Address;
    const d = "0x00000000000000000000000000000000000000d4" as Address;
    const { client } = mockWorld({ code: { [b]: designator(SIMPLE_7702_ACCOUNT), [c]: designator(other), [d]: "0x6080604052" } });
    expect(await isDelegated(client.publicClient, a)).toMatchObject({ kind: "eoa", delegated: false, delegate: null });
    expect(await isDelegated(client.publicClient, b)).toMatchObject({ kind: "delegated", delegated: true, delegate: SIMPLE_7702_ACCOUNT });
    expect(await isDelegated(client.publicClient, c)).toMatchObject({ kind: "delegated", delegated: false, delegate: other });
    expect(await isDelegated(client.publicClient, d)).toMatchObject({ kind: "contract", delegated: false });
  });
});

describe("Circle paymasterData", () => {
  const sig = `0x${"11".repeat(32)}${"22".repeat(32)}1b` as Hex;

  it("matches mode(1) | token(20) | permitAmount(32) | signature byte for byte", () => {
    const data = encodeCirclePaymasterData({ token: USDC, permitAmount: 1_000_000n, permitSignature: sig });
    const expected = `0x00${USDC.slice(2).toLowerCase()}${(1_000_000n).toString(16).padStart(64, "0")}${sig.slice(2)}`;
    expect(data.toLowerCase()).toBe(expected);
    expect((data.length - 2) / 2).toBe(1 + 20 + 32 + 65);
  });

  it("round-trips through the contract's paymasterAndData offsets", () => {
    expect([CIRCLE_PAYMASTER_TOKEN_ADDRESS_OFFSET, CIRCLE_PAYMASTER_PERMIT_AMOUNT_OFFSET, CIRCLE_PAYMASTER_PERMIT_SIGNATURE_OFFSET]).toEqual([53, 73, 105]);
    const paymasterAndData = packPaymasterAndData({
      paymaster: PAYMASTER,
      paymasterVerificationGasLimit: 200_000n,
      paymasterPostOpGasLimit: 35_000n,
      paymasterData: encodeCirclePaymasterData({ token: USDC, permitAmount: 42n, permitSignature: sig }),
    });
    expect(parseCirclePaymasterAndData(paymasterAndData)).toEqual({
      paymaster: PAYMASTER,
      verificationGasLimit: 200_000n,
      postOpGasLimit: 35_000n,
      mode: 0,
      token: getAddress(USDC),
      permitAmount: 42n,
      permitSignature: sig,
    });
  });

  it("prefund follows FeeLib: ((extra*maxFee + maxCost) * price)/1e18 + 1, plus spread", () => {
    const maxCost = userOpMaxCost({ ...GAS, ...FEES, paymasterVerificationGasLimit: 200_000n, paymasterPostOpGasLimit: 35_000n });
    expect(maxCost).toBe(TOTAL_GAS * FEES.maxFeePerGas);
    const args = { maxCost, maxFeePerGas: FEES.maxFeePerGas, nativeTokenPrice: PRICE, additionalGasCharge: ADDITIONAL_GAS };
    expect(circlePrefund({ ...args, feeSpreadBips: 0n })).toBe(EXPECTED_PREFUND);
    expect(EXPECTED_PREFUND).toBe(2881n);
    expect(circlePrefund({ ...args, feeSpreadBips: 1000n })).toBe(2881n + 288n);
  });
});

describe("spendFromStealth", () => {
  it("first spend: includes a real 7702 authorization to Simple7702Account and the 0x7702 initCode marker", async () => {
    const key = generatePrivateKey();
    const from = privateKeyToAccount(key).address;
    const { client, sent, estimated } = mockWorld({ balances: { [from]: 10_000_000n } });

    const res = await spendFromStealth(client, { stealthKey: key, to: DEST, amount: 5_000_000n });
    expect(res.delegated).toBe(true);
    expect(res.txHash).toBe(numberToHex(0xabc, { size: 32 }));
    expect(sent).toHaveLength(1);
    const op = sent[0]!;
    expect(op.sender).toBe(from);
    expect(op.factory).toBe("0x7702");
    const auth = op.eip7702Auth as Record<string, Hex>;
    expect(getAddress(auth.address!)).toBe(SIMPLE_7702_ACCOUNT);
    expect(hexToBigInt(auth.chainId!)).toBe(BigInt(CHAIN_ID));
    expect(hexToBigInt(auth.nonce!)).toBe(0n);
    const signer = await recoverAuthorizationAddress({
      authorization: {
        address: auth.address as Address,
        chainId: CHAIN_ID,
        nonce: 0,
        r: auth.r as Hex,
        s: auth.s as Hex,
        yParity: Number(hexToBigInt(auth.yParity!)),
      },
    });
    expect(signer).toBe(from);
    // The bundler estimated with the same, real authorization (not a stub).
    expect((estimated[0]!.eip7702Auth as Record<string, Hex>).r).toBe(auth.r);

    expect(decodeTransfer(op.callData)).toEqual({ target: getAddress(USDC), to: DEST, amount: 5_000_000n });
    expect(res.feeEstimate).toBe(EXPECTED_FEE);
  });

  it("later spend: no authorization, no initCode when already delegated to Simple7702Account", async () => {
    const key = generatePrivateKey();
    const from = privateKeyToAccount(key).address;
    const { client, sent } = mockWorld({ code: { [from]: designator(SIMPLE_7702_ACCOUNT) }, balances: { [from]: 10_000_000n } });
    const res = await spendFromStealth(client, { stealthKey: key, to: DEST, amount: 1_000_000n });
    expect(res.delegated).toBe(false);
    expect(sent[0]!.eip7702Auth).toBeUndefined();
    expect(sent[0]!.factory).toBeUndefined();
  });

  it("re-delegates when the EOA points at some other delegate", async () => {
    const key = generatePrivateKey();
    const from = privateKeyToAccount(key).address;
    const { client, sent } = mockWorld({
      code: { [from]: designator("0x1111111111111111111111111111111111111111") },
      balances: { [from]: 10_000_000n },
    });
    const res = await spendFromStealth(client, { stealthKey: key, to: DEST, amount: 1_000_000n }, { wait: false });
    expect(res.delegated).toBe(true);
    expect(res.txHash).toBeUndefined();
    expect(getAddress((sent[0]!.eip7702Auth as Record<string, Hex>).address!)).toBe(SIMPLE_7702_ACCOUNT);
  });

  it("sends Circle paymaster fields with a valid EIP-2612 permit for the fee cap", async () => {
    const key = generatePrivateKey();
    const from = privateKeyToAccount(key).address;
    const { client, sent } = mockWorld({ balances: { [from]: 10_000_000n } });
    await spendFromStealth(client, { stealthKey: key, to: DEST, amount: 1n, maxFeeUsdc: 250_000n });
    const op = sent[0]!;
    expect(getAddress(op.paymaster as Hex)).toBe(PAYMASTER);
    expect(hexToBigInt(op.paymasterVerificationGasLimit as Hex)).toBe(200_000n);
    expect(hexToBigInt(op.paymasterPostOpGasLimit as Hex)).toBe(35_000n);

    const pmd = op.paymasterData as Hex;
    expect(pmd.slice(0, 4)).toBe("0x00"); // mode
    expect(getAddress(`0x${pmd.slice(4, 44)}`)).toBe(getAddress(USDC));
    expect(BigInt(`0x${pmd.slice(44, 108)}`)).toBe(250_000n);
    const permitSig = `0x${pmd.slice(108)}` as Hex;
    expect((permitSig.length - 2) / 2).toBe(65);
    const permitSigner = await recoverTypedDataAddress({
      domain: { name: "USDC", version: "2", chainId: CHAIN_ID, verifyingContract: USDC },
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
      message: { owner: from, spender: PAYMASTER, value: 250_000n, nonce: 0n, deadline: maxUint256 },
      signature: permitSig,
    });
    expect(permitSigner).toBe(from);
  });

  it("signs the userOp as the stealth EOA over the EntryPoint v0.8 typed data", async () => {
    const key = generatePrivateKey();
    const from = privateKeyToAccount(key).address;
    const { client, sent } = mockWorld({ balances: { [from]: 10_000_000n } });
    await spendFromStealth(client, { stealthKey: key, to: DEST, amount: 1n });
    const op = sent[0]!;
    const auth = op.eip7702Auth as Record<string, Hex>;
    const n = (h: unknown) => hexToBigInt(h as Hex);
    const typed = getUserOperationTypedData({
      chainId: CHAIN_ID,
      entryPointAddress: ENTRYPOINT_V08,
      userOperation: {
        sender: op.sender,
        nonce: n(op.nonce),
        factory: op.factory as Address,
        factoryData: op.factoryData as Hex,
        callData: op.callData,
        callGasLimit: n(op.callGasLimit),
        verificationGasLimit: n(op.verificationGasLimit),
        preVerificationGas: n(op.preVerificationGas),
        maxFeePerGas: n(op.maxFeePerGas),
        maxPriorityFeePerGas: n(op.maxPriorityFeePerGas),
        paymaster: op.paymaster as Address,
        paymasterVerificationGasLimit: n(op.paymasterVerificationGasLimit),
        paymasterPostOpGasLimit: n(op.paymasterPostOpGasLimit),
        paymasterData: op.paymasterData as Hex,
        signature: op.signature as Hex,
        authorization: { address: auth.address as Address, chainId: CHAIN_ID, nonce: 0, r: auth.r as Hex, s: auth.s as Hex, yParity: 0 },
      },
    });
    expect(await recoverTypedDataAddress({ ...typed, signature: op.signature as Hex })).toBe(from);
    expect(n(op.nonce)).toBe(0n); // key 0, not viem's Date.now() key
  });

  it("rejects a fee above the cap and a balance that cannot cover amount + fee", async () => {
    const key = generatePrivateKey();
    const from = privateKeyToAccount(key).address;
    const { client, sent } = mockWorld({ balances: { [from]: 5_000_000n } });
    await expect(spendFromStealth(client, { stealthKey: key, to: DEST, amount: 1n, maxFeeUsdc: 100n })).rejects.toBeInstanceOf(FeeTooHighError);
    await expect(spendFromStealth(client, { stealthKey: key, to: DEST, amount: 5_000_000n })).rejects.toBeInstanceOf(InsufficientBalanceError);
    expect(sent).toHaveLength(0);
  });
});

describe("estimateSpend / send max", () => {
  it("send max: amount = balance − fee, and the userOp transfers exactly that", async () => {
    const key = generatePrivateKey();
    const from = privateKeyToAccount(key).address;
    const balance = 123_456_789n;
    const { client, sent } = mockWorld({ balances: { [from]: balance } });

    const est = await estimateSpend(client, { stealthKey: key, to: DEST, amount: "max" });
    expect(est.fee).toBe(EXPECTED_FEE);
    expect(est.amount).toBe(balance - EXPECTED_FEE);
    expect(est.maxSendable).toBe(est.amount);
    expect(est.amount + est.fee).toBeLessThanOrEqual(balance);
    expect(est.delegated).toBe(true);
    expect(sent).toHaveLength(0); // estimating never sends

    const res = await spendFromStealth(client, { stealthKey: key, to: DEST, amount: "max" });
    expect(decodeTransfer(sent[0]!.callData).amount).toBe(balance - EXPECTED_FEE);
    expect(res.amount).toBe(balance - EXPECTED_FEE);
  });

  it("send max works when the balance is below the fee cap", async () => {
    const key = generatePrivateKey();
    const from = privateKeyToAccount(key).address;
    const balance = DEFAULT_MAX_FEE_USDC / 2n;
    const { client } = mockWorld({ balances: { [from]: balance } });
    const est = await estimateSpend(client, { stealthKey: key, to: DEST, amount: "max" });
    expect(est.amount).toBe(balance - EXPECTED_FEE);
  });

  it("maxSendable clamps at zero", () => {
    expect(maxSendable(10n, 3n)).toBe(7n);
    expect(maxSendable(3n, 3n)).toBe(0n);
    expect(maxSendable(1n, 3n)).toBe(0n);
  });
});

describe("spendMany", () => {
  it("sends one userOp per stealth address, sequentially, with delay + jitter", async () => {
    const keys = [generatePrivateKey(), generatePrivateKey(), generatePrivateKey()];
    const addrs = keys.map((k) => privateKeyToAccount(k).address);
    const { client, sent } = mockWorld({ balances: Object.fromEntries(addrs.map((a) => [a, 10_000_000n])) });
    const pauses: number[] = [];
    const results = await spendMany(
      client,
      keys.map((stealthKey, i) => ({ stealthKey, to: DEST, amount: BigInt(i + 1) })),
      { delayMs: 1000, jitterMs: 500, random: () => 0.5, sleep: async (ms) => void pauses.push(ms) },
    );
    expect(results.map((r) => r.from)).toEqual(addrs);
    expect(sent.map((op) => op.sender)).toEqual(addrs);
    // Each userOp is a single execute(transfer) from its own sender, never a batch across addresses.
    sent.forEach((op, i) => expect(decodeTransfer(op.callData).amount).toBe(BigInt(i + 1)));
    expect(pauses).toEqual([1250, 1250]);
  });

  it("reports completed spends when one fails", async () => {
    const keys = [generatePrivateKey(), generatePrivateKey()];
    const a0 = privateKeyToAccount(keys[0]!).address;
    const { client } = mockWorld({ balances: { [a0]: 10_000_000n } });
    const err = await spendMany(client, keys.map((stealthKey) => ({ stealthKey, to: DEST, amount: 1n }))).catch((e) => e);
    expect(err.name).toBe("SpendManyError");
    expect(err.failedIndex).toBe(1);
    expect(err.completed).toHaveLength(1);
    expect(err.cause).toBeInstanceOf(InsufficientBalanceError);
  });
});
