import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { HowItWorks } from "../src/pages/landing/HowItWorks.js";

// jsdom has no IntersectionObserver and framer-motion's whileInView needs one; report everything as on screen.
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
  takeRecords() {
    return [];
  }
}

// The derivation lines type on an interval; fake timers keep it deterministic and stop it hanging the run.
beforeEach(() => {
  vi.stubGlobal("IntersectionObserver", OnScreen);
  vi.useFakeTimers();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("HowItWorks", () => {
  it("renders the header, the four flow nodes and the six steps", () => {
    render(<HowItWorks />);
    expect(screen.getByRole("heading", { level: 2, name: "Paste names. Sign once. Nobody can read it back." })).toBeInTheDocument();
    for (const tag of ["Roster · in your browser", "Derivation · on your device", "One transaction · StealthDisperse", "Fresh addresses · on chain"]) {
      expect(screen.getByText(tag)).toBeInTheDocument();
    }
    for (const t of [
      "Paste names and amounts",
      "Review the batch",
      "Sign once, or export to Safe",
      "Create keys, back up twelve words",
      "Claim a name",
      "Share the name, spend from the app",
    ]) {
      expect(screen.getByText(t)).toBeInTheDocument();
    }
  });

  it("draws a 4×7 grid of fresh-address cells that all fill once the sequence has played", () => {
    render(<HowItWorks />);
    const grid = screen.getByTestId("how-grid");
    expect(grid.querySelectorAll(".how-cell")).toHaveLength(28);
    expect(grid.querySelectorAll(".how-cell.on")).toHaveLength(0);
    act(() => {
      vi.advanceTimersByTime(12_000);
    });
    expect(grid.querySelectorAll(".how-cell.on")).toHaveLength(28);
    // Typing has finished: label and value both fully revealed.
    expect(screen.getByText("stealth address")).toBeInTheDocument();
    expect(screen.getByText("0x7a3F…9c1E")).toBeInTheDocument();
  });

  it("with reduced motion, draws the complete end state at once: all cells filled, lines fully typed", () => {
    vi.stubGlobal("matchMedia", (q: string) => ({ matches: q.includes("reduced-motion"), addEventListener() {}, removeEventListener() {} }));
    render(<HowItWorks />);
    expect(screen.getByTestId("how-grid").querySelectorAll(".how-cell.on")).toHaveLength(28);
    expect(screen.getByText("ephemeral key")).toBeInTheDocument();
    expect(screen.getByText("0x02c1…7e")).toBeInTheDocument();
    expect(document.querySelectorAll(".how-packet")).toHaveLength(0);
  });
});
