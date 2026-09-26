/**
 * WalletConnect controller (D-61): owns the WalletKit client, the pending proposal, the active
 * sessions and the approval sheet queue. UI-free (React subscribes through `subscribe`), and the
 * WalletKit client comes from an injected factory so tests run against a fake.
 */
import { getAddress, isAddressEqual, type Address } from "viem";
import { buildSessionNamespaces, chainIdOf, ProposalError, sessionAccount, type Namespace, type Proposal } from "./namespaces.js";
import { CallsStore, routeRequest, type ApprovalDecision, type ApprovalRequest, type DappInfo, type RouterDeps } from "./router.js";
import { RPC, RpcError, toRpcError, WC_REASON } from "./rpc.js";

type Metadata = { name?: string; url?: string; description?: string; icons?: string[] };
type Verify = { verified?: { validation?: "VALID" | "INVALID" | "UNKNOWN"; origin?: string; isScam?: boolean | null } };

export type SessionLike = { topic: string; namespaces: Record<string, { accounts: string[] }>; peer: { metadata: Metadata }; expiry?: number };
export type ProposalEvent = {
  id: number;
  params: Proposal & { id: number; proposer: { metadata: Metadata } };
  verifyContext?: Verify;
};
export type RequestEvent = { id: number; topic: string; params: { request: { method: string; params?: unknown }; chainId: string }; verifyContext?: Verify };
type Reason = { code: number; message: string };
type RpcResponse = { id: number; jsonrpc: "2.0"; result?: unknown; error?: Reason };

/** The subset of @reown/walletkit this app uses. */
export interface WalletKitLike {
  on(event: "session_proposal", fn: (e: ProposalEvent) => void): unknown;
  on(event: "session_request", fn: (e: RequestEvent) => void): unknown;
  on(event: "session_delete" | "proposal_expire" | "session_request_expire", fn: (e: { id: number; topic?: string }) => void): unknown;
  pair(p: { uri: string }): Promise<unknown>;
  approveSession(p: { id: number; namespaces: Record<string, Namespace> }): Promise<unknown>;
  rejectSession(p: { id: number; reason: Reason }): Promise<unknown>;
  respondSessionRequest(p: { topic: string; response: RpcResponse }): Promise<unknown>;
  disconnectSession(p: { topic: string; reason: Reason }): Promise<unknown>;
  getActiveSessions(): Record<string, SessionLike>;
  core?: { relayer?: { transportClose?: () => Promise<void> } };
}

export type Validation = "VALID" | "INVALID" | "UNKNOWN";
export type PendingProposal = { id: number; dapp: DappInfo & { description?: string }; validation: Validation; isScam: boolean; error: string | null };
export type SessionView = { topic: string; dapp: DappInfo; address: Address | null; chainId: number | null; expiry?: number };
export type PendingApproval = { requestId: number; topic: string; request: ApprovalRequest; validation: Validation; isScam: boolean };

export type WcState = {
  status: "idle" | "starting" | "ready" | "error";
  error: string | null;
  proposal: PendingProposal | null;
  sessions: SessionView[];
  approval: PendingApproval | null;
};

export type ControllerOptions = {
  projectId: string;
  /** The app's active chain: the only chain sessions are approved and served on. */
  chainId: number;
  chainName: string;
  createKit: (projectId: string) => Promise<WalletKitLike>;
  /** Latest SDK-backed deps (execution, signing, privacy); read at request time. */
  deps: () => Omit<RouterDeps, "approve" | "bundles">;
  /** Stealth addresses the user may expose (the ledger). */
  ownAddresses: () => readonly Address[];
};

const dappOf = (m: Metadata | undefined): DappInfo => ({ name: m?.name?.trim() || "Unknown dApp", url: m?.url?.trim() || "unknown origin" });
const verifyOf = (v: Verify | undefined) => ({ validation: v?.verified?.validation ?? "UNKNOWN", isScam: v?.verified?.isScam === true });

/** Validates a pasted pairing URI (WalletConnect v2: `wc:<topic>@2?...`). */
export function parsePairingUri(input: string): string {
  const uri = input.trim();
  if (!uri.startsWith("wc:")) throw new Error("Paste a WalletConnect link: it starts with wc:");
  if (!/^wc:[0-9a-f]+@2\?/i.test(uri)) throw new Error("This WalletConnect link is from an older version (v1) or incomplete. Copy it again from the dApp.");
  return uri;
}

export class WalletConnectController {
  private kit: WalletKitLike | null = null;
  private starting: Promise<void> | null = null;
  private state: WcState = { status: "idle", error: null, proposal: null, sessions: [], approval: null };
  private readonly listeners = new Set<(s: WcState) => void>();
  private readonly bundles = new CallsStore();
  private readonly proposals = new Map<number, ProposalEvent>();
  /** Approval sheets are shown one at a time; later requests wait their turn. */
  private approvals: Promise<unknown> = Promise.resolve();
  private resolveCurrent: ((d: ApprovalDecision) => void) | null = null;
  private disposed = false;

  constructor(private readonly opts: ControllerOptions) {}

  getState(): WcState {
    return this.state;
  }

  subscribe(fn: (s: WcState) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private set(patch: Partial<WcState>): void {
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) l(this.state);
  }

  /** Connects to the relay (lazily: nothing touches the network until the user uses the feature). */
  start(): Promise<void> {
    if (this.kit) return Promise.resolve();
    this.starting ??= (async () => {
      this.set({ status: "starting", error: null });
      try {
        const kit = await this.opts.createKit(this.opts.projectId);
        if (this.disposed) return;
        this.kit = kit;
        kit.on("session_proposal", (e) => void this.onProposal(e));
        kit.on("session_request", (e) => void this.onRequest(e));
        kit.on("session_delete", () => this.refreshSessions());
        kit.on("proposal_expire", (e) => {
          if (this.state.proposal?.id === e.id) this.set({ proposal: null });
        });
        kit.on("session_request_expire", (e) => {
          if (this.state.approval?.requestId === e.id) this.resolveApproval({ approved: false });
        });
        this.refreshSessions();
        this.set({ status: "ready" });
      } catch (e) {
        this.starting = null;
        this.set({ status: "error", error: e instanceof Error ? e.message : String(e) });
        throw e;
      }
    })();
    return this.starting;
  }

  private requireKit(): WalletKitLike {
    if (!this.kit) throw new Error("WalletConnect isn't started");
    return this.kit;
  }

  async pair(input: string): Promise<void> {
    const uri = parsePairingUri(input);
    await this.start();
    await this.requireKit().pair({ uri });
  }

  private onProposal(e: ProposalEvent): void {
    this.proposals.set(e.id, e);
    let error: string | null = null;
    try {
      // A placeholder address: this only checks that the dApp's chains fit.
      buildSessionNamespaces(e.params, { chainId: this.opts.chainId, chainName: this.opts.chainName, address: "0x0000000000000000000000000000000000000001" });
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
    const md = e.params.proposer?.metadata;
    this.set({
      proposal: { id: e.id, dapp: { ...dappOf(md), ...(md?.description ? { description: md.description } : {}) }, ...verifyOf(e.verifyContext), error },
    });
  }

  /** Approves the pending proposal exposing exactly ONE of the user's stealth addresses. */
  async approveProposal(address: Address): Promise<void> {
    const p = this.state.proposal;
    if (!p) throw new Error("No connection request is waiting");
    const e = this.proposals.get(p.id);
    if (!e) throw new Error("The connection request expired");
    const own = this.opts.ownAddresses();
    if (!own.some((a) => isAddressEqual(a, address))) throw new Error("Pick one of your payment addresses");
    const namespaces = buildSessionNamespaces(e.params, { chainId: this.opts.chainId, chainName: this.opts.chainName, address: getAddress(address) });
    await this.requireKit().approveSession({ id: p.id, namespaces });
    this.proposals.delete(p.id);
    this.set({ proposal: null });
    this.refreshSessions();
  }

  async rejectProposal(): Promise<void> {
    const p = this.state.proposal;
    if (!p) return;
    const e = this.proposals.get(p.id);
    this.proposals.delete(p.id);
    this.set({ proposal: null });
    let reason: Reason = WC_REASON.userRejected;
    if (e) {
      try {
        buildSessionNamespaces(e.params, { chainId: this.opts.chainId, address: "0x0000000000000000000000000000000000000001" });
      } catch (err) {
        if (err instanceof ProposalError) reason = err.reason;
      }
    }
    await this.requireKit().rejectSession({ id: p.id, reason });
  }

  async disconnect(topic: string): Promise<void> {
    await this.requireKit().disconnectSession({ topic, reason: WC_REASON.userDisconnected });
    this.refreshSessions();
  }

  refreshSessions(): void {
    if (!this.kit) return;
    const sessions = Object.values(this.kit.getActiveSessions()).map((s): SessionView => {
      let account: { address: Address; chainId: number } | null = null;
      try {
        account = sessionAccount(s.namespaces);
      } catch {
        account = null;
      }
      return { topic: s.topic, dapp: dappOf(s.peer?.metadata), address: account?.address ?? null, chainId: account?.chainId ?? null, ...(s.expiry ? { expiry: s.expiry } : {}) };
    });
    this.set({ sessions });
  }

  /** The approval sheet's answer for the request on screen. */
  resolveApproval(decision: ApprovalDecision): void {
    const r = this.resolveCurrent;
    this.resolveCurrent = null;
    this.set({ approval: null });
    r?.(decision);
  }

  private approveVia(e: RequestEvent) {
    return (request: ApprovalRequest): Promise<ApprovalDecision> => {
      const turn = this.approvals.then(
        () =>
          new Promise<ApprovalDecision>((resolve) => {
            if (this.disposed) return resolve({ approved: false });
            this.resolveCurrent = resolve;
            this.set({ approval: { requestId: e.id, topic: e.topic, request, ...verifyOf(e.verifyContext) } });
          }),
      );
      this.approvals = turn.catch(() => undefined);
      return turn;
    };
  }

  private async onRequest(e: RequestEvent): Promise<void> {
    const kit = this.kit;
    if (!kit) return;
    let response: RpcResponse;
    try {
      const s = kit.getActiveSessions()[e.topic];
      if (!s) throw new RpcError(RPC.unauthorized, "Unknown session");
      // Exactly one address per session, or nothing is answered.
      const account = sessionAccount(s.namespaces);
      if (account.chainId !== this.opts.chainId || chainIdOf(e.params.chainId) !== this.opts.chainId)
        throw new RpcError(4901, `Soapay is on ${this.opts.chainName} now; reconnect this dApp.`);
      const result = await routeRequest(
        e.params.request,
        { topic: e.topic, address: account.address, chainId: account.chainId, dapp: dappOf(s.peer?.metadata) },
        { ...this.opts.deps(), approve: this.approveVia(e), bundles: this.bundles },
      );
      response = { id: e.id, jsonrpc: "2.0", result };
    } catch (err) {
      const rpc = err instanceof RpcError ? toRpcError(err) : err instanceof Error && /exactly one address/.test(err.message) ? { code: RPC.unauthorized, message: err.message } : toRpcError(err);
      response = { id: e.id, jsonrpc: "2.0", error: rpc };
    }
    if (this.disposed) return;
    await kit.respondSessionRequest({ topic: e.topic, response }).catch(() => undefined);
  }

  /** Lock / unmount: refuse what's on screen and drop the relay connection. */
  dispose(): void {
    this.disposed = true;
    if (this.resolveCurrent) this.resolveApproval({ approved: false });
    void this.kit?.core?.relayer?.transportClose?.().catch(() => undefined);
    this.listeners.clear();
  }
}
