import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { Address } from "viem";
import { CSV_TEMPLATE, csvTemplate, parseRosterCsv } from "../src/lib/csv.js";
import { exampleSalaries, TESTNET_RUN_CONFIRM_ABOVE, testnetRunConfirmation } from "../src/lib/testnet.js";
import { ReviewPage } from "../src/pages/ReviewPage.js";
import type { PayPathState, WalletState } from "../src/hooks/usePayPath.js";
import type { PayRunState } from "../src/hooks/usePayRun.js";
import type { RunPlan } from "../src/lib/run.js";

afterEach(cleanup);

describe("testnet defaults (D-47)", () => {
  it("uses small example salaries on a testnet only", () => {
    expect(exampleSalaries(true)).toEqual(["12", "8.5"]);
    expect(exampleSalaries(false)).toEqual(["4200", "3850"]);
  });

  it("offers a small CSV template on a testnet", () => {
    expect(csvTemplate(false)).toBe(CSV_TEMPLATE);
    const r = parseRosterCsv(csvTemplate(true));
    expect(r.issues).toEqual([]);
    expect(r.rows.map((x) => x.amount)).toEqual([12_000_000n, 8_500_000n]);
  });

  it("asks for a confirmation above 50 test USDC, never on mainnet", () => {
    expect(TESTNET_RUN_CONFIRM_ABOVE).toBe(50_000_000n);
    expect(testnetRunConfirmation(50_000_000n, true)).toBeNull();
    expect(testnetRunConfirmation(50_000_001n, true)).toBe("This run sends 50.000001 test USDC; the faucet gives 20 per 2 hours.");
    expect(testnetRunConfirmation(26_600_000_000n, false)).toBeNull();
  });
});

const ADDR = "0x00000000000000000000000000000000000000aa" as Address;
const wallet: WalletState = { address: ADDR, isConnected: true, wrongChain: false, connectors: [], connecting: false, connectError: null, disconnect: () => undefined };
const payPath = {
  probe: { kind: "eoa", capabilities: undefined, disperseDeployed: true, path: { kind: "disperse", title: "StealthDisperse", reason: "" } },
  funding: null,
  loading: false,
  error: null,
  disperseConfigured: true,
  refresh: () => undefined,
} as unknown as PayPathState;
const run = {
  stage: "planned",
  rows: [],
  progress: null,
  plan: null,
  funding: null,
  error: null,
  runId: null,
  safeChunks: null,
  label: "Test",
  setLabel: () => undefined,
  verify: async () => undefined,
  preview: () => undefined,
  execute: async () => undefined,
  exportSafe: async () => undefined,
  downloadSafeChunk: () => undefined,
  reset: () => undefined,
} as PayRunState;
function plan(total: bigint): RunPlan {
  const line = { recipientId: "alice", amount: total, stealthAddress: ADDR } as unknown as RunPlan["lines"][number];
  return {
    lines: [line],
    chunks: [[line]],
    estimate: { lineCount: 1, recipientCount: 1, txCount: 1, totalAmount: total, totalGas: 42_000n, perTx: [] },
    total,
    names: new Map([["alice", "alice.soapay.eth"]]),
    perEmployee: new Map(),
    denomination: null,
    denomStats: null,
    carryOut: new Map(),
    smallTeam: null,
  };
}
const review = (total: bigint, testnet: boolean) =>
  render(<ReviewPage run={run} plan={plan(total)} wallet={wallet} payPath={payPath} chainName="Base Sepolia" testnet={testnet} onBack={() => undefined} />);

describe("Review: large testnet run confirmation", () => {
  it("holds a testnet run above 50 USDC until the employer confirms", () => {
    review(60_000_000n, true);
    expect(screen.getByTestId("testnet-big-run").textContent).toBe("This run sends 60.00 test USDC; the faucet gives 20 per 2 hours.");
    const send = screen.getByRole("button", { name: "Approve and send" });
    expect(send).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox", { name: "Send it anyway" }));
    expect(send).toBeEnabled();
  });

  it("does not ask at or below 50 USDC, or on mainnet", () => {
    review(50_000_000n, true);
    expect(screen.queryByTestId("testnet-big-run")).toBeNull();
    expect(screen.getByRole("button", { name: "Approve and send" })).toBeEnabled();
    cleanup();
    review(60_000_000n, false);
    expect(screen.queryByTestId("testnet-big-run")).toBeNull();
    expect(screen.getByRole("button", { name: "Approve and send" })).toBeEnabled();
  });
});
