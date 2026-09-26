// Regression: ISSUE-004 — history rows, recipient rows and the group panel were mouse-only divs
// Found by /qa on 2026-09-26
// Report: .gstack/qa-reports/qa-report-localhost-2026-09-26.md
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { clickable, StaggerItem } from "@soapay/ui";

afterEach(cleanup);

describe("clickable rows", () => {
  it("StaggerItem with onClick is a focusable button that opens on Enter and Space", () => {
    const onClick = vi.fn();
    render(<StaggerItem onClick={onClick}>alice.soapay.eth</StaggerItem>);
    const row = screen.getByRole("button", { name: "alice.soapay.eth" });
    expect(row.tabIndex).toBe(0);
    fireEvent.keyDown(row, { key: "Enter" });
    fireEvent.keyDown(row, { key: " " });
    expect(onClick).toHaveBeenCalledTimes(2);
  });

  it("StaggerItem without onClick stays a plain element", () => {
    render(<StaggerItem>static row</StaggerItem>);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("ignores keys from a nested control, so a Copy button inside the row doesn't toggle it", () => {
    const onClick = vi.fn();
    render(
      <div {...clickable(onClick)}>
        row <button type="button">Copy</button>
      </div>,
    );
    fireEvent.keyDown(screen.getByRole("button", { name: "Copy" }), { key: "Enter" });
    expect(onClick).not.toHaveBeenCalled();
  });

  it("reports expanded state for rows that expand", () => {
    render(<div {...clickable(() => {}, true)}>run</div>);
    expect(screen.getByRole("button", { name: "run" }).getAttribute("aria-expanded")).toBe("true");
  });
});
