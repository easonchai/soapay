// Base Sepolia demo (D-52): mock pay token, sponsored gas, no Exit (the mock can't bridge), and no
// Convert anywhere in the app (removed on every chain).
import { afterEach, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { CIRCLE_USDC, MOCK_USDC_BASE_SEPOLIA, configurePayToken, getChainConfig } from "@soapay/sdk";
import { applyPayToken, exitOffered, readEnv } from "../src/config.js";
import { Layout } from "../src/screens/Layout.js";
import { ServicesProvider, buildServices } from "../src/services/ServicesProvider.js";
import { createSdkSpendService } from "../src/services/spend.js";
import { VaultProvider } from "../src/vault/VaultProvider.js";
import { defaultSettings } from "../src/vault/types.js";

afterEach(() => configurePayToken(84532, undefined));

function renderNav() {
  const services = buildServices({ ...defaultSettings(), chainId: 84532, apiUrl: "http://mock" }, true);
  render(
    <VaultProvider idleLockMs={0}>
      <ServicesProvider override={services}>
        <MemoryRouter>
          <Layout />
        </MemoryRouter>
      </ServicesProvider>
    </VaultProvider>,
  );
}

describe("testnet mode (Base Sepolia, mock USDC)", () => {
  it("pays in the mock token; VITE_PAY_TOKEN overrides it", () => {
    expect(getChainConfig(84532).usdc).toBe(MOCK_USDC_BASE_SEPOLIA);
    const other = "0x1111111111111111111111111111111111111111";
    expect(readEnv({ VITE_PAY_TOKEN: other }).payToken).toBe(other);
    expect(applyPayToken({ payToken: other })).toBeNull();
    expect(getChainConfig(84532).usdc).toBe(other);
    expect(applyPayToken({ payToken: "junk" })).toMatch(/not an address/);
    expect(applyPayToken({ payToken: "" })).toBeNull();
    expect(getChainConfig(84532).usdc).toBe(MOCK_USDC_BASE_SEPOLIA);
  });

  it("hides Exit on the demo; it comes back only where the pay token is Circle USDC", () => {
    expect(exitOffered(84532)).toBe(false);
    configurePayToken(84532, CIRCLE_USDC[84532]);
    expect(exitOffered(84532)).toBe(true);
  });

  it("the nav has no Exit tab on the demo and no Convert tab at all", async () => {
    renderNav();
    expect(await screen.findByText("Payments")).toBeTruthy();
    expect(screen.getByText("Send")).toBeTruthy();
    expect(screen.queryByText("Exit")).toBeNull();
    expect(screen.queryByText("Convert")).toBeNull();
  });

  it("with Circle USDC as the pay token the Exit tab is back (still no Convert)", async () => {
    configurePayToken(84532, CIRCLE_USDC[84532]);
    renderNav();
    expect(await screen.findByText("Exit")).toBeTruthy();
    expect(screen.queryByText("Convert")).toBeNull();
  });

  it("Send needs the API URL on a sponsored chain (the paymaster lives there)", () => {
    const publicClient = {} as never;
    const noApi = createSdkSpendService({ chainId: 84532, bundlerUrl: "https://bundler.example", publicClient });
    expect(noApi.ready).toBe(false);
    expect(noApi.unavailableReason).toMatch(/Soapay API URL/);
    const ok = createSdkSpendService({ chainId: 84532, bundlerUrl: "https://bundler.example", publicClient, paymasterUrl: "https://api.example/paymaster" });
    expect(ok.ready).toBe(true);
  });
});
