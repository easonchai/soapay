import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { Compare } from "../src/pages/landing/Compare.js";

// jsdom has no matchMedia; motionOff() reads it for prefers-reduced-motion.
if (typeof window.matchMedia !== "function") {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener() {},
      removeListener() {},
      addEventListener() {},
      removeEventListener() {},
      dispatchEvent: () => false,
    }),
  });
}

// jsdom has no IntersectionObserver either (framer's whileInView needs one); everything is "on screen".
if (typeof (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver === "undefined") {
  class IO {
    constructor(private cb: IntersectionObserverCallback) {}
    root = null;
    rootMargin = "";
    thresholds = [];
    observe(target: Element) {
      this.cb([{ isIntersecting: true, target, intersectionRatio: 1 } as unknown as IntersectionObserverEntry], this as unknown as IntersectionObserver);
    }
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return [];
    }
  }
  (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver = IO;
}

// Framer drives its animations from requestAnimationFrame + performance.now, so fake those too. Faked once
// per file, not per test: framer's frameloop keeps one rAF in flight, and swapping back to real timers between
// tests would drop it, leaving every later animation frozen.
beforeAll(() =>
  vi.useFakeTimers({
    toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date", "requestAnimationFrame", "cancelAnimationFrame", "performance"],
  }),
);
afterAll(() => vi.useRealTimers());
afterEach(cleanup);

/**
 * Past the 8 × 70 ms hex scramble, the 0.6 s crossfades and the staggered row slide. Async, because
 * framer clears its cached frame timestamp in a microtask: a synchronous advance never lets time move.
 */
const tick = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
const settle = () => tick(2500);
const rows = () => within(screen.getByRole("table")).getAllByRole("row").slice(1); // drop the header row
const tab = (name: RegExp) => screen.getByRole("tab", { name });

describe("Landing · Compare", () => {
  it("renders the header copy and starts on the plain payroll", () => {
    render(<Compare />);
    expect(screen.getByText("The same payroll, twice")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "One batch. Two ways to read it." })).toBeInTheDocument();
    expect(
      screen.getByText("Plain wallet, then Soapay, as a block explorer shows it."),
    ).toBeInTheDocument();
    expect(screen.getByText("Without Soapay · what any block explorer shows")).toBeInTheDocument();
    expect(screen.getByText(/Same address every month/)).toBeInTheDocument();
    expect(rows()).toHaveLength(5);
    expect(tab(/^without soapay$/i)).toHaveAttribute("aria-selected", "true");
    expect(tab(/^with soapay$/i)).toHaveAttribute("aria-selected", "false");
  });

  it("the With Soapay tab shows the Soapay batch: navy header, eight fresh rows, settled addresses", async () => {
    render(<Compare />);
    fireEvent.click(tab(/^with soapay$/i));
    expect(screen.getByText("With Soapay · the same batch")).toBeInTheDocument();
    expect(screen.getByText("tx 0x2f90…11de")).toBeInTheDocument();
    expect(screen.getByText(/337 fresh addresses, 500 USDC each/)).toBeInTheDocument();
    expect(tab(/^with soapay$/i)).toHaveAttribute("aria-selected", "true");
    await settle();
    const r = rows();
    expect(r).toHaveLength(8);
    expect(screen.getByText("0x7a3F…9c1E")).toBeInTheDocument();
    expect(screen.getByText("0xa90E…3fB7")).toBeInTheDocument();
    expect(screen.queryByText(/alice\.eth/)).toBeNull();
    for (const row of r) expect(row.querySelector(".fresh")).not.toBeNull();
    expect(screen.getAllByText("500.00 USDC")).toHaveLength(8);
  });

  it("the Without Soapay tab brings the five named rows back", async () => {
    render(<Compare />);
    fireEvent.click(tab(/^with soapay$/i));
    await settle();
    fireEvent.click(tab(/^without soapay$/i));
    expect(screen.getByText(/Same address every month/)).toBeInTheDocument();
    expect(screen.getByText("Without Soapay · what any block explorer shows")).toBeInTheDocument();
    await settle();
    expect(rows()).toHaveLength(5);
    expect(screen.getByText("0x4d2C…88Fa")).toBeInTheDocument();
    expect(screen.getByText("alice.eth · Meridian")).toBeInTheDocument();
    expect(screen.getAllByText("4,200.00 USDC")).toHaveLength(2); // alice and eko
    expect(screen.getByText("3,850.00 USDC")).toBeInTheDocument();
    expect(screen.queryByText("500.00 USDC")).toBeNull();
  });

  it("a click stops the automatic loop for good", async () => {
    render(<Compare />);
    fireEvent.click(tab(/^without soapay$/i));
    await tick(20_000);
    expect(screen.getByText("Without Soapay · what any block explorer shows")).toBeInTheDocument();
    expect(rows()).toHaveLength(5);
  });

  it("left alone on screen, it morphs to Soapay after a beat", async () => {
    render(<Compare />);
    expect(screen.getByText("Without Soapay · what any block explorer shows")).toBeInTheDocument();
    await tick(1700);
    expect(screen.getByText("With Soapay · the same batch")).toBeInTheDocument();
  });
});
