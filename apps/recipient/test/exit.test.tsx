import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { ClusterGraph, generateMnemonic, planSpend } from "@soapay/sdk";
import type { Address } from "viem";
import { TESTNET_EXIT_CONFIG } from "../src/features/exit/config.js";
import { exitPrefill, offersExit } from "../src/features/exit/entry.js";
import { createMockExitService } from "../src/features/exit/mock.js";
import { estimateExit, estimateLeg, minLegAmount, validateExit } from "../src/features/exit/planner.js";
import { nextAction, patchRecords } from "../src/features/exit/runner.js";
import { createSdkExitService, sdkExit } from "../src/features/exit/sdk.js";
import { timelineOf } from "../src/features/exit/timeline.js";
import type { ExitLeg, ExitRecord } from "../src/features/exit/types.js";
import { ExitProvider, useExit, type ExitApi } from "../src/hooks/useExit.js";
import { Exit } from "../src/screens/Exit.js";
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
  it("fee math for a 500 USDC leg (worst case, round withdrawal)", () => {
    const l = estimateLeg({ stealthAddress: A, amount: 500n * USDC }, cfg, { roundWithdrawals: true });
    expect(l.eligible).toBe(true);
    expect(l.forwardFeeHigh).toBe(2_210_000n + 65_000n); // forward fee + 1.3 bps CCTP
    expect(l.forwardFeeLow).toBe(1_540_000n + 65_000n);
    expect(l.gas).toBe(450_000n);
    expect(l.deposit).toBe(497_275_000n);
    expect(l.vettingFee).toBe(4_972_750n); // 1%
    expect(l.withdraw).toBe(492_000_000n); // round: whole USDC
    expect(l.leftInPool).toBe(302_250n);
    expect(l.relayerFee).toBe(492_000n); // 0.1%
    expect(l.receive).toBe(491_508_000n);
    expect(l.receiveHigh).toBe(l.receive); // the forward-fee spread is absorbed by the round-down
    expect(estimateLeg({ stealthAddress: A, amount: 500n * USDC }, cfg, { roundWithdrawals: false }).receiveHigh).toBeGreaterThan(491_809_947n);
  });

  it("full withdrawal leaves nothing in the pool", () => {
    const l = estimateLeg({ stealthAddress: A, amount: 500n * USDC }, cfg, { roundWithdrawals: false });
    expect(l.leftInPool).toBe(0n);
    expect(l.withdraw).toBe(492_302_250n);
    expect(l.relayerFee).toBe(492_303n); // rounded up
  });

  it("pool minimum: 10 USDC deposit per leg after fees; below it the leg is disabled with a reason", () => {
    const min = minLegAmount(cfg);
    expect(estimateLeg({ stealthAddress: A, amount: min }, cfg, { roundWithdrawals: true }).deposit).toBeGreaterThanOrEqual(cfg.pool.minDeposit);
    expect(estimateLeg({ stealthAddress: A, amount: min }, cfg, { roundWithdrawals: true }).eligible).toBe(true);
    const below = estimateLeg({ stealthAddress: A, amount: min - 1n }, cfg, { roundWithdrawals: true });
    expect(below.eligible).toBe(false);
    expect(below.reason).toMatch(/pool minimum.*12\.6\d USDC.*10\.00 USDC/);
    expect(below.receive).toBe(0n);
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
    expect(est.totals.receive).toBe(2n * 491_508_000n);
  });

  it("validation", () => {
    const estimates = estimateExit([{ stealthAddress: A, amount: 500n * USDC }, { stealthAddress: DUST, amount: USDC }], cfg, { roundWithdrawals: true }).legs;
    const base = { destination: MAIN, selected: [A], estimates, ownAddresses: [A, DUST] };
    expect(validateExit(base)).toBeNull();
    expect(validateExit({ ...base, destination: "nope" })).toMatch(/0x address/);
    expect(validateExit({ ...base, destination: A })).toMatch(/one of your stealth addresses/);
    expect(validateExit({ ...base, selected: [] })).toMatch(/at least one/);
    expect(validateExit({ ...base, selected: [DUST] })).toMatch(/pool minimum/);
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

describe("SDK seam", () => {
  it("stays unavailable until the SDK exports the exit functions, then uses them", async () => {
    expect(sdkExit({})).toBeNull();
    const off = createSdkExitService({ config: cfg, bundlerUrl: "http://b", rpcUrl: "", fetch, sdk: null });
    expect(off.ready).toBe(false);
    expect(off.unavailableReason).toMatch(/hasn't landed/);
    expect(createSdkExitService({ config: null, bundlerUrl: "http://b", rpcUrl: "", fetch, sdk: null }).unavailableReason).toMatch(/No exit route/);

    const leg: ExitLeg = { id: "x", stealthAddress: A, amount: 1n, status: "planned", txs: {}, poolIndex: 0, updatedAt: 0 };
    const fake = {
      planExit: vi.fn(() => ({ legs: [leg, { ...leg, id: "y" }], fees: {}, warnings: [] })),
      advanceExitLeg: vi.fn(async (_ctx: Record<string, unknown>, l: ExitLeg) => ({ ...l, status: "burning" as const })),
      derivePoolSecrets: vi.fn(() => ({ nullifier: 1n, secret: 2n })),
    };
    expect(sdkExit(fake)).toBe(fake);
    const on = createSdkExitService({ config: cfg, bundlerUrl: "http://b", rpcUrl: "", fetch, sdk: fake });
    expect(on.ready).toBe(true);
    expect(on.planExit({ sources: [], destination: MAIN, firstPoolIndex: 7 }).legs.map((l) => l.poolIndex)).toEqual([7, 8]);
    const next = await on.advance(leg, { stealthKey: () => "0x01", spendingKey: "0x02" }, { destination: MAIN, roundWithdrawals: true });
    expect(next.status).toBe("burning");
    expect(fake.derivePoolSecrets).toHaveBeenCalledWith({ spendingKey: "0x02" }, 0);
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
  const leg = (status: ExitLeg["status"]): ExitLeg => ({ id: "l", stealthAddress: A, amount: 1n, status, txs: {}, poolIndex: 0, updatedAt: 0 });

  it("holds an approved leg for the random delay, then withdraws", () => {
    expect(nextAction(leg("approved"), record(), 10)).toBe("schedule");
    expect(nextAction(leg("approved"), record({ holdUntil: { l: 100 } }), 10)).toBe("hold");
    expect(nextAction(leg("approved"), record({ holdUntil: { l: 100 } }), 100)).toBe("advance");
    expect(nextAction(leg("approved"), record({ privacy: { randomDelay: false, roundWithdrawals: true } }), 10)).toBe("advance");
    expect(nextAction(leg("done"), record(), 10)).toBe("idle");
    expect(nextAction(leg("failed"), record(), 10)).toBe("idle");
    expect(patchRecords([record({ holdUntil: { l: 5 } })], "e", "l", { holdUntil: null })[0]!.holdUntil).toEqual({});
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
const BAL = (a: Address, v: bigint) => ({ stealthAddress: a, token: cfg.cctp.sourceUsdc, balance: v.toString() });

function Harness({ exitSvc, vaultRef, exitRef, screen: showScreen }: { exitSvc: ReturnType<typeof createMockExitService>; vaultRef: { current: VaultApi | null }; exitRef: { current: ExitApi | null }; screen?: boolean }) {
  const vault = useVault();
  vaultRef.current = vault;
  if (vault.status !== "unlocked") return null;
  return (
    <ServicesProvider override={{ ...buildServices({ ...defaultSettings(), apiUrl: "http://mock" }, true), exit: exitSvc }}>
      <ExitProvider random={() => 0}>
        <Probe exitRef={exitRef} />
        {showScreen && (
          <MemoryRouter>
            <Exit />
          </MemoryRouter>
        )}
      </ExitProvider>
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
        return { ...d, chains: { ...d.chains, [String(d.settings.chainId)]: { ...cs, balances: [BAL(A, 500n * USDC), BAL(B, 300n * USDC), BAL(DUST, USDC)] } } };
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
    // Below-minimum source shows why it's disabled.
    expect(screen.getByTestId("below-minimum").textContent).toMatch(/pool minimum/);
  });
});
