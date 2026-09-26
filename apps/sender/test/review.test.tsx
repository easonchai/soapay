import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Address } from "viem";
import { ReviewPage } from "../src/pages/ReviewPage.js";
import type { PayPathState, WalletState } from "../src/hooks/usePayPath.js";
import type { PayRunState } from "../src/hooks/usePayRun.js";
import type { RunPlan } from "../src/lib/run.js";

afterEach(cleanup);

const ADDR = "0x00000000000000000000000000000000000000aa" as Address;
const HOW = "Your wallet is a plain account, so StealthDisperse pulls the exact total once and pays every line in one call.";
const wallet: WalletState = { address: ADDR, isConnected: true, wrongChain: false, connectors: [], connecting: false, connectError: null, disconnect: () => undefined };
const payPath = {
  probe: { kind: "eoa", capabilities: undefined, disperseDeployed: true, path: { kind: "disperse", title: "StealthDisperse", reason: HOW } },
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

const CHUNK = 10_000_000n;
type Line = RunPlan["lines"][number];
const line = (recipientId: string, amount: bigint): Line => ({ recipientId, amount, stealthAddress: ADDR }) as unknown as Line;

function plan(lines: Line[], extra: Partial<RunPlan> = {}): RunPlan {
  const total = lines.reduce((s, l) => s + l.amount, 0n);
  const names = new Map(lines.map((l) => [l.recipientId, `${l.recipientId}.soapay.eth`]));
  return {
    lines,
    chunks: [lines],
    estimate: { lineCount: lines.length, recipientCount: names.size, txCount: 1, totalAmount: total, totalGas: 42_000n * BigInt(lines.length), perTx: [] },
    total,
    names,
    perEmployee: new Map(),
    denomination: { chunkSize: CHUNK, mode: "exact" },
    denomStats: null,
    carryOut: new Map(),
    smallTeam: null,
    ...extra,
  };
}

/** Two whole chunks, no remainder, no small-team warning: nothing to warn about. */
const cleanPlan = () => plan([line("alice", CHUNK), line("bob", CHUNK)]);
/** A small team with one remainder line under the chunk. */
const warnPlan = () => plan([line("alice", CHUNK), line("alice", 2_500_000n)], { smallTeam: "Fewer than 10 recipients: amounts alone can identify people." });

const review = (p: RunPlan, onBack: () => void = () => undefined) =>
  render(<ReviewPage run={run} plan={p} wallet={wallet} payPath={payPath} chainName="Base Sepolia" onBack={onBack} />);

describe("Review page", () => {
  it("offers Back to edit at the top and in the action bar, both calling onBack", () => {
    const onBack = vi.fn();
    const { container } = review(cleanPlan(), onBack);
    const backs = screen.getAllByRole("button", { name: /Back to edit/ });
    expect(backs).toHaveLength(2);
    expect(backs[0]).toHaveClass("btn-text");
    expect(backs[1]).toHaveClass("btn-lg");
    expect(container.querySelector(".review > .action-bar")).toContainElement(backs[1] ?? null);
    for (const b of backs) fireEvent.click(b);
    expect(onBack).toHaveBeenCalledTimes(2);
  });

  it("gathers every warning into one 'Before you send' box, absent when there is nothing to say", () => {
    const { container } = review(warnPlan());
    const boxes = screen.getAllByText("Before you send");
    expect(boxes).toHaveLength(1);
    const notice = boxes[0]?.closest(".notice");
    expect(notice).not.toBeNull();
    const items = notice!.querySelectorAll("ul > li");
    expect(items.length).toBeGreaterThanOrEqual(2);
    const texts = [...items].map((li) => li.textContent);
    expect(texts).toContain("Fewer than 10 recipients: amounts alone can identify people.");
    expect(texts).toContain("1 remainder line under 10 USDC stands out: paid in full, never carried over.");
    expect(container.querySelectorAll(".notice-warn")).toHaveLength(1);

    cleanup();
    review(cleanPlan());
    expect(screen.queryByText("Before you send")).toBeNull();
    expect(document.querySelectorAll(".notice-warn")).toHaveLength(0);
  });

  it("puts the animated diamond halo in the right column", () => {
    const { container } = review(cleanPlan());
    const halo = container.querySelector(".review .col-right > .halo");
    expect(halo).not.toBeNull();
    expect(container.querySelector(".review .halo canvas.dots")).not.toBeNull();
    expect(container.querySelector(".review .stack canvas")).toBeNull();
  });

  it("explains how it pays behind a toggle, closed by default", async () => {
    review(cleanPlan());
    expect(screen.getByText("Approve the exact total, then 1 StealthDisperse payment")).toBeInTheDocument();
    expect(screen.queryByText(HOW)).toBeNull();
    const how = screen.getByRole("button", { name: "How it pays" });
    fireEvent.click(how);
    expect(screen.getByText(HOW)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Hide" }));
    await waitFor(() => expect(screen.queryByText(HOW)).toBeNull());
    expect(screen.getByRole("button", { name: "How it pays" })).toBeInTheDocument();
  });

  it("opens the Safe export row above the action bar, spanning both columns", () => {
    const { container } = review(cleanPlan());
    expect(screen.queryByLabelText("Safe address")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Paying from a Safe? Export instead" }));
    const input = screen.getByLabelText("Safe address");
    const bar = container.querySelector(".review > .action-bar");
    const row = input.closest(".review > div");
    expect(row).not.toBeNull();
    expect((row as HTMLElement).classList.contains("safe-row")).toBe(true);
    expect(row!.nextElementSibling).toBe(bar);
    expect(screen.getByRole("button", { name: "Export for Safe" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Hide Safe export" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Approve and send" })).toBeEnabled();
  });
});
