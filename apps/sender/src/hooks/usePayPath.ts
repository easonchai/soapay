// The connected wallet, how it pays (paypath.ts) and whether it can fund a run.
// UI-agnostic: returns data and actions only.
import { useQuery } from "@tanstack/react-query";
import { useAccount, useConfig, useConnect, useDisconnect } from "wagmi";
import type { Address } from "viem";
import { probeAccount, readFunding, type AccountProbe, type Funding } from "../lib/wallet.js";
import { useStore } from "./store.js";

export type WalletState = {
  address: Address | undefined;
  isConnected: boolean;
  /** Wallet is on a different chain than the pay chain (actions still target the pay chain). */
  wrongChain: boolean;
  connectors: { id: string; name: string; icon?: string | undefined; connect(): void }[];
  connecting: boolean;
  connectError: string | null;
  disconnect(): void;
};

export function useWallet(): WalletState {
  const { app } = useStore();
  const { address, isConnected, chainId } = useAccount();
  const { connectors, connect, isPending, error } = useConnect();
  const { disconnect } = useDisconnect();
  return {
    address,
    isConnected,
    wrongChain: isConnected && chainId !== undefined && chainId !== app.chainId,
    connectors: connectors.map((c) => ({ id: c.uid, name: c.name, icon: c.icon, connect: () => connect({ connector: c, chainId: app.chainId }) })),
    connecting: isPending,
    connectError: error ? (error as { shortMessage?: string }).shortMessage ?? error.message : null,
    disconnect: () => disconnect(),
  };
}

export type PayPathState = {
  /** Null while disconnected or loading. */
  probe: AccountProbe | null;
  funding: Funding | null;
  loading: boolean;
  error: string | null;
  /** False when no StealthDisperse address is configured: only EIP-5792 batches and Safe exports can pay. */
  disperseConfigured: boolean;
  refresh(): void;
};

export function usePayPath(): PayPathState {
  const { app } = useStore();
  const config = useConfig();
  const { address } = useAccount();
  const enabled = !!address;
  const probe = useQuery({
    queryKey: ["probe", app.chainId, address, app.stealthDisperse],
    queryFn: () => probeAccount(config, app, address!),
    enabled,
    staleTime: 60_000,
  });
  const funding = useQuery({
    queryKey: ["funding", app.chainId, address],
    queryFn: () => readFunding(config, app, address!),
    enabled,
    staleTime: 15_000,
  });
  const err = probe.error ?? funding.error;
  return {
    probe: probe.data ?? null,
    funding: funding.data ?? null,
    loading: enabled && (probe.isLoading || funding.isLoading),
    error: err ? err.message : null,
    disperseConfigured: !!app.stealthDisperse,
    refresh: () => {
      void probe.refetch();
      void funding.refetch();
    },
  };
}
