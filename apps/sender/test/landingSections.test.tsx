import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Landing } from "../src/pages/Landing.js";

afterEach(cleanup);

function mount(onLogin = () => {}) {
  return render(
    <Landing
      wallet={{
        isConnected: false,
        connecting: false,
        connectError: null,
        connectors: [
          { id: "a", name: "MetaMask", connect() {} },
          { id: "b", name: "Coinbase Wallet", connect() {} },
        ],
      }}
      onLogin={onLogin}
      employeeUrl="http://localhost:5173"
    />,
  );
}

describe("Landing sections", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    Element.prototype.scrollIntoView = vi.fn();
  });
  afterEach(() => vi.useRealTimers());

  it("renders the sections in order under the hero", () => {
    const { container } = mount();
    const heads = [...container.querySelectorAll("h1, h2")].map((h) => h.textContent);
    const order = ["Every wallet address is a public bank statement.", "One batch. Two ways to read it.", "One signature. Nobody can read it back.", "A back office, not a crypto app.", "Paying a team? Paste names, sign once."];
    const idx = order.map((t) => heads.findIndex((h) => h?.includes(t)));
    expect(idx.every((i) => i >= 0)).toBe(true);
    expect([...idx].sort((a, b) => a - b)).toEqual(idx);
  });

  it("nav links scroll to their section and never change the hash", () => {
    mount();
    const before = window.location.hash;
    fireEvent.click(screen.getAllByRole("link", { name: "How it works" })[0]!);
    fireEvent.click(screen.getByRole("link", { name: "Product" }));
    expect(Element.prototype.scrollIntoView).toHaveBeenCalledTimes(2);
    expect(window.location.hash).toBe(before);
  });

  it("the CTA band login opens the chooser and brings the hero into view", () => {
    const onLogin = vi.fn();
    mount(onLogin);
    fireEvent.click(screen.getByTestId("cta-login"));
    expect(onLogin).toHaveBeenCalledOnce();
    expect(screen.getByRole("dialog", { name: /choose a wallet/i })).toBeInTheDocument();
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
  });
});
