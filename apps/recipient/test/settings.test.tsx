// Settings: the Network form, receiving facts and device housekeeping, laid out as label · value · action rows.
import { useEffect, type ReactNode } from "react";
import { beforeEach, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { generateMnemonic } from "@soapay/sdk";
import { Settings } from "../src/screens/Settings.js";
import { ServicesProvider, buildServices } from "../src/services/ServicesProvider.js";
import { deleteEnvelope } from "../src/vault/idb.js";
import { VaultProvider, useVault } from "../src/vault/VaultProvider.js";
import { defaultSettings } from "../src/vault/types.js";

const services = buildServices({ ...defaultSettings(), apiUrl: "http://mock" }, true);

/** An unlocked recovery-phrase vault, as after onboarding. */
function Unlocked({ children }: { children: ReactNode }) {
  const vault = useVault();
  useEffect(() => {
    if (vault.status !== "empty") return;
    void vault.create(generateMnemonic(), "correct horse battery staple");
  }, [vault]);
  return vault.status === "unlocked" ? <>{children}</> : null;
}

beforeEach(async () => {
  await deleteEnvelope();
});

function mount() {
  render(
    <VaultProvider idleLockMs={0}>
      <ServicesProvider override={services}>
        <Unlocked>
          <Settings />
        </Unlocked>
      </ServicesProvider>
    </VaultProvider>,
  );
}

describe("Settings", () => {
  it("shows the Network, Receiving and This device sections with the API field and Save", async () => {
    mount();
    const api = (await screen.findByLabelText("Soapay API URL", {}, { timeout: 10_000 })) as HTMLInputElement;
    expect(api.value.length).toBeGreaterThan(0);
    for (const name of ["Network", "Known payers", "Receiving", "This device", "Advanced recovery"]) {
      expect(screen.getByRole("heading", { name })).toBeTruthy();
    }
    expect(screen.getByLabelText("Base RPC URL")).toBeTruthy();
    expect(screen.getByLabelText("Window minimum (hours)")).toBeTruthy();
    expect(screen.getByLabelText("Read announcements over RPC instead of the Soapay API")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Save" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Download encrypted backup" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Lock now" })).toBeTruthy();
    expect(screen.getByTestId("lock-setting")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Export private keys" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("Save stores the draft and flips to Saved", async () => {
    mount();
    const user = userEvent.setup();
    const api = await screen.findByLabelText("Soapay API URL", {}, { timeout: 10_000 });
    await user.clear(api);
    await user.type(api, "http://api.example");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("button", { name: "Saved" })).toBeTruthy();
    expect((screen.getByLabelText("Soapay API URL") as HTMLInputElement).value).toBe("http://api.example");
  });

  it("deleting the vault asks first, and Cancel puts the button back", async () => {
    mount();
    const user = userEvent.setup();
    await screen.findByLabelText("Soapay API URL", {}, { timeout: 10_000 });
    expect(screen.queryByText("Delete this vault?")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Delete vault from this browser" }));
    expect(await screen.findByText("Delete this vault?")).toBeTruthy();
    expect(screen.getByText("Only your recovery phrase can bring it back.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Delete vault from this browser" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(await screen.findByRole("button", { name: "Delete vault from this browser" })).toBeTruthy();
  });
});
