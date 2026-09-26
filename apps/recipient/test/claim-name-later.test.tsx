// A name skipped during onboarding can be claimed later from Name settings (Payments shows a banner pointing there).
import { useEffect, type ReactNode } from "react";
import { beforeEach, describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { generateMnemonic, keysFromMnemonic } from "@soapay/sdk";
import { InviteProvider } from "../src/hooks/useInvite.js";
import { registerMetaAddress } from "../src/onboarding/actions.js";
import { NameSettings } from "../src/screens/NameSettings.js";
import { ServicesProvider, buildServices } from "../src/services/ServicesProvider.js";
import { deleteEnvelope } from "../src/vault/idb.js";
import { VaultProvider, useVault } from "../src/vault/VaultProvider.js";
import { defaultSettings } from "../src/vault/types.js";

const services = buildServices({ ...defaultSettings(), apiUrl: "http://mock" }, true);

/** An onboarded, registered vault whose owner skipped the name step. */
function SkippedName({ children }: { children: ReactNode }) {
  const vault = useVault();
  useEffect(() => {
    if (vault.status !== "empty") return;
    const mnemonic = generateMnemonic();
    void (async () => {
      await vault.create(mnemonic, "correct horse battery staple");
      await registerMetaAddress({ api: services.api, client: services.client, keys: keysFromMnemonic(mnemonic), chainId: services.settings.chainId });
      await vault.update((d) => ({ ...d, profile: { ...d.profile, nameSkipped: true, onboardedAt: Date.now() } }));
    })();
  }, [vault]);
  return vault.status === "unlocked" && vault.data?.profile.onboardedAt ? <>{children}</> : null;
}

beforeEach(async () => {
  await deleteEnvelope();
});

describe("claiming a name after skipping it", () => {
  it("Name settings offers the claim form without the skip option, and shows the name once claimed", async () => {
    render(
      <VaultProvider idleLockMs={0}>
        <ServicesProvider override={services}>
          <InviteProvider hash="#/">
            <MemoryRouter>
              <SkippedName>
                <NameSettings />
              </SkippedName>
            </MemoryRouter>
          </InviteProvider>
        </ServicesProvider>
      </VaultProvider>,
    );
    const user = userEvent.setup();
    const input = await screen.findByTestId("label-input", {}, { timeout: 10_000 });
    expect(screen.getByText("You skipped this during setup")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Skip, I'll share my meta-address/ })).toBeNull();

    await user.type(input, "alex");
    const cont = screen.getByRole("button", { name: "Continue" });
    await waitFor(() => expect((cont as HTMLButtonElement).disabled).toBe(false));
    await user.click(cont);

    await user.click(await screen.findByRole("button", { name: "Skip and claim alex.soapay.eth" }));
    expect(await screen.findByRole("heading", { name: "alex.soapay.eth" })).toBeTruthy();
  });
});
