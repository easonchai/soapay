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

  it("renders each wallet's own icon, a bundled Coinbase mark, and a glyph for the browser wallet last", () => {
    mount([
      { id: "injected", name: "Injected" },
      { id: "coinbaseWalletSDK", name: "Coinbase Wallet" },
      { id: "io.metamask", name: "MetaMask", icon: ICON },
    ]);
    fireEvent.click(screen.getByRole("button", { name: /login with wallet/i }));
    const dialog = screen.getByRole("dialog", { name: /choose a wallet/i });
    const buttons = [...dialog.querySelectorAll("button")];
    expect(buttons.map((b) => b.textContent?.trim())).toEqual(["Coinbase Wallet", "MetaMask", "Browser wallet"]);
    expect(buttons[0]!.querySelector("svg[data-brand=coinbase]")).not.toBeNull();
    expect(buttons[1]!.querySelector("img.wallet-icon")?.getAttribute("src")).toBe(ICON);
    expect(buttons[2]!.querySelector("img")).toBeNull();
    expect(buttons[2]!.querySelector("svg")).not.toBeNull();
  });
});

describe("Landing chrome", () => {
  it("header is a floating island with the lockup between the section links, and the footer draws the wordmark from dots", () => {
    const { container } = mount([{ id: "a", name: "MetaMask", icon: ICON }]);
    const island = container.querySelector(".land-bar nav.island");
    expect(island).not.toBeNull();
    const kids = [...island!.children].map((el) => el.className.split(" ")[0]);
    expect(kids).toEqual(["links", "brand", "links", "btn-primary"]);
    expect(island!.querySelector(".brand svg[aria-label=Soapay]")).not.toBeNull();
    const foot = container.querySelector("footer.land-foot");
    expect(foot).not.toBeNull();
    expect(foot!.querySelector("canvas.dotword[role=img][aria-label=Soapay]")).not.toBeNull();
    expect(foot!.textContent).toContain("© 2026 Soapay");
  });
});
