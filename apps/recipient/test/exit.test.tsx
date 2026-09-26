import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { ClusterGraph, checkRelayQuote, exitLegCost, exitLegMinimum, generateMnemonic, planSpend, relayFeeCap } from "@soapay/sdk";
import { getAddress, type Address } from "viem";
import { TESTNET_EXIT_CONFIG } from "../src/features/exit/config.js";
import { exitPrefill, offersExit } from "../src/features/exit/entry.js";
import { MOCK_FEE_QUOTE, createMockExitService } from "../src/features/exit/mock.js";
import { connectDestinationWallet } from "../src/features/exit/wallet.js";
import { estimateExit, estimateLeg, fmtPercent, fmtUsdcUp, minLegAmount, noEligibleMessage, validateExit } from "../src/features/exit/planner.js";
import { nextAction, patchRecords, tickExits, type LegPatch } from "../src/features/exit/runner.js";
import { buildCtx, createSdkExitService, destBundlerUrl, type ExitSdkModule, type ExitService } from "../src/features/exit/sdk.js";
import { timelineOf } from "../src/features/exit/timeline.js";
import type { ExitLeg, ExitRecord } from "../src/features/exit/types.js";
import { ExitProvider, useExit, type ExitApi } from "../src/hooks/useExit.js";
import { QueueProvider } from "../src/hooks/useQueue.js";
import { DirectNote, Exit, FeeSummary, relayTooExpensive } from "../src/screens/Exit.js";
import { ExitOffer } from "../src/screens/ExitOffer.js";
import { ServicesProvider, buildServices } from "../src/services/ServicesProvider.js";
import { VaultProvider, useVault, type VaultApi } from "../src/vault/VaultProvider.js";
import { chainState, defaultSettings } from "../src/vault/types.js";

const A = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as Address;
const B = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" as Address;
const DUST = "0xdddddddddddddddddddddddddddddddddddddddd" as Address;
const MAIN = "0x2222222222222222222222222222222222222222" as Address;
const FRESH = "0x1111111111111111111111111111111111111111" as Address;
const USDC = 1_000_000n;
const cfg = TESTNET_EXIT_CONFIG;

describe("exit planner: minimum and fees", () => {
  it("fee math for a 500 USDC leg matches the SDK's exitLegCost (relayed, round withdrawal)", () => {
    const l = estimateLeg({ stealthAddress: A, amount: 500n * USDC }, cfg, { roundWithdrawals: true });
    const c = exitLegCost(cfg, 500n * USDC, { withdrawParts: 1, leaveChange: true });
    expect(l.eligible).toBe(true);
    expect(l.bridgeFee).toBe(2_210_000n + 64_993n); // forward fee (high tier, the estimate) + 1.3 bps CCTP on the burn
    // The paymaster prefunds (+10% headroom): 0.05 USDC on Base Sepolia, 5.8 USDC on Ethereum Sepolia.
    expect(l.gas).toBe(55_000n + 6_380_000n);
    expect(l.deposit).toBe(c.deposit);
    expect(l.vettingFee).toBe(c.vettingFee); // 1%
    expect(l.withdraw).toBe(486_000_000n); // round: whole USDC
    expect(l.leftInPool).toBe(c.leftInPool);
    expect(l.relayerFee).toBe(21_500_000n + 486_000n); // fixed ≈ 21.5 USDC gas + 0.1%
    expect(l.receive).toBe(464_014_000n);
    expect(l.totalFees + l.receive + l.leftInPool).toBe(500n * USDC);
    expect(l.relayerFeeCap).toBe(relayFeeCap(l.relayerFee));
  });

  it("full withdrawal leaves nothing in the pool; direct pays no relayer", () => {
    const l = estimateLeg({ stealthAddress: A, amount: 500n * USDC }, cfg, { roundWithdrawals: false });
    expect(l.leftInPool).toBe(0n);
    expect(l.withdraw).toBe(486_377_107n);
    const d = estimateLeg({ stealthAddress: A, amount: 500n * USDC }, cfg, { roundWithdrawals: true, via: "direct" });
    expect(d).toMatchObject({ relayerFee: 0n, relayerFeeCap: 0n, leftInPool: 0n, withdraw: 486_377_107n, receive: 486_377_107n });
  });

  it("uses live quotes when given (relayer gas, forwarding, Sepolia gas)", () => {
    const live = MOCK_FEE_QUOTE.live;
    const l = estimateLeg({ stealthAddress: A, amount: 500n * USDC }, cfg, { roundWithdrawals: false, live });
    const c = exitLegCost(cfg, 500n * USDC, { live, withdrawParts: 1 });
    expect(l.bridgeFee).toBe(c.forwardFee + c.cctpProtocolFee);
    expect(c.forwardFee).toBe(1_817_385n);
    expect(l.gas).toBe(55_000n + 5_562_000n + 556_200n);
    expect(l.receive).toBe(c.received);
    expect(estimateExit([{ stealthAddress: A, amount: 500n * USDC }], cfg, { roundWithdrawals: false, live }).relayGas).toBe(21_500_000n);
  });

  it("relayed legs need ≈ 81 USDC (the relayer's fixed fee under the pool's 30% limit); direct ≈ 18.6", () => {
    const min = minLegAmount(cfg);
    expect(min).toBe(exitLegMinimum(cfg).minimum);
    expect(min).toBeGreaterThan(81_000_000n);
    expect(min).toBeLessThan(81_500_000n);
    expect(minLegAmount(cfg, { roundWithdrawals: true })).toBe(exitLegMinimum(cfg, {}, { roundTo: cfg.withdrawUnit }).minimum);
    const direct = minLegAmount(cfg, { via: "direct" });
    expect(direct).toBe(exitLegMinimum(cfg, {}, { via: "direct" }).minimum);
    expect(direct).toBeGreaterThan(18_600_000n);
    expect(direct).toBeLessThan(18_700_000n);
    const at = estimateLeg({ stealthAddress: A, amount: direct }, cfg, { roundWithdrawals: true, via: "direct" });
    expect(at.eligible).toBe(true);
    expect(at.deposit).toBeGreaterThanOrEqual(cfg.pool.minDeposit);
    const below = estimateLeg({ stealthAddress: A, amount: direct - 1n }, cfg, { roundWithdrawals: true, via: "direct" });
    expect(below).toMatchObject({ eligible: false, shortBy: 1n, receive: 0n });
    expect(below.reason).toMatch(/exit minimum: a leg needs at least 18\.\d\d USDC \(the pool's 10\.00 USDC minimum deposit.*Add 0\.01 USDC/);
  });

  it("says when the relayer would take more than the exit is worth, and offers the direct withdrawal", () => {
    // The live run's 18 USDC: nothing would arrive through the relayer; 9.26 would, directly.
    const l = estimateLeg({ stealthAddress: A, amount: 18_000_000n }, cfg, { roundWithdrawals: true });
    expect(l.eligible).toBe(false);
    expect(l.directWouldWork).toBe(false); // 18 < 18.65: short even for a direct exit
    expect(l.reason).toMatch(/relayer would take more than this exit is worth: it charges about 21\.50 USDC per withdrawal.*above 30% of the withdrawal.*at least 81\.\d\d USDC.*holds 18\.00\. A direct withdrawal .* needs 18\.\d\d USDC/);
    const fifty = estimateLeg({ stealthAddress: A, amount: 50n * USDC }, cfg, { roundWithdrawals: true });
    expect(fifty).toMatchObject({ eligible: false, directWouldWork: true });
    expect(fifty.reason).toMatch(/Withdraw directly instead/);
    const none = estimateExit([{ stealthAddress: A, amount: 50n * USDC }], cfg, { roundWithdrawals: true });
    expect(noEligibleMessage(none)).toMatch(/relayer would take more than any of these exits is worth.*Withdraw directly instead.*18\.\d\d USDC/);
    const direct = estimateExit([{ stealthAddress: A, amount: 50n * USDC }], cfg, { roundWithdrawals: true, via: "direct" });
    expect(direct.eligible).toHaveLength(1);
    expect(direct.totals.receive).toBe(40_935_022n);
  });

  it("flags fees above 15% and reports the share; a large exit doesn't", () => {
    const hundred = estimateExit([{ stealthAddress: A, amount: 100n * USDC }], cfg, { roundWithdrawals: false });
    expect(hundred.feeShareBps).toBe(3117n);
    expect(hundred.highFees).toBe(true);
    expect(fmtPercent(hundred.feeShareBps)).toBe("31%");
    const big = estimateExit([{ stealthAddress: A, amount: 5_000n * USDC }], cfg, { roundWithdrawals: false });
    expect(big.highFees).toBe(false);
  });

  it("says so up front when no address can exit", () => {
    const none = estimateExit([{ stealthAddress: DUST, amount: 12_200_000n }, { stealthAddress: B, amount: USDC }], cfg, { roundWithdrawals: true, via: "direct" });
    expect(noEligibleMessage(none)).toMatch(/None of your addresses can exit yet.*at least 18\.\d\d USDC.*largest holds 12\.20 USDC/);
    expect(noEligibleMessage(estimateExit([], cfg, { roundWithdrawals: true }))).toBeNull();
    expect(noEligibleMessage(estimateExit([{ stealthAddress: A, amount: 500n * USDC }], cfg, { roundWithdrawals: true }))).toBeNull();
  });

  it("totals only count eligible legs; every address stays its own leg", () => {
    const est = estimateExit(
      [
        { stealthAddress: A, amount: 500n * USDC },
        { stealthAddress: B, amount: 500n * USDC },
        { stealthAddress: DUST, amount: USDC },
      ],
      cfg,
      { roundWithdrawals: true },
    );
    expect(est.legs).toHaveLength(3);
    expect(est.eligible.map((l) => l.stealthAddress)).toEqual([A, B].map((a) => est.legs.find((l) => l.stealthAddress.toLowerCase() === a)!.stealthAddress));
    expect(est.totals.amount).toBe(1_000n * USDC);
    expect(est.totals.receive).toBe(2n * 464_014_000n);
  });

  it("validation", () => {
    const estimates = estimateExit([{ stealthAddress: A, amount: 500n * USDC }, { stealthAddress: DUST, amount: USDC }], cfg, { roundWithdrawals: true }).legs;
    const base = { destination: MAIN, selected: [A], estimates, ownAddresses: [A, DUST] };
    expect(validateExit(base)).toBeNull();
    expect(validateExit({ ...base, destination: "nope" })).toMatch(/0x address/);
    expect(validateExit({ ...base, destination: A })).toMatch(/one of your stealth addresses/);
    expect(validateExit({ ...base, selected: [] })).toMatch(/at least one/);
    expect(validateExit({ ...base, selected: [DUST] })).toMatch(/relayer would take more/);
  });
});

describe("exit fee summary and direct-withdrawal UI", () => {
  it("shows bridge + gas + pool + relayer = total, 'you receive X of Y (Z%)', and the high-fee suggestion", () => {
    const est = estimateExit([{ stealthAddress: A, amount: 100n * USDC }], cfg, { roundWithdrawals: false });
    render(<FeeSummary est={est} destination={MAIN} />);
    expect(screen.getByTestId("fee-bridge").textContent).toMatch(/−2\.22/);
    expect(screen.getByTestId("fee-gas").textContent).toMatch(/−6\.43/);
    expect(screen.getByTestId("fee-relayer").textContent).toMatch(/Relayer \(21\.50 USDC gas \+ 0\.1%\).*−21\.59/);
    expect(screen.getByTestId("fee-total").textContent).toMatch(/Total fees.*−31\.16\d* USDC \(31%\)/);
    expect(screen.getByTestId("exit-receive").textContent).toMatch(/You receive.*≈ 68\.8\d of 100(\.00)? USDC \(69%\)/);
    expect(screen.getByTestId("relayer-cap").textContent).toMatch(/more than 32\.3\d USDC/);
    expect(screen.getByTestId("exit-fee-warning").textContent).toMatch(/Fees take 31% of this exit.*exiting later.*combining chunks.*direct withdrawal also skips/);
  });

  it("no warning for a large exit; direct mode shows no relayer fee and the ETH-source note", () => {
    const big = estimateExit([{ stealthAddress: A, amount: 5_000n * USDC }], cfg, { roundWithdrawals: false });
    const { unmount } = render(<FeeSummary est={big} destination={MAIN} />);
    expect(screen.queryByTestId("exit-fee-warning")).toBeNull();
    unmount();
    const direct = estimateExit([{ stealthAddress: A, amount: 50n * USDC }], cfg, { roundWithdrawals: false, via: "direct" });
    render(
      <>
        <FeeSummary est={direct} destination={MAIN} />
        <DirectNote />
      </>,
    );
    expect(screen.getByTestId("fee-relayer").textContent).toMatch(/none.*ETH gas/);
    expect(screen.queryByTestId("relayer-cap")).toBeNull();
    expect(screen.getByTestId("exit-receive").textContent).toMatch(/≈ 40\.9\d of 50(\.00)? USDC \(82%\)/);
    expect(screen.getByTestId("exit-fee-warning").textContent).toMatch(/Fees take 18%/);
    expect(screen.getByTestId("exit-direct-note").textContent).toMatch(/source not linked to you, such as a public faucet or an exchange/);
  });

  it("recognises a relayer refusal on price", () => {
    expect(relayTooExpensive(checkRelayQuote(cfg, 9_950_000n, 21_517n) ?? undefined)).toBe(true);
    expect(relayTooExpensive(checkRelayQuote(cfg, 100_000_000n, 2150n, { maxUsdc: 1n }) ?? undefined)).toBe(true);
    expect(relayTooExpensive("Soapay exit: ASP root not on-chain yet")).toBe(false);
    expect(relayTooExpensive(undefined)).toBe(false);
  });

  it("destination wallet: connects, checks the account, switches chain, sends from the destination", async () => {
    const calls: { method: string; params?: unknown[] }[] = [];
    const provider = {
      async request(a: { method: string; params?: unknown[] }) {
        calls.push(a);
        if (a.method === "eth_requestAccounts") return [MAIN.toLowerCase()];
        if (a.method === "eth_chainId") return "0x14a34";
        if (a.method === "eth_sendTransaction") return "0xabc";
        return null;
      },
    };
    const sender = await connectDestinationWallet(MAIN, 11155111, provider);
    expect(sender.address).toBe(MAIN);
    expect(await sender.sendTransaction({ to: FRESH, data: "0x12", chainId: 11155111 })).toBe("0xabc");
    expect(calls.map((c) => c.method)).toEqual(["eth_requestAccounts", "eth_chainId", "wallet_switchEthereumChain", "eth_sendTransaction"]);
    expect(calls[2]!.params).toEqual([{ chainId: "0xaa36a7" }]);
    expect(calls[3]!.params).toEqual([{ from: MAIN, to: FRESH, data: "0x12" }]);
    await expect(connectDestinationWallet(FRESH, 11155111, provider)).rejects.toThrow(/Connect the destination wallet/);
    await expect(connectDestinationWallet(MAIN, 11155111, null)).rejects.toThrow(/No browser wallet/);
  });

  it("the mock service quotes the measured testnet fees and withdraws directly from the destination only", async () => {
    const svc = createMockExitService({ now: () => 7 });
    expect((await svc.quoteFees()).live.relayGas).toBe(21_500_000n);
    const [leg] = svc.planExit({ sources: [{ stealthAddress: A, amount: 50n * USDC }], destination: MAIN, firstPoolIndex: 0, withdrawVia: "direct" }).legs;
    expect(leg!.withdrawVia).toBe("direct");
    const approved = { ...leg!, status: "approved" as const, updatedAt: 0 };
    expect(await svc.advance(approved, { stealthKey: () => "0x01", spendingKey: "0x02" }, { destination: MAIN, roundWithdrawals: true })).toBe(approved);
    await expect(svc.withdrawDirect(approved, { stealthKey: () => "0x01", spendingKey: "0x02" }, { destination: MAIN, roundWithdrawals: true }, { address: FRESH, sendTransaction: async () => "0x01" })).rejects.toThrow(/connect the destination wallet/);
    const out = await svc.withdrawDirect(approved, { stealthKey: () => "0x01", spendingKey: "0x02" }, { destination: MAIN, roundWithdrawals: true }, { address: MAIN, sendTransaction: async () => "0x01" });
    expect(out).toMatchObject({ status: "withdrawing", withdrawVia: "direct" });
  });
});

describe("block → exit entry point", () => {
  const graph = () => {
    const g = new ClusterGraph();
    g.addStealth(A, { runId: "r1", amount: 500n });
    g.addExternal(MAIN).setLabel(MAIN, "main-wallet");
    return g;
  };

  it("offers the exit when the guard blocks an identifiable destination, and keeps offering it under override", () => {
    const blocked = planSpend(graph(), { from: [A], to: MAIN });
    expect(blocked.decision).toBe("block");
    expect(offersExit(blocked)).toBe(true);
    expect(offersExit(planSpend(graph(), { from: [A], to: MAIN, override: true }))).toBe(true);
    expect(offersExit(planSpend(graph(), { from: [A], to: FRESH }))).toBe(false);
    expect(offersExit(null)).toBe(false);
  });

  it("the offer button hands off to the exit; disabled with the reason when unavailable", () => {
    const onExit = vi.fn();
    const { unmount } = render(<ExitOffer onExit={onExit} />);
    fireEvent.click(screen.getByTestId("exit-offer"));
    expect(onExit).toHaveBeenCalledOnce();
    unmount();
    render(<ExitOffer onExit={onExit} disabledReason="No exit route for this chain yet." />);
    expect((screen.getByTestId("exit-offer") as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/No exit route/)).toBeTruthy();
  });

  it("router prefill round-trips", () => {
    expect(exitPrefill({ destination: MAIN, sources: [A] })).toEqual({ destination: MAIN, sources: [A] });
    expect(exitPrefill(null)).toBeNull();
    expect(exitPrefill({ destination: 1 })).toBeNull();
  });
});

const legOf = (status: ExitLeg["status"], over: Partial<ExitLeg> = {}): ExitLeg => ({
  id: "l",
  stealthAddress: A,
  amount: "1",
  destination: MAIN,
  source: 84532,
  dest: 11155111,
  status,
  txs: {},
  poolIndex: 0,
  updatedAt: 0,
  withdrawals: [],
  ...over,
});

describe("SDK seam", () => {
  it("is unavailable without a route or a bundler; otherwise delegates to the SDK with the real context", async () => {
    expect(createSdkExitService({ config: null, bundlerUrl: "http://b", rpcUrl: "", fetch }).unavailableReason).toMatch(/No exit route/);
    expect(createSdkExitService({ config: cfg, bundlerUrl: "", rpcUrl: "", fetch }).unavailableReason).toMatch(/bundler URL/);

    const leg = legOf("planned", { id: "x" });
    const seen: unknown[] = [];
    const fake = {
      planExit: vi.fn((p: { firstPoolIndex?: number }) => ({ legs: [leg, { ...leg, id: "y", poolIndex: (p.firstPoolIndex ?? 0) + 1 }].map((l, i) => ({ ...l, poolIndex: (p.firstPoolIndex ?? 0) + i })), fees: {}, warnings: [] })),
      advanceExitLeg: vi.fn(async (ctx: unknown, l: ExitLeg) => {
        seen.push(ctx);
        return { ...l, status: "burning" as const };
      }),
      derivePoolSecrets: vi.fn(),
    } as unknown as ExitSdkModule;
    const on = createSdkExitService({ config: cfg, bundlerUrl: "https://api.pimlico.io/v2/84532/rpc?apikey=k", rpcUrl: "", fetch, sdk: fake });
    expect(on.ready).toBe(true);
    expect(on.planExit({ sources: [], destination: MAIN, firstPoolIndex: 7 }).legs.map((l) => l.poolIndex)).toEqual([7, 8]);
    const next = await on.advance(leg, { stealthKey: () => "0x01", spendingKey: "0x02" }, { destination: MAIN, roundWithdrawals: true });
    expect(next.status).toBe("burning");
    const ctx = seen[0] as { stealthKey: string; keys: { spendingKey: string }; spendClients: Record<number, { chainId: number }>; config: { withdrawDelayMs: { max: number } }; leaveChange: boolean };
    expect(ctx.stealthKey).toBe("0x01");
    expect(ctx.keys).toEqual({ spendingKey: "0x02" });
    expect(Object.keys(ctx.spendClients).map(Number).sort((a, b) => a - b)).toEqual([84532, 11155111]);
    expect(ctx.spendClients[11155111]!.chainId).toBe(11155111);
    expect(ctx.config.withdrawDelayMs.max).toBe(0); // the app's holdUntil is the delay
    expect(ctx.leaveChange).toBe(true);
  });

  it("points the destination at the same bundler provider", () => {
    expect(destBundlerUrl("https://api.pimlico.io/v2/84532/rpc?apikey=k", 84532, 11155111)).toBe("https://api.pimlico.io/v2/11155111/rpc?apikey=k");
    expect(destBundlerUrl("https://bundler.example", 84532, 11155111)).toBe("https://public.pimlico.io/v2/11155111/rpc");
  });

  it("hands the SDK the persist-before-send callback", async () => {
    const saved: ExitLeg[] = [];
    const ctx = buildCtx(cfg, {}, fetch, legOf("planned"), { stealthKey: () => "0x01", spendingKey: "0x02" }, {
      destination: MAIN,
      roundWithdrawals: true,
      persist: async (l) => void saved.push(l),
    });
    await ctx.persist!(legOf("planned", { pending: { step: "burn", chainId: 84532, sender: A, nonce: "0" } }));
    expect(saved[0]!.pending).toMatchObject({ step: "burn" });
  });

  it("full withdrawals when round withdrawals are off", () => {
    const ctx = buildCtx(cfg, {}, fetch, legOf("approved"), { stealthKey: () => "0x01", spendingKey: "0x02" }, { destination: MAIN, roundWithdrawals: false });
    expect(ctx.config.withdrawUnit).toBe(1n);
    expect(ctx.leaveChange).toBe(false);
  });
});

describe("runner", () => {
  const record = (over: Partial<ExitRecord> = {}): ExitRecord => ({
    id: "e",
    createdAt: 0,
    sourceChainId: 84532,
    destChainId: 11155111,
    destination: MAIN,
    privacy: { randomDelay: true, roundWithdrawals: true },
    legs: [],
    holdUntil: {},
    ...over,
  });
  const leg = (status: ExitLeg["status"]): ExitLeg => legOf(status);

  it("holds an approved leg for the random delay, then withdraws", () => {
    expect(nextAction(leg("approved"), record(), 10)).toBe("schedule");
    expect(nextAction(leg("approved"), record({ holdUntil: { l: 100 } }), 10)).toBe("hold");
    expect(nextAction(leg("approved"), record({ holdUntil: { l: 100 } }), 100)).toBe("advance");
    expect(nextAction(leg("approved"), record({ privacy: { randomDelay: false, roundWithdrawals: true } }), 10)).toBe("advance");
    expect(nextAction(leg("done"), record(), 10)).toBe("idle");
    expect(nextAction(leg("failed"), record(), 10)).toBe("idle");
    expect(patchRecords([record({ holdUntil: { l: 5 } })], "e", "l", { holdUntil: null })[0]!.holdUntil).toEqual({});
  });

  it("saves the in-flight leg before the on-chain step, so a crash mid-send resumes without resending", async () => {
    const pendingLeg = legOf("planned", { pending: { step: "burn", chainId: 84532, sender: A, nonce: "3" } });
    const service = {
      delayRangeMs: [0, 0],
      // The SDK persists the leg with its in-flight marker, then the bundler connection drops.
      advance: vi.fn(async (_leg: ExitLeg, _k: unknown, opts: { persist?: (l: ExitLeg) => Promise<void> }) => {
        await opts.persist!(pendingLeg);
        throw new Error("bundler connection dropped");
      }),
    } as unknown as ExitService;
    const saves: { exitId: string; legId: string; patch: LegPatch }[] = [];
    const errors: (string | null)[] = [];
    await tickExits({
      records: [record({ legs: [leg("planned")] })],
      service,
      keysFor: () => ({ stealthKey: () => "0x01", spendingKey: "0x02" }),
      now: () => 0,
      save: async (exitId, legId, patch) => void saves.push({ exitId, legId, patch }),
      onError: (_id, m) => void errors.push(m),
    });
    expect(saves).toEqual([{ exitId: "e", legId: "l", patch: { leg: pendingLeg } }]);
    expect(errors).toEqual(["bundler connection dropped"]);
    // Queued legs are not started at all.
    const idle = { advance: vi.fn(), delayRangeMs: [0, 0] } as unknown as ExitService;
    await tickExits({ records: [record({ legs: [leg("planned")] })], service: idle, keysFor: () => ({ stealthKey: () => "0x01", spendingKey: "0x02" }), now: () => 0, save: async () => {}, isQueued: () => true });
    expect(idle.advance).not.toHaveBeenCalled();
  });

  it("timeline: declined legs branch to refund, with the refund tx on the destination chain", () => {
    const declined = timelineOf({ ...leg("declined"), txs: { burn: "0x01", mint: "0x02", deposit: "0x03" } });
    expect(declined.map((s) => s.status)).toEqual(["burning", "awaiting-mint", "minted", "depositing", "pending-asp", "declined", "refunded"]);
    expect(declined.find((s) => s.status === "declined")!.state).toBe("error");
    expect(declined.find((s) => s.status === "burning")!.tx).toEqual({ hash: "0x01", chain: "source" });
    const refunded = timelineOf({ ...leg("refunded"), txs: { refund: "0x04" } });
    expect(refunded.at(-1)).toMatchObject({ status: "refunded", state: "done", tx: { hash: "0x04", chain: "dest" } });
    const pending = timelineOf(leg("pending-asp"));
    expect(pending.find((s) => s.status === "pending-asp")).toMatchObject({ state: "active", hint: expect.stringMatching(/10–12 minutes/) });
  });
});

// ---- useExit: persistence in the encrypted vault, resume after a reload ----

const PASS = "correct horse battery staple";
const BAL = (a: Address, v: bigint) => ({ stealthAddress: a, token: cfg.cctp.source.usdc, balance: v.toString() });

function Harness({ exitSvc, vaultRef, exitRef, screen: showScreen }: { exitSvc: ReturnType<typeof createMockExitService>; vaultRef: { current: VaultApi | null }; exitRef: { current: ExitApi | null }; screen?: boolean }) {
  const vault = useVault();
  vaultRef.current = vault;
  if (vault.status !== "unlocked") return null;
  return (
    <ServicesProvider override={{ ...buildServices({ ...defaultSettings(), apiUrl: "http://mock" }, true), exit: exitSvc }}>
      <QueueProvider pollMs={10} random={() => 0}>
        <ExitProvider random={() => 0}>
          <Probe exitRef={exitRef} />
          {showScreen && (
            <MemoryRouter>
              <Exit />
            </MemoryRouter>
          )}
        </ExitProvider>
      </QueueProvider>
    </ServicesProvider>
  );
}

function Probe({ exitRef }: { exitRef: { current: ExitApi | null } }) {
  exitRef.current = useExit();
  return null;
}

describe("useExit", () => {
  it("persists every step in the vault and resumes after a reload; one leg is declined and refunded", async () => {
    const vaultRef: { current: VaultApi | null } = { current: null };
    const exitRef: { current: ExitApi | null } = { current: null };
    // First session: legs stall at the approval wait (pending-asp never elapses).
    const slow = createMockExitService({ durations: { planned: 0, burning: 0, "awaiting-mint": 0, minted: 0, depositing: 0, "pending-asp": 1e12 }, pollMs: 10 });
    const first = render(
      <VaultProvider>
        <Harness exitSvc={slow} vaultRef={vaultRef} exitRef={exitRef} />
      </VaultProvider>,
    );
    await waitFor(() => expect(vaultRef.current?.status).toBe("empty"));
    await act(() => vaultRef.current!.create(generateMnemonic(), PASS));
    await act(async () => {
      await vaultRef.current!.update((d) => {
        const cs = chainState(d);
        return {
          ...d,
          // No timing-queue wait in this test (the queue itself is tested below and in the SDK).
          settings: { ...d.settings, queueWindowHours: [0, 0] },
          chains: { ...d.chains, [String(d.settings.chainId)]: { ...cs, balances: [BAL(A, 500n * USDC), BAL(B, 300n * USDC), BAL(DUST, USDC)] } },
        };
      });
    });
    await waitFor(() => expect(exitRef.current?.sources).toHaveLength(3));

    const r = await act(() => exitRef.current!.start({ sources: [A, B], destination: MAIN, privacy: { randomDelay: true, roundWithdrawals: true } }));
    expect(r).toHaveProperty("id");
    expect(exitRef.current!.busy.has(A.toLowerCase())).toBe(true);
    expect(exitRef.current!.sources.map((s) => s.stealthAddress.toLowerCase())).toEqual([DUST.toLowerCase()]);

    // The poller walks both legs up to the approval wait, saving each step.
    await waitFor(() => expect(exitRef.current!.exits[0]!.legs.every((l) => l.status === "pending-asp")).toBe(true));
    const saved = chainState(vaultRef.current!.data!).exits![0]!;
    expect(saved.legs.map((l) => l.status)).toEqual(["pending-asp", "pending-asp"]);
    expect(saved.legs.map((l) => l.poolIndex)).toEqual([0, 1]);
    expect(saved.legs[0]!.txs.deposit).toMatch(/^0x/);
    expect(saved.legs[0]!.amount).toBe((500n * USDC).toString());
    expect(vaultRef.current!.data!.profile.nextExitPoolIndex).toBe(2);

    // "Reload": drop everything in memory, reopen the vault from IndexedDB and unlock.
    first.unmount();
    vaultRef.current = null;
    exitRef.current = null;
    const fast = createMockExitService({ durations: { "pending-asp": 0, approved: 0, withdrawing: 0, declined: 0 }, pollMs: 10, delayRangeMs: [0, 0] });
    render(
      <VaultProvider>
        <Harness exitSvc={fast} vaultRef={vaultRef} exitRef={exitRef} screen />
      </VaultProvider>,
    );
    await waitFor(() => expect(vaultRef.current?.status).toBe("locked"));
    await act(() => vaultRef.current!.unlock(PASS));

    // Resumed from the stored legs: leg 0 approved → withdrawn; leg 1 (mock-declined) → refunded.
    await waitFor(() => expect(exitRef.current!.exits[0]!.finished).toBe(true), { timeout: 5_000 });
    const legs = exitRef.current!.exits[0]!.legs;
    expect(legs.map((l) => l.status)).toEqual(["done", "refunded"]);
    expect(legs[1]!.txs.refund).toMatch(/^0x/);
    expect(chainState(vaultRef.current!.data!).exits![0]!.legs.map((l) => l.status)).toEqual(["done", "refunded"]);

    // The declined → refunded display.
    const refunded = screen.getAllByTestId("exit-leg").find((el) => el.dataset.status === "refunded")!;
    expect(refunded.textContent).toMatch(/Refunded/);
    expect(refunded.textContent).toMatch(/ragequit/);
    expect(refunded.textContent).toMatch(/nothing from this leg reaches your destination/);
    const refundStep = refunded.querySelector('li[data-state="done"]:last-of-type')!;
    expect(refundStep.textContent).toMatch(/Refunded/);
    expect(refundStep.querySelector("a")?.getAttribute("href")).toBe(`https://sepolia.etherscan.io/tx/${legs[1]!.txs.refund}`);
    expect(refundStep.querySelector("a")?.textContent).toMatch(/Etherscan Sepolia/);
    const burnLink = [...refunded.querySelectorAll("a")].find((a) => a.textContent?.includes("Basescan Sepolia"));
    expect(burnLink?.getAttribute("href")).toMatch(/^https:\/\/sepolia\.basescan\.org\/tx\/0x/);
    // The minimum follows the (mock) live quote: the relayer's ≈ 21.5 USDC fixed fee sets it.
    await waitFor(() => expect(screen.getByTestId("exit-quote").dataset.status).toBe("live"));
    const shown = fmtUsdcUp(exitLegMinimum(cfg, MOCK_FEE_QUOTE.live, { via: "relayer", roundTo: cfg.withdrawUnit }).minimum);
    expect(screen.getByTestId("exit-minimum").textContent).toBe(`${shown} USDC`);
    // Below-minimum source shows why it's disabled: the relayer would take more than it's worth.
    expect(screen.getByTestId("below-minimum").textContent).toMatch(/relayer would take more than this exit is worth.*A direct withdrawal/);
  });

  it("a 50 USDC address: the relayer costs more than it's worth, so the planner offers the direct withdrawal; the approved leg withdraws from the destination wallet", async () => {
    const vaultRef: { current: VaultApi | null } = { current: null };
    const exitRef: { current: ExitApi | null } = { current: null };
    const svc = createMockExitService({ durations: { planned: 0, burning: 0, "awaiting-mint": 0, minted: 0, depositing: 0, "pending-asp": 0, withdrawing: 0 }, pollMs: 10, delayRangeMs: [0, 0] });
    render(
      <VaultProvider>
        <Harness exitSvc={svc} vaultRef={vaultRef} exitRef={exitRef} screen />
      </VaultProvider>,
    );
    await waitFor(() => expect(["empty", "locked"]).toContain(vaultRef.current?.status));
    if (vaultRef.current!.status === "locked") await act(() => vaultRef.current!.wipe());
    await waitFor(() => expect(vaultRef.current?.status).toBe("empty"));
    await act(() => vaultRef.current!.create(generateMnemonic(), PASS));
    await act(async () => {
      await vaultRef.current!.update((d) => {
        const cs = chainState(d);
        return { ...d, settings: { ...d.settings, queueWindowHours: [0, 0] }, chains: { ...d.chains, [String(d.settings.chainId)]: { ...cs, balances: [BAL(A, 50n * USDC)] } } };
      });
    });
    await waitFor(() => expect(screen.getByTestId("exit-quote").dataset.status).toBe("live"));
    expect(screen.getByTestId("exit-none-eligible").textContent).toMatch(/relayer would take more than any of these exits is worth.*Withdraw directly instead/);
    fireEvent.click(screen.getByTestId("exit-use-direct"));
    await waitFor(() => expect(screen.queryByTestId("exit-none-eligible")).toBeNull());
    expect(screen.getByTestId("exit-minimum").textContent).toMatch(/^18\.\d\d USDC$/);
    fireEvent.click(screen.getByLabelText(`Exit from ${getAddress(A)}`));
    expect(screen.getByTestId("fee-relayer").textContent).toMatch(/none/);
    expect(screen.getByTestId("exit-fee-warning").textContent).toMatch(/Fees take \d+% of this exit/);

    const r = await act(() => exitRef.current!.start({ sources: [A], destination: MAIN, privacy: { randomDelay: false, roundWithdrawals: true }, withdrawVia: "direct" }));
    const id = (r as { id: string }).id;
    expect(chainState(vaultRef.current!.data!).exits![0]!.withdrawVia).toBe("direct");
    // It walks to approved and waits there for the destination wallet.
    await waitFor(() => expect(exitRef.current!.exits[0]!.legs[0]!.status).toBe("approved"), { timeout: 10_000 });
    const offer = await screen.findByTestId("exit-direct-offer");
    expect(offer.textContent).toMatch(/withdraws directly.*public faucet or an exchange/);
    // The injected destination wallet.
    (globalThis as { ethereum?: unknown }).ethereum = {
      async request(a: { method: string }) {
        if (a.method === "eth_requestAccounts") return [MAIN];
        if (a.method === "eth_chainId") return "0xaa36a7";
        return "0x01";
      },
    };
    try {
      await act(() => exitRef.current!.withdrawDirect(id, exitRef.current!.exits[0]!.legs[0]!.id));
      await waitFor(() => expect(exitRef.current!.exits[0]!.legs[0]!.status).toBe("done"), { timeout: 10_000 });
    } finally {
      delete (globalThis as { ethereum?: unknown }).ethereum;
    }
  });

  it("queues each leg's deposit in its own window (D-28); Start now overrides", async () => {
    const vaultRef: { current: VaultApi | null } = { current: null };
    const exitRef: { current: ExitApi | null } = { current: null };
    const svc = createMockExitService({ durations: { planned: 0, burning: 0, "awaiting-mint": 0, minted: 0, depositing: 0, "pending-asp": 1e12 }, pollMs: 10 });
    render(
      <VaultProvider>
        <Harness exitSvc={svc} vaultRef={vaultRef} exitRef={exitRef} screen />
      </VaultProvider>,
    );
    // The previous test left a vault in this IndexedDB: start from a clean one.
    await waitFor(() => expect(["empty", "locked"]).toContain(vaultRef.current?.status));
    if (vaultRef.current!.status === "locked") await act(() => vaultRef.current!.wipe());
    await waitFor(() => expect(vaultRef.current?.status).toBe("empty"));
    await act(() => vaultRef.current!.create(generateMnemonic(), PASS));
    await act(async () => {
      await vaultRef.current!.update((d) => {
        const cs = chainState(d);
        return { ...d, chains: { ...d.chains, [String(d.settings.chainId)]: { ...cs, balances: [BAL(A, 500n * USDC), BAL(B, 300n * USDC)] } } };
      });
    });
    await waitFor(() => expect(exitRef.current?.sources).toHaveLength(2));
    const r = await act(() => exitRef.current!.start({ sources: [A, B], destination: MAIN, privacy: { randomDelay: true, roundWithdrawals: true } }));
    const id = (r as { id: string }).id;

    // Default window (2–12 h): one leg starts now, the other waits, showing when.
    await waitFor(() => expect(exitRef.current!.exits[0]!.legs.filter((l) => l.status === "pending-asp")).toHaveLength(1), { timeout: 10_000 });
    const waiting = exitRef.current!.exits[0]!.legs.find((l) => l.status === "planned")!;
    expect(exitRef.current!.queuedAt[waiting.id]).toBeGreaterThanOrEqual(Date.now() + 2 * 3_600_000 - 5_000);
    expect(screen.getByTestId("exit-queued").textContent).toMatch(/Queued: this deposit starts in \d+ h/);
    await new Promise((res) => setTimeout(res, 60));
    expect(exitRef.current!.exits[0]!.legs.find((l) => l.id === waiting.id)!.status).toBe("planned");

    await act(() => exitRef.current!.startNow(id));
    await waitFor(() => expect(exitRef.current!.exits[0]!.legs.every((l) => l.status === "pending-asp")).toBe(true), { timeout: 10_000 });
    const q = chainState(vaultRef.current!.data!).queue!;
    await waitFor(() => expect(chainState(vaultRef.current!.data!).queue!.items.every((i) => i.status === "sent")).toBe(true), { timeout: 10_000 });
    expect(q.items.map((i) => i.meta?.exitId)).toEqual([id, id]);
  });
});
