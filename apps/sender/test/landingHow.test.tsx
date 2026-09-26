import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { HowItWorks } from "../src/pages/landing/HowItWorks.js";

// jsdom has no IntersectionObserver; report the section as visible if a dependency asks.
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
  it("explains the three-step payment sequence in order", () => {
    render(<HowItWorks />);

    expect(screen.getByRole("heading", { level: 2, name: "A fresh address for every payment." })).toBeInTheDocument();
    expect(screen.getAllByText(/^(01|02|03)$/).map((node) => node.textContent)).toEqual(["01", "02", "03"]);
    for (const title of ["One name per person", "A new address per payment", "Only its owner can open it"]) {
      expect(screen.getByRole("heading", { level: 3, name: title })).toBeInTheDocument();
    }
    for (const label of [
      "A name that publishes a key",
      "One key, a new address for each payment",
      "Only the owner's key opens them",
    ]) {
      expect(screen.getByRole("img", { name: label })).toBeInTheDocument();
    }
    expect(screen.getAllByRole("img")).toHaveLength(3);
  });

  it("renders every payoff fully visible with reduced motion", () => {
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query.includes("reduced-motion"),
      addEventListener() {},
      removeEventListener() {},
    }));

    render(<HowItWorks />);

    const payoffs = Array.from(document.querySelectorAll<SVGElement>(".art-payoff"));
    expect(payoffs.length).toBeGreaterThan(0);
    expect(payoffs.every((payoff) => payoff.style.opacity === "")).toBe(true);
  });
});
