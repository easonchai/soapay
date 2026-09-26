import { describe, expect, it } from "vitest";
import { encodeAbiParameters, encodeEventTopics, getAddress, type Address, type Hex } from "viem";
import { erc20Abi } from "../src/abis.js";
import { ENTRYPOINT_V08, MOCK_USDC_BASE_SEPOLIA, SIMPLE_7702_ACCOUNT } from "../src/constants.js";
import type { BatchReceipt, ReceiptLog } from "../src/batch.js";
import { gaslessProofFromReads, readGaslessProof, userOperationEventAbi, type GaslessProofClient } from "../src/gasless.js";
import { CIRCLE_PAYMASTER_V08 } from "../src/paymasters/circle.js";

// Shaped on the live Base Sepolia spend 0x1167b83d… (2026-09-25): the stealth address paid 1 USDC,
// the Circle paymaster pulled 10,843 and refunded 5,177 (net 5,666 = 0.005666 USDC).
const CHAIN = 84532;
const USDC = getAddress("0x036CbD53842c5426634e7929541eC2318f3dCF7e");
const STEALTH = getAddress("0x535a79686fc7c65d2f19ba62c3f99125c2a6f72b");
const OTHER = getAddress("0x9999999999999999999999999999999999999999");
const TO = getAddress("0xbbc1e255d7e3fe918f46a3e31d43426ca16a3bd1");
const BUNDLER = getAddress("0x4337012eaf1f862b8dbdc6b62a01782ae01ef038");
const PAYMASTER = getAddress(CIRCLE_PAYMASTER_V08[CHAIN]);
const OP: Hex = "0x2c91abe48efe0b0a1ca52f4ea57f39216342fc91c57bf9e91a9b3f19b215d5b5";
const TX: Hex = "0x1167b83dfab7476ac32b286b890fdcfdba396766d9389778568d949cbffc1bae";
const DESIGNATOR = `0xef0100${SIMPLE_7702_ACCOUNT.slice(2).toLowerCase()}` as Hex;

/** The pay token on Base Sepolia is the mock (D-52); Circle's paymaster still charges Circle USDC. */
const PAY_TOKEN = getAddress(MOCK_USDC_BASE_SEPOLIA);

function transfer(from: Address, to: Address, value: bigint, i: number, token: Address = USDC): ReceiptLog {
  return {
    address: token,
    topics: encodeEventTopics({ abi: erc20Abi, eventName: "Transfer", args: { from, to } }) as Hex[],
    data: encodeAbiParameters([{ type: "uint256" }], [value]),
    logIndex: i,
  };
}

function userOpEvent(sender: Address, paymaster: Address, i: number, hash: Hex = OP): ReceiptLog {
  return {
    address: ENTRYPOINT_V08,
    topics: encodeEventTopics({ abi: userOperationEventAbi, eventName: "UserOperationEvent", args: { userOpHash: hash, sender, paymaster } }) as Hex[],
    data: encodeAbiParameters(
      [{ type: "uint256" }, { type: "bool" }, { type: "uint256" }, { type: "uint256" }],
      [0n, true, 1_747_000_000_000n, 180_000n],
    ),
    logIndex: i,
  };
}

function receipt(logs: ReceiptLog[]): BatchReceipt {
  return { transactionHash: TX, blockNumber: 47_300_050n, from: BUNDLER, to: ENTRYPOINT_V08, status: "success", logs };
}

const LIVE_LOGS = [
  transfer(STEALTH, PAYMASTER, 10_843n, 1),
  transfer(STEALTH, TO, 1_000_000n, 3),
  transfer(PAYMASTER, STEALTH, 5_177n, 4),
  userOpEvent(STEALTH, PAYMASTER, 6),
];

describe("gaslessProofFromReads", () => {
  it("maps the live spend: 0 ETH, delegated to Simple7702Account, Circle paymaster, net USDC fee", () => {
    const p = gaslessProofFromReads({ address: STEALTH, ethBalance: 0n, nonce: 1, code: DESIGNATOR, receipt: receipt(LIVE_LOGS) }, { chainId: CHAIN });
    expect(p.ethBalance).toBe(0n);
    expect(p.account).toEqual({ kind: "delegated", delegate: getAddress(SIMPLE_7702_ACCOUNT), simple7702: true });
    expect(p.neverSentTx).toBe(true);
    expect(p.spend).toMatchObject({
      txHash: TX,
      submitter: BUNDLER,
      userOpHash: OP,
      paymaster: PAYMASTER,
      paymasterKind: "circle",
      success: true,
      usdcFee: 5_666n,
    });
  });

  it("claims nothing about sent transactions unless nonce is exactly 1 with a delegation", () => {
    const base = { address: STEALTH, ethBalance: 0n, code: DESIGNATOR };
    expect(gaslessProofFromReads({ ...base, nonce: 2 }, { chainId: CHAIN }).neverSentTx).toBeNull();
    expect(gaslessProofFromReads({ ...base, nonce: 1, code: "0x" }, { chainId: CHAIN }).neverSentTx).toBeNull();
    const eoa = gaslessProofFromReads({ ...base, nonce: 0, code: "0x" }, { chainId: CHAIN });
    expect(eoa.account.kind).toBe("eoa");
    expect(eoa.spend).toBeNull();
  });

  it("reports ETH honestly and flags a delegate other than Simple7702Account", () => {
    const other = `0xef0100${OTHER.slice(2)}` as Hex;
    const p = gaslessProofFromReads({ address: STEALTH, ethBalance: 5n, nonce: 1, code: other }, { chainId: CHAIN });
    expect(p.ethBalance).toBe(5n);
    expect(p.account).toMatchObject({ kind: "delegated", delegate: OTHER, simple7702: false });
  });

  it("picks this address's userOp from a bundle and ignores other senders", () => {
    const logs = [userOpEvent(OTHER, PAYMASTER, 0, `0x${"77".repeat(32)}`), ...LIVE_LOGS];
    const p = gaslessProofFromReads({ address: STEALTH, ethBalance: 0n, nonce: 1, code: DESIGNATOR, receipt: receipt(logs) }, { chainId: CHAIN });
    expect(p.spend?.userOpHash).toBe(OP);
    const none = gaslessProofFromReads(
      { address: STEALTH, ethBalance: 0n, nonce: 1, code: DESIGNATOR, receipt: receipt([userOpEvent(OTHER, PAYMASTER, 0)]) },
      { chainId: CHAIN },
    );
    expect(none.spend).toBeNull();
  });

  it("no paymaster: no USDC fee claimed", () => {
    const zero = getAddress("0x0000000000000000000000000000000000000000");
    const p = gaslessProofFromReads(
      { address: STEALTH, ethBalance: 0n, nonce: 1, code: DESIGNATOR, receipt: receipt([userOpEvent(STEALTH, zero, 0)]) },
      { chainId: CHAIN },
    );
    expect(p.spend).toMatchObject({ paymaster: null, paymasterKind: null, usdcFee: null });
  });

  it("an unknown paymaster is 'other'", () => {
    const p = gaslessProofFromReads(
      { address: STEALTH, ethBalance: 0n, nonce: 1, code: DESIGNATOR, receipt: receipt([transfer(STEALTH, OTHER, 9n, 0, PAY_TOKEN), userOpEvent(STEALTH, OTHER, 1)]) },
      { chainId: CHAIN },
    );
    expect(p.spend).toMatchObject({ paymaster: OTHER, paymasterKind: "other", usdcFee: 9n });
  });

  it("a paymaster that took nothing is 'sponsored' (testnet sponsorship, D-52)", () => {
    const p = gaslessProofFromReads(
      {
        address: STEALTH,
        ethBalance: 0n,
        nonce: 1,
        code: DESIGNATOR,
        receipt: receipt([transfer(STEALTH, TO, 1_000_000n, 0, PAY_TOKEN), userOpEvent(STEALTH, OTHER, 1)]),
      },
      { chainId: CHAIN },
    );
    expect(p.spend).toMatchObject({ paymaster: OTHER, paymasterKind: "sponsored", usdcFee: 0n });
  });
});

describe("readGaslessProof", () => {
  it("reads balance, nonce, code and the receipt", async () => {
    const client = {
      getBalance: async () => 0n,
      getTransactionCount: async () => 1,
      getCode: async () => DESIGNATOR,
      getTransactionReceipt: async () => receipt(LIVE_LOGS),
    } as unknown as GaslessProofClient;
    const p = await readGaslessProof({ client, address: STEALTH, chainId: CHAIN, txHash: TX });
    expect(p.spend?.usdcFee).toBe(5_666n);
    const noTx = await readGaslessProof({ client, address: STEALTH, chainId: CHAIN });
    expect(noTx.spend).toBeNull();
  });
});
