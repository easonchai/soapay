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
  it("renders the head and the three illustrated columns", () => {
    render(<ChainView />);
    expect(screen.getByRole("heading", { level: 2, name: "Public, but meaningless to a coworker." })).toBeInTheDocument();
    for (const tag of ["The record", "Anyone can see", "No one can learn"]) expect(screen.getByText(tag)).toBeInTheDocument();
    for (const name of [
      "One on-chain record: address, amount, one-time key, no recipient",
      "The payer and three addresses with their amounts, all public",
      "Names on one side, addresses on the other, no line between them",
    ]) {
      expect(screen.getByRole("img", { name })).toBeInTheDocument();
    }
    for (const title of ["One record per payment", "Lines, amounts and the payer", "Which address is whose"]) {
      expect(screen.getByRole("heading", { level: 3, name: title })).toBeInTheDocument();
    }
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
