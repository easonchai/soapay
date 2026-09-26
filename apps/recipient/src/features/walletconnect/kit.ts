/**
 * The real WalletKit client. Imported dynamically so the WalletConnect SDK (and its relay socket)
 * only loads once the user opens "Connect to a dApp" or already has a live session.
 */
import type { WalletKitLike } from "./controller.js";

export async function createWalletKit(projectId: string): Promise<WalletKitLike> {
  const [{ Core }, { WalletKit }] = await Promise.all([import("@walletconnect/core"), import("@reown/walletkit")]);
  const core = new Core({ projectId });
  const origin = typeof location !== "undefined" ? location.origin : "https://soapay.local";
  const kit = await WalletKit.init({
    // Core's class and WalletKit's ICore disagree under exactOptionalPropertyTypes (relayUrl?: string).
    core: core as unknown as Parameters<typeof WalletKit.init>[0]["core"],
    metadata: {
      name: "Soapay",
      description: "Soapay payment address (one stealth address per dApp)",
      url: origin,
      icons: [],
    },
  });
  return kit as unknown as WalletKitLike;
}
