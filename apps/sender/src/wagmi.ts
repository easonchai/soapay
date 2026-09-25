import { createConfig, http } from 'wagmi';
import { injected } from 'wagmi/connectors';
import { chainConfig } from './config.js';

export const wagmiConfig = createConfig({
  chains: [chainConfig.chain],
  connectors: [injected()],
  transports: { [chainConfig.chain.id]: http(chainConfig.rpcUrl) },
});
