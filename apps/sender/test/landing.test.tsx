import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Landing } from "../src/pages/Landing.js";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const ICON = "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciLz4=";

function mount(connectors: { id: string; name: string; icon?: string }[]) {
  return render(
    <Landing
      wallet={{ isConnected: false, connecting: false, connectError: null, connectors: connectors.map((c) => ({ ...c, connect() {} })) }}
      onLogin={() => {}}
      employeeUrl="http://localhost:5173"
      docsUrl="/docs/"
    />,
  );
}

describe("Landing", () => {
  it("links the docs from the top bar and the footer, never to PRD.md", () => {
    mount([{ id: "a", name: "MetaMask", icon: ICON }]);
    const docs = screen.getAllByRole("link", { name: /^docs$/i });
    expect(docs.length).toBe(2);
    for (const l of docs) expect(l.getAttribute("href")).toBe("/docs/");
    expect(document.querySelector('a[href*="PRD.md"]')).toBeNull();
  });

  it("renders the hero headline as two lines with Private as a dot word over its text", () => {
    const { container } = mount([{ id: "a", name: "MetaMask", icon: ICON }]);
    const heading = container.querySelector<HTMLElement>(".land-h1");
    expect(heading).not.toBeNull();
    if (!heading) return;
    const lines = heading.querySelectorAll(":scope > .line");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toHaveTextContent("Public chain.");
    expect(lines[1]).toHaveTextContent("Private payroll.");
    expect(heading.textContent).toContain("Public chain. Private payroll.");
    const word = container.querySelector<HTMLElement>(".dot-word");
    expect(word).toHaveTextContent("Private");
    expect(word?.querySelector(".dot-word-canvas")).not.toBeNull();
    // The last word starts on "payroll." and only rolls on once its interval fires.
    expect(container.querySelector(".roll-item")).toHaveTextContent("payroll.");
  });

  it("keeps the word as plain text while the canvas cannot paint (jsdom has no 2d context)", () => {
    const { container } = mount([{ id: "a", name: "MetaMask", icon: ICON }]);
    expect(container.querySelector(".dot-word")).not.toHaveClass("is-dots");
  });

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
