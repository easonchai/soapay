// wagmi config: injected (MetaMask, Rabby, …), Coinbase Smart Wallet, WalletConnect
// when a project id is set, and in dev mock mode a demo wallet. Only the pay chain is
// configured, so every action targets it explicitly.
import { createConfig, http, type Config, type CreateConnectorFn } from "wagmi";
import { coinbaseWallet, injected, mock, walletConnect } from "wagmi/connectors";
import type { Address } from "viem";
import type { AppConfig } from "../config.js";

/** Dev mock / demo mode: the demo wallet's address. It can read balances; it can't sign anything real. */
export const DEMO_WALLET: Address = "0x00000000000000000000000000000000DeaDBeef";

/** Demo mode's only connector: the wagmi mock connector, presented as "Demo wallet". It never signs anything (demoChain.ts fakes execution). */
function demoConnector(): CreateConnectorFn {
  const inner = mock({ accounts: [DEMO_WALLET], features: { reconnect: true } });
  return (cfg) => ({ ...inner(cfg), name: "Demo wallet" });
}

export function createWagmiConfig(app: AppConfig): Config {
  if (app.demo) {
    return createConfig({ chains: [app.chain], connectors: [demoConnector()], transports: { [app.chain.id]: http(app.rpcUrl) } });
  }
  const connectors: CreateConnectorFn[] = [
    injected({ shimDisconnect: true }),
    // Smart wallet only: it supports EIP-5792 atomic batches, the no-contract pay path.
    coinbaseWallet({ appName: "Soapay", preference: { options: "smartWalletOnly" } }),
  ];
  // Optional: @walletconnect/ethereum-provider is NOT a dependency (it is large). To enable,
  // `pnpm --filter @soapay/sender add @walletconnect/ethereum-provider` and set the project id;
  // without the package the connector fails only when someone picks it.
  if (app.walletConnectProjectId) {
    connectors.push(walletConnect({ projectId: app.walletConnectProjectId, showQrModal: true }));
  }
  if (app.mockEns) {
    connectors.push(mock({ accounts: [DEMO_WALLET], features: { reconnect: true } }));
  }
  return createConfig({
    chains: [app.chain],
    connectors,
    transports: { [app.chain.id]: http(app.rpcUrl) },
  });
}
