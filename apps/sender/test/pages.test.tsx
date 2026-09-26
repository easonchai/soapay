import { describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach } from "vitest";
afterEach(cleanup);
import type { Address } from "viem";
import { PayRunPage } from "../src/pages/PayRunPage.js";
import type { PayRunState } from "../src/hooks/usePayRun.js";
import type { RosterState } from "../src/hooks/useRoster.js";
import type { PayPathState, WalletState } from "../src/hooks/usePayPath.js";
import type { Employee } from "../src/lib/roster.js";

const REG = "0x00000000000000000000000000000000000000aa" as Address;
const emp = (id: string, extra: Partial<Employee> = {}): Employee => ({
  id,
  ensName: `${id}.soapay.eth`,
  amount: 4_200_000_000n,
  pin: { metaAddressURI: `st:eth:0x${"02".repeat(66)}`, registrant: REG, pinnedAt: 1 },
  pinHistory: [],
  carry: 0n,
  active: true,
  ...extra,
});

const noop = async () => undefined;
function roster(employees: Employee[]): RosterState {
  return {
    rows: employees.map((e) => ({ employee: e, check: undefined, payability: { payable: false, reason: "unchecked", message: "" } })),
    busy: false,
    error: null,
    verifyProgress: null,
    enroll: async () => true,
    importCsv: async () => ({ added: 0, issues: [] }),
    verifyAll: noop,
    reapprove: vi.fn(noop),
    setActive: noop,
    setAmount: async () => true,
    remove: noop,
    simulateRotation: null,
    clearError: () => undefined,
  };
}
const run = (over: Partial<PayRunState> = {}): PayRunState => ({
  stage: "idle",
  rows: [],
  progress: null,
  plan: null,
  funding: null,
  error: null,
  runId: null,
  safeChunks: null,
  label: "",
  setLabel: () => {},
  verify: noop,
  preview: () => undefined,
  execute: noop,
  exportSafe: noop,
  downloadSafeChunk: () => undefined,
  reset: () => undefined,
  ...over,
});
const wallet: WalletState = { address: REG, isConnected: true, wrongChain: false, connectors: [], connecting: false, connectError: null, disconnect: () => undefined };
const payPath: PayPathState = { probe: null, funding: null, loading: false, error: null, disperseConfigured: true, refresh: () => undefined };

describe("Pay run screen (CK design on our hooks)", () => {
  it("blocks an unattested record change and offers Re-approve; shows the World ID badge on attested pins", () => {
    const changed = emp("bob", {
      pendingChange: { metaAddressURI: `st:eth:0x${"03".repeat(66)}`, registrant: REG, detectedAt: 2, attestation: { state: "missing", reason: "No World ID" } },
    });
    const attested = emp("alice", { pin: { ...emp("alice").pin, attested: { verifiedAt: 5, attester: REG, from: "st:eth:0x" } } });
    const r = run({
      stage: "verified",
      rows: [
        { employee: attested, check: undefined, payability: { payable: true } },
        { employee: changed, check: undefined, payability: { payable: false, reason: "changed", message: "changed" } },
      ],
    });
    render(<PayRunPage run={r} roster={roster([attested, changed])} wallet={wallet} payPath={payPath} chainName="Base Sepolia" onReview={() => undefined} onOpenRecipients={() => undefined} />);
    expect(screen.getByText("Blocked · record changed")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Re-approve" })).toBeInTheDocument();
    expect(screen.getByText("Re-verified by World ID")).toBeInTheDocument();
    expect(screen.getByText(/1 recipient payable/)).toBeInTheDocument();
  });

  it("has an optional run label wired to usePayRun", async () => {
    const setLabel = vi.fn();
    render(<PayRunPage run={run({ label: "Sep", setLabel })} roster={roster([emp("alice")])} wallet={wallet} payPath={payPath} chainName="Base Sepolia" onReview={() => undefined} onOpenRecipients={() => undefined} />);
    const input = screen.getByRole("textbox", { name: "Run label" }) as HTMLInputElement;
    expect(input.value).toBe("Sep");
    fireEvent.change(input, { target: { value: "September payroll" } });
    expect(setLabel).toHaveBeenCalledWith("September payroll");
  });

  it("empty pay run blooms its ring in like the vault gate", () => {
    const { container } = render(<PayRunPage run={run()} roster={roster([])} wallet={wallet} payPath={payPath} chainName="Base Sepolia" onReview={() => undefined} onOpenRecipients={() => undefined} />);
    expect(screen.getByText("Nothing to send yet")).toBeInTheDocument();
    expect(container.querySelector(".empty .halo canvas.dots")).not.toBeNull();
  });

  it("says the paste box is roster only", async () => {
    render(<PayRunPage run={run()} roster={roster([])} wallet={wallet} payPath={payPath} chainName="Base Sepolia" onReview={() => undefined} onOpenRecipients={() => undefined} />);
    fireEvent.click(screen.getAllByRole("button", { name: "Paste rows" })[0]!);
    expect(await screen.findByText(/Every payee is a pinned, verified ENS name/)).toBeInTheDocument();
  });

  it("denominates by default with the company chunk; off is per run and warned", () => {
    const onReview = vi.fn();
    const alice = emp("alice");
    const r = run({ stage: "verified", rows: [{ employee: alice, check: undefined, payability: { payable: true } }] });
    const { unmount } = render(
      <PayRunPage run={r} roster={roster([alice])} wallet={wallet} payPath={payPath} chainName="Base Sepolia" onReview={onReview} onOpenRecipients={() => undefined} chunk="250" />,
    );
    expect(screen.getByText("250 USDC")).toBeInTheDocument();
    expect(screen.getByText(/one smaller final line, exact wage/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^Review/ }));
    expect(onReview).toHaveBeenLastCalledWith({ chunkSize: 250_000_000n, mode: "exact" });

    fireEvent.click(screen.getByRole("switch", { name: "Denominated payouts" }));
    expect(screen.getByText(/Off for this run/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^Review/ }));
    expect(onReview).toHaveBeenLastCalledWith(null);
    unmount();

    // A new run starts ON again: turning it off is never remembered.
    render(<PayRunPage run={r} roster={roster([alice])} wallet={wallet} payPath={payPath} chainName="Base Sepolia" onReview={onReview} onOpenRecipients={() => undefined} />);
    expect(screen.getByText("500 USDC")).toBeInTheDocument();
    expect(screen.queryByText(/Off for this run/)).toBeNull();
  });

  it("shows a 5 USDC default chunk on a testnet (D-47)", () => {
    const r = run({ stage: "verified", rows: [{ employee: emp("alice"), check: undefined, payability: { payable: true } }] });
    render(<PayRunPage run={r} roster={roster([emp("alice")])} wallet={wallet} payPath={payPath} chainName="Base Sepolia" testnet onReview={() => undefined} onOpenRecipients={() => undefined} />);
    expect(screen.getByText("5 USDC")).toBeInTheDocument();
  });

  it("one primary button steps from Resolve names to Review", () => {
    const verify = vi.fn(noop);
    const { unmount } = render(
      <PayRunPage run={run({ verify })} roster={roster([emp("alice")])} wallet={wallet} payPath={payPath} chainName="Base Sepolia" onReview={() => undefined} onOpenRecipients={() => undefined} />,
    );
    const primary = screen.getByTestId("pay-primary");
    expect(primary).toHaveTextContent("Resolve names");
    expect(primary).toBeEnabled();
    fireEvent.click(primary);
    expect(verify).toHaveBeenCalledTimes(1);
    // The old footer Resolve button is gone: one primary action, and no "Resolve again" before a first resolve.
    expect(screen.queryByRole("button", { name: "Resolve again" })).toBeNull();
    unmount();

    const onReview = vi.fn();
    const alice = emp("alice");
    render(
      <PayRunPage
        run={run({ stage: "verified", rows: [{ employee: alice, check: undefined, payability: { payable: true } }] })}
        roster={roster([alice])}
        wallet={wallet}
        payPath={payPath}
        chainName="Base Sepolia"
        onReview={onReview}
        onOpenRecipients={() => undefined}
      />,
    );
    const review = screen.getByTestId("pay-primary");
    expect(review).toHaveTextContent(/^Review \d+ lines?/);
    expect(review).toBeEnabled();
    fireEvent.click(review);
    expect(onReview).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Resolve again" })).toBeInTheDocument();
  });

  it("shows Names resolved for a beat when verification finishes, then steps to Review", async () => {
    const alice = emp("alice");
    const verifying = run({ stage: "verifying", progress: { done: 0, total: 1 } });
    const { rerender } = render(
      <PayRunPage run={verifying} roster={roster([alice])} wallet={wallet} payPath={payPath} chainName="Base Sepolia" onReview={() => undefined} onOpenRecipients={() => undefined} />,
    );
    const primary = screen.getByTestId("pay-primary");
    expect(primary).toHaveTextContent("Resolving 0/1…");
    expect(primary).toBeDisabled();

    const verified = run({ stage: "verified", rows: [{ employee: alice, check: undefined, payability: { payable: true } }] });
    rerender(<PayRunPage run={verified} roster={roster([alice])} wallet={wallet} payPath={payPath} chainName="Base Sepolia" onReview={() => undefined} onOpenRecipients={() => undefined} />);
    await waitFor(() => expect(screen.getByTestId("pay-primary")).toHaveTextContent("Names resolved"));
    expect(screen.getByTestId("pay-primary")).toBeDisabled();
    await waitFor(() => expect(screen.getByTestId("pay-primary")).toHaveTextContent(/^Review \d+ lines?/), { timeout: 3000 });
    expect(screen.getByTestId("pay-primary")).toBeEnabled();
  });

  it("disables the primary button with a reason when nothing can be sent", () => {
    render(<PayRunPage run={run()} roster={roster([])} wallet={wallet} payPath={payPath} chainName="Base Sepolia" onReview={() => undefined} onOpenRecipients={() => undefined} />);
    const primary = screen.getByTestId("pay-primary");
    expect(primary).toHaveTextContent("Add recipients");
    expect(primary).toBeDisabled();
  });
});
