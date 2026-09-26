// Payments screen pieces (Home.tsx) rendered with props: the hero, scan progress, the empty state and the
// ledger. They compose Home without the vault and scanner providers, which is what makes this cheap.
import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import type { LedgerEntry } from "@soapay/sdk";
import { getAddress, type Address, type Hex } from "viem";
import { Hero, LedgerTable, NoPayments, ScanProgress, ShareRow, linkedCount, scanFraction, spentAddresses } from "../src/screens/Home.js";
import { MOCK_EMPLOYER } from "../src/services/mock.js";

const addr = (n: number): Address => getAddress(`0x${n.toString(16).padStart(40, "0")}`);
const TX: Hex = `0x${"aa".repeat(32)}`;
const UNIT = 1_000_000n;

function entry(stealth: Address, balance: bigint): LedgerEntry {
  return {
    stealthAddress: stealth,
    token: addr(1),
    balance,
    payer: MOCK_EMPLOYER,
    payerKnown: true,
    claimedAmount: balance,
    flags: [],
    announcements: [{ blockNumber: 100n, txHash: TX, logIndex: 1, stealthAddress: stealth, caller: addr(0xd15), ephemeralPubKey: "0x", metadata: "0x" }],
  };
}

const heroHandlers = { onSend: vi.fn(), onScan: vi.fn(), onFullScan: vi.fn(), onExit: vi.fn() };

describe("Home: hero", () => {
  it("shows 0.00 USDC, the address line and a disabled Send before anything arrives", () => {
    render(<Hero name={null} address={addr(0xabc)} total={0n} addressCount={0} linked={0} running={false} {...heroHandlers} />);
    const total = screen.getByTestId("total");
    expect(total.className).toContain("zero");
    expect(total.textContent).toBe("0.00USDC");
    expect(screen.getByText("0 addresses · none linked")).toBeTruthy();
    const send = screen.getByRole("button", { name: "Send" }) as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    expect(send.title).toBe("Nothing to send yet");
    expect(screen.getByRole("button", { name: "Rescan" })).toBeTruthy();
    expect((screen.getByRole("button", { name: "Exit" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("with money in, Send is live, the total counts up and linked addresses are counted", () => {
    render(<Hero name="alex.soapay.eth" address={addr(0xabc)} total={1_250n * UNIT} addressCount={3} linked={2} running={false} {...heroHandlers} />);
    expect(screen.getByText("alex.soapay.eth")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Send" }) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByText("3 addresses · 2 linked")).toBeTruthy();
    expect(screen.getByTestId("total").textContent).toMatch(/USDC$/);
  });

  it("while a scan runs, Rescan reads Scanning… and the full rescan is disabled", () => {
    render(<Hero name={null} address={addr(0xabc)} total={0n} addressCount={0} linked={0} running {...heroHandlers} />);
    expect(screen.getByRole("button", { name: /Scanning…/ })).toBeTruthy();
    expect((screen.getByRole("button", { name: "Rescan from start" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("linkedCount counts only addresses that share a cluster", () => {
    expect(linkedCount([{ addresses: [1] }, { addresses: [1, 2] }, { addresses: [1, 2, 3] }])).toBe(5);
    expect(linkedCount([{ addresses: [1] }])).toBe(0);
  });
});

describe("Home: scan progress", () => {
  it("is a progressbar; determinate only when the phase carries counts", () => {
    const { unmount } = render(<ScanProgress phase={{ phase: "scanning", progress: { scanned: 30, total: 120 } }} />);
    const bar = screen.getByRole("progressbar");
    expect(bar.getAttribute("aria-valuenow")).toBe("25");
    expect(bar.getAttribute("aria-label")).toBe("Checking 30 of 120 announcements");
    unmount();

    render(<ScanProgress phase={{ phase: "head" }} />);
    const head = screen.getByRole("progressbar");
    expect(head.getAttribute("aria-valuenow")).toBeNull();
    expect(head.getAttribute("aria-label")).toBe("Reading the chain head…");
  });

  it("scanFraction: counts → fraction, anything else → null", () => {
    expect(scanFraction({ phase: "scanning", progress: { scanned: 1, total: 4 } })).toBe(0.25);
    expect(scanFraction({ phase: "scanning", progress: { scanned: 0, total: 0 } })).toBeNull();
    expect(scanFraction({ phase: "fetching", fetched: 10, detail: "x" })).toBeNull();
    expect(scanFraction({ phase: "balances", addresses: 2 })).toBeNull();
    expect(scanFraction(null)).toBeNull();
  });
});

describe("Home: empty state", () => {
  it("with a name: Nothing received yet, the ask, a Copy <name> button and the halo", () => {
    const { container } = render(<NoPayments name="alex.soapay.eth" share="alex.soapay.eth" searching={false} />);
    expect(screen.getByText("Nothing received yet")).toBeTruthy();
    expect(screen.getByText("Ask your payer to send to alex.soapay.eth on Base.")).toBeTruthy();
    expect(screen.getByRole("button", { name: /^Copy/ }).textContent).toBe("Copy alex.soapay.eth");
    expect(container.querySelector(".empty .halo canvas.dots")).toBeTruthy();
  });

  it("without a name: asks for the meta-address; while the first scan runs the title says so", () => {
    const { unmount } = render(<NoPayments name={null} share="st:base:0xabc" searching={false} />);
    expect(screen.getByText("Ask your payer to send to your meta-address.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Copy meta-address" })).toBeTruthy();
    unmount();
    render(<NoPayments name={null} share="st:base:0xabc" searching />);
    expect(screen.getByText("Looking for your payments…")).toBeTruthy();
  });
});

describe("Home: with payments", () => {
  it("ShareRow shows what to share with a Copy action", () => {
    const { container } = render(<ShareRow share="alex.soapay.eth" />);
    expect(container.querySelector(".share-row .label")?.textContent).toBe("Share to get paid");
    expect(container.querySelector(".share-row .value")?.textContent).toBe("alex.soapay.eth");
    expect(within(container.querySelector(".share-row") as HTMLElement).getByRole("button", { name: "Copy" })).toBeTruthy();
  });

  it("the ledger marks an unspent funded address as fresh, and not one that already sent", () => {
    const a = addr(0x1001);
    const b = addr(0x1002);
    const spends = [{ at: 1, to: addr(9), override: false, parts: [{ from: b, amount: "1", userOpHash: TX, txHash: TX }] }];
    const onSend = vi.fn();
    render(
      <LedgerTable entries={[entry(a, 500n * UNIT), entry(b, 500n * UNIT)]} spends={spends} conversions={[]} payerName={() => "Acme"} chainId={84532} mock onSend={onSend} />,
    );
    const rows = within(screen.getByTestId("ledger")).getAllByRole("row").slice(1); // drop the header
    expect(rows).toHaveLength(2);
    expect(rows[0]!.querySelector("span.fresh")).toBeTruthy();
    expect(rows[1]!.querySelector("span.fresh")).toBeNull();
    expect(spentAddresses(spends, []).has(b.toLowerCase())).toBe(true);
    within(rows[0]!).getByRole("button", { name: "Send" }).click();
    expect(onSend).toHaveBeenCalledWith("500.00");
  });
});
