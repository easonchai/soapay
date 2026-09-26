import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { Compare } from "../src/pages/landing/Compare.js";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const reducedMotion = () =>
  vi.spyOn(window, "matchMedia").mockImplementation((media) => ({
    matches: true,
    media,
    onchange: null,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    dispatchEvent: () => false,
  }));

describe("Landing · Compare", () => {
  it("renders the head and the two illustrated columns", () => {
    render(<Compare />);
    expect(screen.getByText("The same payroll, twice")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "One batch. Two ways to read it." })).toBeInTheDocument();
    expect(screen.getByText("What a block explorer shows, before and after.")).toBeInTheDocument();
    expect(screen.getByText("Without Soapay")).toBeInTheDocument();
    expect(screen.getByText("With Soapay")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Three salaries to the same wallets, names and amounts in the open" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Three fresh addresses paid the same amount, no names" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 3, name: "Names and salaries, readable by anyone" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 3, name: "Fresh addresses, equal amounts, no names" })).toBeInTheDocument();
  });

  it("with reduced motion, the marks render complete: no inline opacity from the draw-in", () => {
    reducedMotion();
    const { container } = render(<Compare />);
    const marks = container.querySelectorAll(".art-payoff");
    expect(marks.length).toBeGreaterThan(0);
    for (const el of marks) expect(el.getAttribute("style") ?? "").not.toMatch(/opacity/);
  });
});
