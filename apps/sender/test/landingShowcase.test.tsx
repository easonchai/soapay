import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Showcase, SHOWCASE_PERIOD_MS } from "../src/pages/landing/Showcase.js";

// jsdom has no IntersectionObserver, so useVisible reports the section as on screen and the loop runs.
beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const frame = (id: string) => document.querySelector(`[data-frame="${id}"]`);

describe("Landing · Showcase", () => {
  it("renders the three tabs and starts on the pay run", () => {
    render(<Showcase />);
    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((t) => t.getAttribute("data-tab"))).toEqual(["pay", "review", "history"]);
    expect(tabs[0]).toHaveAttribute("aria-selected", "true");
    expect(frame("pay")).not.toBeNull();
    expect(frame("review")).toBeNull();
    expect(frame("history")).toBeNull();
    expect(screen.getByText("alice.soapay.eth")).toBeInTheDocument();
  });

  it("clicking History shows the history frame and its runs", () => {
    render(<Showcase />);
    fireEvent.click(screen.getByRole("tab", { name: /^History/ }));
    expect(frame("history")).not.toBeNull();
    expect(screen.getByRole("tab", { name: /^History/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("September payroll")).toBeInTheDocument();
  });

  it("auto-advances to Review after the period when nothing was clicked", () => {
    render(<Showcase />);
    expect(frame("review")).toBeNull();
    act(() => {
      vi.advanceTimersByTime(SHOWCASE_PERIOD_MS);
    });
    expect(frame("review")).not.toBeNull();
    expect(screen.getByRole("tab", { name: /^Review/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("Sign and pay")).toBeInTheDocument();
  });

  it("a clicked tab pins the showcase: the timer no longer moves it", () => {
    render(<Showcase />);
    fireEvent.click(screen.getByRole("tab", { name: /^History/ }));
    act(() => {
      vi.advanceTimersByTime(SHOWCASE_PERIOD_MS * 2);
    });
    expect(screen.getByRole("tab", { name: /^History/ })).toHaveAttribute("aria-selected", "true");
    expect(frame("history")).not.toBeNull();
  });
});
