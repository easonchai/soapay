import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ChainView } from "../src/pages/landing/ChainView.js";
import { Guarantees } from "../src/pages/landing/Guarantees.js";
import { CtaBand } from "../src/pages/landing/CtaBand.js";

// jsdom has no IntersectionObserver; framer-motion's whileInView needs one and useVisible listens to it.
// Every observed element is reported on screen at once.
class OnScreen {
  private cb: IntersectionObserverCallback;
  constructor(cb: IntersectionObserverCallback) {
    this.cb = cb;
  }
  observe(target: Element) {
    this.cb([{ isIntersecting: true, intersectionRatio: 1, target } as IntersectionObserverEntry], this as unknown as IntersectionObserver);
  }
  unobserve() {}
  disconnect() {}
  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }
}

beforeAll(() => {
  vi.stubGlobal("IntersectionObserver", OnScreen);
  // jsdom has no matchMedia; motionOff() and framer-motion both probe it.
  if (typeof window.matchMedia !== "function") {
    window.matchMedia = ((query: string) =>
      ({
        matches: false,
        media: query,
        onchange: null,
        addListener() {},
        removeListener() {},
        addEventListener() {},
        removeEventListener() {},
        dispatchEvent: () => false,
      }) as unknown as MediaQueryList) as typeof window.matchMedia;
  }
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("ChainView", () => {
  it("renders the six key labels and types the values in, then both coworker lists", () => {
    vi.useFakeTimers();
    render(<ChainView />);
    for (const k of ["event", "stealth address", "ephemeral key", "view tag", "recipient", "amount"]) {
      expect(screen.getByText(k)).toBeInTheDocument();
    }
    // Values arrive character by character (the stubbed observer reports the card on screen at once).
    expect(screen.queryByText("500.00 USDC")).toBeNull();
    act(() => {
      vi.advanceTimersByTime(8000);
    });
    expect(screen.getByText("Announcement")).toBeInTheDocument();
    expect(screen.getByText("0x7a3F4b2c…9c1E")).toBeInTheDocument();
    expect(screen.getByText("not present")).toBeInTheDocument();
    expect(screen.getByText("500.00 USDC")).toBeInTheDocument();
    expect(screen.getByText("A coworker can see")).toBeInTheDocument();
    expect(screen.getByText("A coworker cannot learn")).toBeInTheDocument();
  });
});

describe("Guarantees", () => {
  it("renders the three titles and the four fact labels", () => {
    render(<Guarantees />);
    for (const t of ["Fresh address, every time", "No custody, one contract", "Keys and roster stay in your browser"]) {
      expect(screen.getByText(t)).toBeInTheDocument();
    }
    for (const l of ["lines per transaction", "signature per run", "funds held by Soapay", "on Base"]) {
      expect(screen.getByText(l)).toBeInTheDocument();
    }
    expect(screen.getByText("USDC")).toBeInTheDocument();
  });
});

describe("CtaBand", () => {
  it("renders the heading and calls onLogin on click", () => {
    const onLogin = vi.fn();
    render(<CtaBand onLogin={onLogin} disabled={false} label="Login with wallet" employeeUrl="http://localhost:5173" />);
    expect(screen.getByRole("heading", { name: "Paying a team? Paste names, sign once." })).toBeInTheDocument();
    const btn = screen.getByTestId("cta-login");
    expect(btn).toHaveTextContent("Login with wallet");
    fireEvent.click(btn);
    expect(onLogin).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("link", { name: "Getting paid? Open your payments" })).toHaveAttribute("href", "http://localhost:5173");
  });

  it("respects disabled", () => {
    const onLogin = vi.fn();
    render(<CtaBand onLogin={onLogin} disabled label="Connecting…" employeeUrl="http://localhost:5173" />);
    const btn = screen.getByTestId("cta-login");
    expect(btn).toBeDisabled();
    fireEvent.click(btn);
    expect(onLogin).not.toHaveBeenCalled();
  });
});
