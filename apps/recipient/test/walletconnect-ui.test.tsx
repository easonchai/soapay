import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { getAddress } from "viem";
import type { ReactNode } from "react";
import type { PendingApproval } from "../src/features/walletconnect/controller.js";
import { DappRequestSheet } from "../src/screens/DappRequestSheet.js";
import { ServicesProvider, buildServices } from "../src/services/ServicesProvider.js";
import { VaultProvider } from "../src/vault/VaultProvider.js";
import { defaultSettings } from "../src/vault/types.js";

const ME = getAddress("0x1111111111111111111111111111111111111111");
const MAIN = getAddress("0x2222222222222222222222222222222222222222");
const POOL = getAddress("0xa238dd80c259a72e81d7e4664a9801593f98d1c5");

function withServices(children: ReactNode) {
  const services = buildServices({ ...defaultSettings(), chainId: 84532, apiUrl: "http://mock" }, true);
  return (
    <VaultProvider idleLockMs={0}>
      <ServicesProvider override={services}>{children}</ServicesProvider>
    </VaultProvider>
  );
}

const approval = (blocked: boolean, extra: Partial<PendingApproval> = {}): PendingApproval => ({
  requestId: 1,
  topic: "t",
  validation: "VALID",
  isScam: false,
  request: {
    kind: "transaction",
    method: "eth_sendTransaction",
    dapp: { name: "Aave", url: "https://app.aave.com" },
    address: ME,
    chainId: 84532,
    calls: [{ to: POOL, value: 0n, data: "0x617ba037", selector: "0x617ba037" }],
    notes: [],
    privacy: blocked
      ? { warnings: [{ code: "identifiable", address: MAIN, message: `This request names ${MAIN}, which you labelled main-wallet.` }], transfers: [], blocked: true }
      : { warnings: [], transfers: [], blocked: false },
  },
  ...extra,
});

describe("dApp approval sheet", () => {
  it("shows who asks, the one address, zero ETH and sponsored gas; approve passes through", async () => {
    const onDecide = vi.fn();
    render(withServices(<DappRequestSheet approval={approval(false)} onDecide={onDecide} />));
    const sheet = await screen.findByTestId("dapp-request-sheet");
    expect(sheet.textContent).toMatch(/Aave wants to send a transaction/);
    expect(sheet.textContent).toMatch(/Gas is sponsored/);
    expect(screen.getByText("Verified domain")).toBeTruthy();
    expect(screen.getByTestId("dapp-privacy").dataset.blocked).toBe("false");
    fireEvent.click(screen.getByTestId("dapp-approve"));
    expect(onDecide).toHaveBeenCalledWith({ approved: true, override: false });
  });

  it("a privacy block disables Approve until the override is ticked", async () => {
    const onDecide = vi.fn();
    render(withServices(<DappRequestSheet approval={approval(true)} onDecide={onDecide} />));
    const approve = (await screen.findByTestId("dapp-approve")) as HTMLButtonElement;
    expect(screen.getByText(/labelled main-wallet/)).toBeTruthy();
    expect(approve.disabled).toBe(true);
    fireEvent.click(screen.getByRole("checkbox"));
    expect(approve.disabled).toBe(false);
    fireEvent.click(approve);
    expect(onDecide).toHaveBeenCalledWith({ approved: true, override: true });
  });

  it("a site flagged as a scam can only be rejected", async () => {
    const onDecide = vi.fn();
    render(withServices(<DappRequestSheet approval={approval(false, { isScam: true })} onDecide={onDecide} />));
    expect(((await screen.findByTestId("dapp-approve")) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByTestId("dapp-reject"));
    expect(onDecide).toHaveBeenCalledWith({ approved: false });
  });
});
