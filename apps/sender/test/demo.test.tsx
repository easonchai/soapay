import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, render, renderHook, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { WagmiProvider } from "wagmi";
import { DEMO_SESSION_KEY, DEMO_STEALTH_DISPERSE, readDemoFlag, resolveConfig, setDemoFlag } from "../src/config.js";
import { StoreProvider, useStore } from "../src/hooks/store.js";
import { demoLandedBalances } from "../src/hooks/useWalletBalances.js";
import { DEMO_FAUCET_USDC, demoLedger, demoProbe, setDemoLatencyMs } from "../src/lib/demoChain.js";
import { demoBatches } from "../src/lib/onchain.js";
import { attemptFromPlan, planRun, runStatus, type RunRecord } from "../src/lib/run.js";
import { createServices } from "../src/lib/services.js";
import { memoryKV } from "../src/lib/vault.js";
import { createWagmiConfig, DEMO_WALLET } from "../src/lib/wagmi.js";
import { Faucet } from "../src/pages/Faucet.js";

const env = (e: Record<string, string> = {}) => e as unknown as ImportMetaEnv;

afterEach(() => {
  cleanup();
  sessionStorage.removeItem(DEMO_SESSION_KEY);
  demoLedger.reset();
});

describe("demo switch (config)", () => {
  it("?demo=1 turns it on and persists for the tab; ?demo=0 turns it off", () => {
    expect(readDemoFlag(env(), "")).toBe(false);
    expect(readDemoFlag(env(), "?demo=1")).toBe(true);
    expect(sessionStorage.getItem(DEMO_SESSION_KEY)).toBe("1");
    expect(readDemoFlag(env(), "")).toBe(true); // hash navigation / reload without the param
    expect(readDemoFlag(env(), "?demo=0")).toBe(false);
    expect(readDemoFlag(env(), "")).toBe(false);
  });

  it("VITE_DEMO=1 is the build default, and a session choice overrides it", () => {
    expect(readDemoFlag(env({ VITE_DEMO: "1" }), "")).toBe(true);
    setDemoFlag(false); // "Exit demo"
    expect(readDemoFlag(env({ VITE_DEMO: "1" }), "")).toBe(false);
  });

  it("resolveConfig carries the flag and gives demo a pay path (fake StealthDisperse)", () => {
    expect(resolveConfig(undefined, env()).demo).toBe(false);
    setDemoFlag(true);
    const app = resolveConfig(undefined, env());
    expect(app.demo).toBe(true);
    expect(app.stealthDisperse).toBe(DEMO_STEALTH_DISPERSE);
    expect(demoProbe(app).path.kind).toBe("disperse");
    // Only the demo wallet, named for the chooser-less Landing.
    const connectors = createWagmiConfig(app).connectors;
    expect(connectors.map((c) => c.name)).toEqual(["Demo wallet"]);
  });
});

function setup() {
  setDemoFlag(true);
  setDemoLatencyMs(0);
  const app = resolveConfig(undefined, env());
  const services = createServices(app);
  const wagmi = createWagmiConfig(app);
  const kv = memoryKV();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <WagmiProvider config={wagmi}>
      <StoreProvider app={app} services={services} kv={kv}>
        {children}
      </StoreProvider>
    </WagmiProvider>
  );
  return { app, services, hook: renderHook(() => useStore(), { wrapper }) };
}

describe("demo store", () => {
  it("seeds six pinned employees and two completed payrolls when the vault is created", async () => {
    const { hook, services } = setup();
    await waitFor(() => expect(hook.result.current.phase).toBe("new"));
    await act(() => hook.result.current.createVault("device"));
    await waitFor(() => expect(hook.result.current.phase).toBe("ready"));

    const { employees, runs } = hook.result.current;
    expect(employees.map((e) => e.ensName)).toEqual(["alice", "bram", "chen", "dana", "eko", "farah"].map((n) => `${n}.soapay.eth`));
    expect(employees.map((e) => e.amount)).toEqual([4_200n, 3_850n, 5_100n, 4_200n, 3_600n, 2_950n].map((n) => n * 1_000_000n));
    // Pins match what the mock resolver returns, so "Resolve names" passes.
    const resolved = await services.resolve("alice.soapay.eth");
    expect(employees[0]!.pin.metaAddressURI).toBe(resolved.metaAddressURI);
    expect(employees[0]!.pin.registrant).toBe(resolved.registrant);

    expect(runs.map((r) => r.label)).toEqual(["August payroll", "July payroll"]);
    for (const r of runs) {
      expect(runStatus(r)).toBe("complete");
      expect(r.payer).toBe(DEMO_WALLET);
      expect(r.attempts[0]!.chunks[0]!.txHash).toMatch(/^0x[0-9a-f]{64}$/);
    }
    // "What coworkers see" is rebuilt from the record: one batch per landed chunk, every line funded.
    const batches = demoBatches(runs[0]!);
    expect(batches).toHaveLength(runs[0]!.attempts[0]!.chunks.length);
    expect(batches[0]!.lines.length).toBe(runs[0]!.attempts[0]!.chunks[0]!.lines.length);
    // Stealth-wallet balances come from the records too.
    const first = runs[0]!.attempts[0]!.chunks[0]!.lines[0]!;
    expect(demoLandedBalances(runs, [first.stealthAddress.toLowerCase()]).get(first.stealthAddress.toLowerCase())).toBe(first.amount);
  });

  it("executes a run to done with fake hashes, debits the ledger, and the faucet tops it up", async () => {
    const { hook, app } = setup();
    await waitFor(() => expect(hook.result.current.phase).toBe("new"));
    await act(() => hook.result.current.createVault("device"));
    await waitFor(() => expect(hook.result.current.phase).toBe("ready"));
    const before = demoLedger.get().usdc;
    expect(before).toBe(25_000_000_000n);

    const emps = hook.result.current.employees.slice(0, 2);
    const plan = planRun(
      emps.map((e) => ({ employeeId: e.id, name: e.ensName, metaAddressURI: e.pin.metaAddressURI, amount: e.amount })),
      { chunkSize: 500_000_000n, mode: "exact" },
    );
    const run: RunRecord = {
      id: "demo-test-run",
      createdAt: Date.now(),
      chainId: app.chainId,
      path: "disperse",
      token: app.usdc,
      payer: DEMO_WALLET,
      stealthDisperse: app.stealthDisperse!,
      denomination: plan.denomination,
      carryOut: {},
      carryCommitted: false,
      excluded: [],
      attempts: [attemptFromPlan(plan, 0, Date.now())],
    };
    let final: RunRecord | undefined;
    await act(async () => {
      final = await hook.result.current.executeRun(run, 0, plan, DEMO_WALLET);
    });
    expect(runStatus(final!)).toBe("complete");
    expect(final!.attempts[0]!.approve?.status).toBe("landed");
    for (const c of final!.attempts[0]!.chunks) expect(c.txHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(demoLedger.get().usdc).toBe(before - plan.total);
    // It landed in History like a real run.
    await waitFor(() => expect(hook.result.current.runs.find((r) => r.id === run.id)).toBeTruthy());
    expect(runStatus(hook.result.current.runs.find((r) => r.id === run.id)!)).toBe("complete");

    demoLedger.faucet();
    expect(demoLedger.get().usdc).toBe(before - plan.total + DEMO_FAUCET_USDC);
  });
});

describe("Faucet", () => {
  it("offers demo USDC in demo mode", () => {
    let pressed = 0;
    render(<Faucet chainId={84532} demo usdcBalance={25_000_000_000n} onFaucet={() => pressed++} />);
    const b = screen.getByRole("button", { name: "Get 10,000 test USDC" });
    expect(screen.getByText(/25,000\.00 USDC/)).toBeInTheDocument();
    b.click();
    expect(pressed).toBe(1);
  });

  it("explains the welcome drop on Base Sepolia and links an ETH faucet", () => {
    render(<Faucet chainId={84532} demo={false} usdcBalance={12_000_000n} />);
    expect(screen.getByText(/1,000,000 test USDC from Soapay/)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /circle/i })).toBeNull();
    expect(screen.getByRole("link", { name: /base sepolia eth/i })).toHaveAttribute("href", "https://www.alchemy.com/faucets/base-sepolia");
    expect(screen.getByText(/12\.00 USDC/)).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("compact: one line with the same demo button, or the same ETH-faucet link on Base Sepolia", () => {
    const { unmount } = render(<Faucet chainId={84532} demo compact usdcBalance={25_000_000_000n} />);
    expect(screen.getByRole("button", { name: "Get 10,000 test USDC" })).toBeInTheDocument();
    expect(screen.getByText(/25,000\.00 USDC/)).toBeInTheDocument();
    expect(screen.getByTestId("faucet")).toHaveClass("faucet-line");
    unmount();
    render(<Faucet chainId={84532} demo={false} compact usdcBalance={12_000_000n} />);
    expect(screen.getByRole("link", { name: /base sepolia eth/i })).toHaveAttribute("href", "https://www.alchemy.com/faucets/base-sepolia");
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByText(/from Soapay/)).toBeNull();
  });

  it("renders nothing on mainnet", () => {
    const { container } = render(<Faucet chainId={8453} demo={false} />);
    expect(container).toBeEmptyDOMElement();
  });
});
