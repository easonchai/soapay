import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { applySpend, checkDappPrivacy, signMessageAsStealth, signTypedDataAsStealth, type SpendPlan } from "@soapay/sdk";
import { getAddress, type Address } from "viem";
import { chainName, ENV } from "../config.js";
import { WalletConnectController, type WalletKitLike, type WcState } from "../features/walletconnect/controller.js";
import { createWalletKit } from "../features/walletconnect/kit.js";
import type { ApprovalDecision } from "../features/walletconnect/router.js";
import { DappRequestSheet } from "../screens/DappRequestSheet.js";
import { useServices } from "../services/ServicesProvider.js";
import { stealthKeyFor } from "../spend/flow.js";
import { useChain, useKeyRing } from "./useChain.js";
import { graphOf, useWallet } from "./useWallet.js";

export type WalletConnectApi = {
  /** False when VITE_WALLETCONNECT_PROJECT_ID is unset: the screen says so instead of connecting. */
  configured: boolean;
  state: WcState;
  /** Stealth addresses that can be exposed (one per session). */
  addresses: Address[];
  start(): Promise<void>;
  pair(uri: string): Promise<void>;
  approveProposal(address: Address): Promise<void>;
  rejectProposal(): Promise<void>;
  disconnect(topic: string): Promise<void>;
  resolveApproval(decision: ApprovalDecision): void;
};

const IDLE: WcState = { status: "idle", error: null, proposal: null, sessions: [], approval: null };
/** Set once the user pairs, so later unlocks reconnect live sessions; no addresses or topics are stored here. */
const USED_KEY = "soapay.walletconnect.used";

function flag(set?: boolean): boolean {
  try {
    if (set === true) localStorage.setItem(USED_KEY, "1");
    if (set === false) localStorage.removeItem(USED_KEY);
    return localStorage.getItem(USED_KEY) === "1";
  } catch {
    return false;
  }
}

const WalletConnectContext = createContext<WalletConnectApi | null>(null);

/**
 * "Connect to a dApp" (D-61). Owns the WalletConnect controller while the vault is unlocked and
 * shows the approval sheet over any screen. The relay is only contacted once the user uses the
 * feature (or already has a session from an earlier visit).
 */
export function WalletConnectProvider({
  children,
  projectId = ENV.walletConnectProjectId,
  createKit = createWalletKit,
}: {
  children: ReactNode;
  projectId?: string;
  createKit?: (projectId: string) => Promise<WalletKitLike>;
}) {
  const svc = useServices();
  const { chainId, state: chain, updateChain } = useChain();
  const ring = useKeyRing();
  const wallet = useWallet();
  const addresses = useMemo(() => [...new Set(wallet.ledger.map((e) => getAddress(e.stealthAddress)))], [wallet.ledger]);

  // Request handlers read the latest vault state, never the one at mount.
  const latest = useRef({ svc, chain, ring, wallet, addresses, updateChain });
  latest.current = { svc, chain, ring, wallet, addresses, updateChain };

  const controller = useMemo(() => {
    if (!projectId) return null;
    const key = (a: Address) => stealthKeyFor(latest.current.chain, latest.current.ring, a);
    return new WalletConnectController({
      projectId,
      chainId,
      chainName: chainName(chainId),
      createKit,
      ownAddresses: () => latest.current.addresses,
      deps: () => ({
        checkPrivacy: (input) =>
          checkDappPrivacy({ graph: latest.current.wallet.graph, ownStealth: latest.current.addresses, ...input }),
        execute: (from, calls) => latest.current.svc.dapp.execute(key(from), calls),
        signMessage: (from, message) => signMessageAsStealth({ stealthKey: key(from), message, expected: from }),
        signTypedData: (from, typedData) => signTypedDataAsStealth({ stealthKey: key(from), typedData, expected: from }),
        // Token transfers the user approved become guard links, exactly like Send records them.
        onExecuted: (_from, _calls, privacy) => {
          const plans = privacy.transfers.map((t) => t.plan).filter((p): p is SpendPlan => p !== null && p.decision !== "block");
          if (plans.length === 0) return;
          void latest.current.updateChain((s) => {
            let g = graphOf(s);
            for (const p of plans) g = applySpend(g, p);
            return { ...s, graph: g.toJSON() };
          });
        },
      }),
    });
  }, [projectId, chainId, createKit]);

  const [state, setState] = useState<WcState>(IDLE);
  useEffect(() => {
    if (!controller) return;
    setState(controller.getState());
    const off = controller.subscribe(setState);
    // Reconnect sessions from an earlier visit so their requests reach this tab.
    if (flag()) void controller.start().catch(() => undefined);
    return () => {
      off();
      controller.dispose();
    };
  }, [controller]);

  const need = useCallback(() => {
    if (!controller) throw new Error("WalletConnect isn't configured");
    return controller;
  }, [controller]);

  const api = useMemo<WalletConnectApi>(
    () => ({
      configured: controller !== null,
      state,
      addresses,
      start: () => need().start(),
      pair: async (uri) => {
        await need().pair(uri);
        flag(true);
      },
      approveProposal: (a) => need().approveProposal(a),
      rejectProposal: () => need().rejectProposal(),
      disconnect: async (topic) => {
        await need().disconnect(topic);
        if (need().getState().sessions.length === 0) flag(false);
      },
      resolveApproval: (d) => controller?.resolveApproval(d),
    }),
    [controller, state, addresses, need],
  );

  return (
    <WalletConnectContext.Provider value={api}>
      {children}
      {state.approval && <DappRequestSheet approval={state.approval} onDecide={api.resolveApproval} />}
    </WalletConnectContext.Provider>
  );
}

export function useWalletConnect(): WalletConnectApi {
  const v = useContext(WalletConnectContext);
  if (!v) throw new Error("useWalletConnect outside WalletConnectProvider");
  return v;
}
