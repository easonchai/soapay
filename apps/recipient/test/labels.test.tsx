// Labels: the empty state, the three-way legend, and saving a label adds a row.
import { useEffect, type ReactNode } from "react";
import { beforeEach, describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { generateMnemonic } from "@soapay/sdk";
import { Labels } from "../src/screens/Labels.js";
import { ServicesProvider, buildServices } from "../src/services/ServicesProvider.js";
import { deleteEnvelope } from "../src/vault/idb.js";
import { VaultProvider, useVault } from "../src/vault/VaultProvider.js";
import { defaultSettings } from "../src/vault/types.js";

const services = buildServices({ ...defaultSettings(), apiUrl: "http://mock" }, true);
const MAIN = "0x2222222222222222222222222222222222222222";

/** A fresh, unlocked vault with no labels. */
function Unlocked({ children }: { children: ReactNode }) {
  const vault = useVault();
  useEffect(() => {
    if (vault.status !== "empty") return;
    void vault.create(generateMnemonic(), "correct horse battery staple");
  }, [vault]);
  return vault.status === "unlocked" ? <>{children}</> : null;
}

function mount() {
  return render(
    <VaultProvider idleLockMs={0}>
      <ServicesProvider override={services}>
        <MemoryRouter>
          <Unlocked>
            <Labels />
          </Unlocked>
        </MemoryRouter>
      </ServicesProvider>
    </VaultProvider>,
  );
}

beforeEach(async () => {
  await deleteEnvelope();
});

describe("Labels", () => {
  it("shows the empty state with its halo, and the legend", async () => {
    const { container } = mount();
    expect(await screen.findByText("No labels yet", {}, { timeout: 10_000 })).toBeTruthy();
    expect(screen.getByText("Start with your main wallet.")).toBeTruthy();
    expect(container.querySelector(".empty .halo canvas.dots")).not.toBeNull();

    const legend = container.querySelector(".legend");
    expect(legend).not.toBeNull();
    for (const t of ["Main wallet", "Exchange", "Other"]) expect(within(legend as HTMLElement).getByText(t)).toBeTruthy();
    expect(legend!.querySelectorAll(".opt").length).toBe(3);
  });

  it("saving a valid address adds a row to the list", async () => {
    mount();
    const user = userEvent.setup();
    const input = await screen.findByLabelText("Address", {}, { timeout: 10_000 });
    await user.type(input, MAIN);
    await user.click(screen.getByRole("button", { name: "Save" }));

    const list = await screen.findByTestId("labels");
    expect(within(list).getAllByRole("listitem").length).toBe(1);
    expect(within(list).getByText("My main wallet")).toBeTruthy();
    expect(list.querySelector("li.flash")).not.toBeNull();
    expect(screen.queryByText("No labels yet")).toBeNull();
    expect((input as HTMLInputElement).value).toBe("");
  });
});
