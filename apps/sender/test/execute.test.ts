import { describe, expect, it, vi } from "vitest";
import { decodeFunctionData, type Hash } from "viem";
import { erc20Abi, generateMnemonic, keysFromMnemonic } from "@soapay/sdk";
import { attemptFromPlan, canRetry, planRun, runStatus, type RunRecord } from "../src/lib/run.js";
import { confirmNotSent, executeAttempt, normalizeInterrupted, recheckRun, type ExecDeps } from "../src/lib/execute.js";

// The Base Sepolia pay token (Soapay mock USDC, D-52).
const USDC = "0x028D969c20b740582428f5043954c380686214Bb" as const;
const DISPERSE = "0x000000000000000000000000000000000000dEaD" as const;
const PAYER = "0x3333333333333333333333333333333333333333" as const;

function makeRun(path: "disperse" | "batch", lines = 400) {
  const meta = keysFromMnemonic(generateMnemonic()).metaAddressURI;
  const plan = planRun(
    [{ employeeId: "e0", name: "e0.soapay.eth", metaAddressURI: meta, amount: BigInt(lines) * 1_000_000n }],
    { chunkSize: 1_000_000n, mode: "exact" },
  );
  const run: RunRecord = {
    id: "r",
    createdAt: 0,
    chainId: 84532,
    path,
    token: USDC,
    ...(path === "disperse" ? { stealthDisperse: DISPERSE } : {}),
    denomination: null,
    carryOut: {},
    carryCommitted: false,
    excluded: [],
    attempts: [attemptFromPlan(plan, 0, 0)],
  };
  return { plan, run };
}

function deps(over: Partial<ExecDeps> = {}): ExecDeps {
  let n = 0;
  return {
    sendTransaction: vi.fn(async () => `0x${(++n).toString(16).padStart(64, "0")}` as Hash),
    waitForReceipt: vi.fn(async () => "success" as const),
    sendCalls: vi.fn(async () => `batch-${++n}`),
    waitForCalls: vi.fn(async () => ({ status: "success" as const, txHash: "0xfeed" as Hash })),
    readAllowance: vi.fn(async () => 0n),
    sleep: vi.fn(async () => {}),
    ...over,
  };
}

describe("executeAttempt (StealthDisperse)", () => {
  it("approves the exact total, then pays each chunk", async () => {
    const { plan, run } = makeRun("disperse");
    const d = deps();
    const out = await executeAttempt({ run, attemptIndex: 0, plan, payer: PAYER, deps: d, onChange: () => {} });
    const calls = (d.sendTransaction as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0]);
    expect(calls).toHaveLength(3); // approve + 2 chunks (400 lines)
    const approve = decodeFunctionData({ abi: erc20Abi, data: calls[0].data });
    expect(approve.functionName).toBe("approve");
    expect(approve.args).toEqual([DISPERSE, 400_000_000n]);
    expect(runStatus(out)).toBe("complete");
  });

  it("waits until a lagging RPC shows the new allowance before paying", async () => {
    const { plan, run } = makeRun("disperse");
    // 0 before the approval, still 0 on the first re-read (a stale node), then the total.
    const readAllowance = vi.fn().mockResolvedValueOnce(0n).mockResolvedValueOnce(0n).mockResolvedValue(400_000_000n);
    const sleep = vi.fn(async () => {});
    const d = deps({ readAllowance, sleep });
    const out = await executeAttempt({ run, attemptIndex: 0, plan, payer: PAYER, deps: d, onChange: () => {} });
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(runStatus(out)).toBe("complete");
  });

  it("skips the approval only when the allowance already equals the total", async () => {
    const { plan, run } = makeRun("disperse", 10);
    const d = deps({ readAllowance: vi.fn(async () => 10_000_000n) });
    const out = await executeAttempt({ run, attemptIndex: 0, plan, payer: PAYER, deps: d, onChange: () => {} });
    expect(out.attempts[0]!.approve?.status).toBe("skipped");
    expect(d.sendTransaction).toHaveBeenCalledTimes(1);
  });

  it("stops after a reverted chunk and leaves the rest unsent and retryable", async () => {
    const { plan, run } = makeRun("disperse");
    const receipts = ["success", "reverted"] as const;
    let i = 0;
    const d = deps({ waitForReceipt: vi.fn(async () => receipts[i++] ?? "success") });
    const changes: RunRecord[] = [];
    const out = await executeAttempt({ run, attemptIndex: 0, plan, payer: PAYER, deps: d, onChange: (r) => changes.push(r) });
    expect(out.attempts[0]!.chunks.map((c) => c.status)).toEqual(["failed", "pending"]);
    expect(out.attempts[0]!.chunks[1]!.error).toMatch(/Not sent/);
    expect(runStatus(out)).toBe("failed");
    expect(canRetry(out).ok).toBe(true);
    expect(changes.length).toBeGreaterThan(3);
  });

  it("a receipt timeout makes the chunk unknown and blocks retry until rechecked", async () => {
    const { plan, run } = makeRun("disperse");
    let call = 0;
    const d = deps({
      waitForReceipt: vi.fn(async () => {
        call++;
        if (call === 3) throw new Error("timed out");
        return "success" as const;
      }),
    });
    const out = await executeAttempt({ run, attemptIndex: 0, plan, payer: PAYER, deps: d, onChange: () => {} });
    expect(out.attempts[0]!.chunks.map((c) => c.status)).toEqual(["landed", "unknown"]);
    expect(canRetry(out).ok).toBe(false);
    const rechecked = await recheckRun(out, { getReceipt: async () => "success", getCallsStatus: async () => ({ status: "pending" }) });
    expect(runStatus(rechecked)).toBe("complete");
  });

  it("a rejected wallet prompt fails the chunk without broadcasting", async () => {
    const { plan, run } = makeRun("disperse", 5);
    const d = deps({
      sendTransaction: vi.fn(async () => {
        throw Object.assign(new Error("User rejected the request."), { code: 4001 });
      }),
    });
    const out = await executeAttempt({ run, attemptIndex: 0, plan, payer: PAYER, deps: d, onChange: () => {} });
    expect(out.attempts[0]!.approve).toMatchObject({ status: "failed", error: "You rejected the request in your wallet" });
    expect(canRetry(out).ok).toBe(true);
  });
});

describe("executeAttempt (EIP-5792 batch)", () => {
  it("sends one atomic batch per chunk with transfer + announce pairs", async () => {
    const { plan, run } = makeRun("batch");
    const d = deps();
    const out = await executeAttempt({ run, attemptIndex: 0, plan, payer: PAYER, deps: d, onChange: () => {} });
    const batches = (d.sendCalls as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0]);
    expect(batches.map((b) => b.length)).toEqual([400, 400]); // 200 lines × 2 calls
    expect(d.sendTransaction).not.toHaveBeenCalled();
    expect(runStatus(out)).toBe("complete");
    expect(out.attempts[0]!.chunks[0]!.txHash).toBe("0xfeed");
  });

  it("a failed batch is failed as a whole; pending status is unknown", async () => {
    const { plan, run } = makeRun("batch");
    const d = deps({ waitForCalls: vi.fn(async () => ({ status: "failure" as const })) });
    const out = await executeAttempt({ run, attemptIndex: 0, plan, payer: PAYER, deps: d, onChange: () => {} });
    expect(out.attempts[0]!.chunks.map((c) => c.status)).toEqual(["failed", "pending"]);

    const d2 = deps({ waitForCalls: vi.fn(async () => ({ status: "pending" as const })) });
    const out2 = await executeAttempt({ run, attemptIndex: 0, plan, payer: PAYER, deps: d2, onChange: () => {} });
    expect(runStatus(out2)).toBe("needs-check");
  });
});

describe("interrupted runs", () => {
  it("after a reload, in-flight steps become unknown and unsent ones retryable", () => {
    const { run } = makeRun("disperse");
    const a = run.attempts[0]!;
    const mid: RunRecord = { ...run, attempts: [{ ...a, chunks: [{ ...a.chunks[0]!, status: "signing" }, a.chunks[1]!] }] };
    const n = normalizeInterrupted(mid);
    expect(n.attempts[0]!.chunks.map((c) => c.status)).toEqual(["unknown", "pending"]);
    expect(canRetry(n).ok).toBe(false);
    const confirmed = confirmNotSent(n, 0);
    expect(canRetry(confirmed).ok).toBe(true);
  });
});
