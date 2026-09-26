import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { encodeAbiParameters, encodeEventTopics, getAddress, type Address, type Hash, type Hex } from "viem";
import { ANNOUNCER_ADDRESS, announcerAbi, erc20Abi, payRunBatchFromReceipt, type ReceiptLog } from "@soapay/sdk";
import { landedTxs, onChainRows, plannedRows } from "../src/lib/onchain.js";
import type { RunRecord } from "../src/lib/run.js";
import { CoworkerViewPanel } from "../src/pages/CoworkerViewPanel.js";

const USDC = getAddress("0x028D969c20b740582428f5043954c380686214Bb"); // Base Sepolia mock USDC (D-52)
const EMPLOYER = getAddress("0x7757a7c9f4ed02a02353a7929cfb399e9286f52c");
const DISPERSE = getAddress("0x6B7a1cC570Af2DDd427DA694351438F0FE8039CA");
const TX: Hash = `0x${"24".repeat(32)}`;
const UNIT = 1_000_000n;
const a = (n: number) => getAddress(`0x${n.toString(16).padStart(40, "0")}`);

// Two employees, alice paid in two chunks: lines sorted by address, as the contract requires.
const LINES = [
  { employeeId: "1", name: "alice.soapay.eth", amount: 500n * UNIT, stealthAddress: a(0x10) },
  { employeeId: "2", name: "bob.soapay.eth", amount: 300n * UNIT, stealthAddress: a(0x20) },
  { employeeId: "1", name: "alice.soapay.eth", amount: 200n * UNIT, stealthAddress: a(0x30) },
];

function run(landed: boolean): RunRecord {
  return {
    id: "r1",
    createdAt: 0,
    chainId: 84532,
    path: "disperse",
    token: USDC,
    payer: EMPLOYER,
    denomination: null,
    carryOut: {},
    carryCommitted: false,
    excluded: [],
    attempts: [
      {
        index: 0,
        startedAt: 0,
        chunks: [{ index: 0, lines: LINES, amount: 1_000n * UNIT, status: landed ? "landed" : "pending", ...(landed ? { txHash: TX } : {}) }],
      },
    ],
  };
}

function receiptLogs(lines: { stealthAddress: Address; amount: bigint }[]): ReceiptLog[] {
  return lines.flatMap((l, i) => [
    {
      address: USDC,
      topics: encodeEventTopics({ abi: erc20Abi, eventName: "Transfer", args: { from: EMPLOYER, to: l.stealthAddress } }) as Hex[],
      data: encodeAbiParameters([{ type: "uint256" }], [l.amount]),
      logIndex: 2 * i,
    },
    {
      address: ANNOUNCER_ADDRESS,
      topics: encodeEventTopics({ abi: announcerAbi, eventName: "Announcement", args: { schemeId: 1n, stealthAddress: l.stealthAddress, caller: DISPERSE } }) as Hex[],
      data: encodeAbiParameters([{ type: "bytes" }, { type: "bytes" }], [`0x02${"11".repeat(32)}`, "0x00"]),
      logIndex: 2 * i + 1,
    },
  ]);
}

const batch = () =>
  payRunBatchFromReceipt({ transactionHash: TX, blockNumber: 1n, from: EMPLOYER, to: DISPERSE, logs: receiptLogs(LINES) }, { token: USDC });

afterEach(() => cleanup());

describe("run on-chain view", () => {
  it("landedTxs lists landed transactions once", () => {
    expect(landedTxs(run(true))).toEqual([TX]);
    expect(landedTxs(run(false))).toEqual([]);
  });

  it("joins the chain's lines with the employer's names", () => {
    const rows = onChainRows(run(true), [batch()]);
    expect(rows.map((r) => [r.line, r.stealthAddress, r.amount, r.name])).toEqual([
      [1, a(0x10), 500n * UNIT, "alice.soapay.eth"],
      [2, a(0x20), 300n * UNIT, "bob.soapay.eth"],
      [3, a(0x30), 200n * UNIT, "alice.soapay.eth"],
    ]);
    // A line the record doesn't know stays unnamed rather than guessed.
    const stray = payRunBatchFromReceipt(
      { transactionHash: TX, blockNumber: 1n, from: EMPLOYER, to: DISPERSE, logs: receiptLogs([{ stealthAddress: a(0x99), amount: 1n }]) },
      { token: USDC },
    );
    expect(onChainRows(run(true), [stray])[0]!.name).toBeNull();
  });

  it("plannedRows is the latest attempt sorted by address", () => {
    expect(plannedRows(run(false)).map((r) => r.stealthAddress)).toEqual([a(0x10), a(0x20), a(0x30)]);
  });

  it("panel: landed → chain lines with Basescan link and names only in the employer column", () => {
    const r = run(true);
    render(
      <CoworkerViewPanel
        onChain={{ rows: onChainRows(r, [batch()]), planned: plannedRows(r), landed: 1, loading: false, error: null }}
        txUrl={(h) => `https://sepolia.basescan.org/tx/${h}`}
      />,
    );
    const panel = screen.getByTestId("coworker-view");
    expect(panel.textContent).toMatch(/Read from 1 transaction on-chain/);
    expect(within(panel).getByRole("link").getAttribute("href")).toBe(`https://sepolia.basescan.org/tx/${TX}`);
    expect(within(panel).getAllByText("alice.soapay.eth")).toHaveLength(2);
    expect(within(panel).getByText("300.00")).toBeTruthy();
  });

  it("panel: nothing landed → a labelled preview, no chain claim", () => {
    const r = run(false);
    render(<CoworkerViewPanel onChain={{ rows: [], planned: plannedRows(r), landed: 0, loading: false, error: null }} txUrl={(h) => h} />);
    const panel = screen.getByTestId("coworker-view");
    expect(panel.textContent).toMatch(/Nothing on-chain yet/);
    expect(panel.textContent).toMatch(/Will appear as/);
    expect(within(panel).queryByRole("link")).toBeNull();
  });
});
