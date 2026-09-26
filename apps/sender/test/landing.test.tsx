import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Landing } from "../src/pages/Landing.js";

afterEach(cleanup);

const ICON = "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciLz4=";

function mount(connectors: { id: string; name: string; icon?: string }[]) {
  return render(
    <Landing
      wallet={{ isConnected: false, connecting: false, connectError: null, connectors: connectors.map((c) => ({ ...c, connect() {} })) }}
      onLogin={() => {}}
      employeeUrl="http://localhost:5173"
    />,
  );
}

describe("Landing", () => {
  it("shows the GitHub mark next to the header and footer GitHub links", () => {
    mount([{ id: "a", name: "MetaMask", icon: ICON }]);
    const links = screen.getAllByRole("link", { name: /github/i });
    expect(links.length).toBeGreaterThanOrEqual(2);
    for (const l of links) expect(l.querySelector("svg")).not.toBeNull();
  });

  it("renders each wallet's own icon monotone, and a glyph when a connector has none", () => {
    mount([
      { id: "a", name: "MetaMask", icon: ICON },
      { id: "b", name: "Injected" },
    ]);
    fireEvent.click(screen.getByRole("button", { name: /login with wallet/i }));
    const dialog = screen.getByRole("dialog", { name: /choose a wallet/i });
    const mm = dialog.querySelector("button:nth-of-type(1)")!;
    const inj = dialog.querySelector("button:nth-of-type(2)")!;
    expect(mm.textContent).toContain("MetaMask");
    expect(mm.querySelector("img.wallet-icon")?.getAttribute("src")).toBe(ICON);
    expect(inj.textContent).toContain("Injected");
    expect(inj.querySelector("img")).toBeNull();
    expect(inj.querySelector("svg")).not.toBeNull();
  });
});
