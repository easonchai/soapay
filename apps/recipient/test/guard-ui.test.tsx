import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ClusterGraph, planSpend } from "@soapay/sdk";
import type { Address } from "viem";
import { GuardDecision, canSend } from "../src/screens/GuardDecision.js";

const A = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as Address;
const B = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" as Address;
const FRESH = "0x1111111111111111111111111111111111111111" as Address;
const MAIN = "0x2222222222222222222222222222222222222222" as Address;

function graph() {
  const g = new ClusterGraph();
  g.addStealth(A, { runId: "r1", amount: 500n });
  g.addStealth(B, { runId: "r2", amount: 500n });
  g.addExternal(MAIN).setLabel(MAIN, "main-wallet");
  return g;
}

describe("GuardDecision", () => {
  it("allow: one source to a fresh address needs no confirmation", () => {
    const plan = planSpend(graph(), { from: [A], to: FRESH });
    expect(plan.decision).toBe("allow");
    render(<GuardDecision plan={plan} override={false} onOverride={() => {}} />);
    expect(screen.getByTestId("guard-decision").dataset.decision).toBe("allow");
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(canSend(plan)).toBe(true);
  });

  it("block: merging clusters into an identifiable wallet disables Send until overridden", () => {
    const g = graph();
    const plan = planSpend(g, { from: [A, B], to: MAIN });
    expect(plan.decision).toBe("block");
    expect(canSend(plan)).toBe(false);
    const onOverride = vi.fn();
    render(<GuardDecision plan={plan} override={false} onOverride={onOverride} />);
    expect(screen.getByRole("alert").textContent).toMatch(/Blocked/);
    fireEvent.click(screen.getByRole("checkbox"));
    expect(onOverride).toHaveBeenCalledWith(true);

    const overridden = planSpend(g, { from: [A, B], to: MAIN, override: true });
    expect(overridden.decision).not.toBe("block");
    expect(canSend(overridden)).toBe(true);
  });

  it("warn: shows the guard's warnings", () => {
    const plan = planSpend(graph(), { from: [A, B], to: FRESH });
    expect(plan.decision).toBe("warn");
    render(<GuardDecision plan={plan} override={false} onOverride={() => {}} />);
    expect(screen.getByText("Privacy warning")).toBeTruthy();
    expect(screen.getAllByRole("listitem").length).toBeGreaterThan(0);
    expect(canSend(plan)).toBe(true);
  });

  it("no plan (insufficient funds) can't send", () => {
    expect(canSend(null)).toBe(false);
  });
});
