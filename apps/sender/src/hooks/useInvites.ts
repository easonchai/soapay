// Employer invite links (docs/mvp-spec.md §7): create, show, poll, auto-enroll, re-invite.
// UI-agnostic: returns data and actions only. The logic lives in src/lib/invites.ts.
import { useCallback, useEffect, useRef, useState } from "react";
import { useAccount, useConfig } from "wagmi";
import type { Address } from "viem";
import type { InviteSigner } from "@soapay/sdk";
import { tryParseUsdc } from "../lib/amount.js";
import {
  applyPollOutcomes,
  createInvite,
  inviteStatusText,
  needsPolling,
  pollInvites,
  type InvitedEmployee,
} from "../lib/invites.js";
import { wagmiTypedDataSigner } from "../lib/wallet.js";
import { useStore } from "./store.js";

export type InviteRow = { invite: InvitedEmployee; statusText: string; canReinvite: boolean };

export type InvitesState = {
  rows: InviteRow[];
  /** null when invites can be created; otherwise why not (no API, no wallet). */
  unavailable: string | null;
  busy: boolean;
  error: string | null;
  /** The invite just created (show its link and QR code). */
  created: InvitedEmployee | null;
  create(input: { label: string; amount: string; org?: string }): Promise<InvitedEmployee | null>;
  /** New code and signature for an expired invite; replaces the old row. */
  reinvite(id: string): Promise<InvitedEmployee | null>;
  /** Drops the row locally (the API reservation lapses at expiry). */
  remove(id: string): Promise<void>;
  pollNow(): Promise<void>;
  dismissCreated(): void;
  clearError(): void;
};

export const INVITE_POLL_MS = 5_000;
export const MOCK_INVITE_POLL_MS = 1_000;

export function useInvites(opts: { pollMs?: number } = {}): InvitesState {
  const { app, services, invites, employees, updateInvites, updateEmployees } = useStore();
  const wagmiConfig = useConfig();
  const { address } = useAccount();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<InvitedEmployee | null>(null);

  const api = services.invites;
  const mockSigner = services.mock?.inviteSigner;
  const signer: { signer: InviteSigner; employer: Address } | null = mockSigner
    ? { signer: mockSigner, employer: mockSigner.address }
    : address
      ? { signer: wagmiTypedDataSigner(wagmiConfig), employer: address }
      : null;
  const unavailable = !api
    ? "Invites need the Soapay API (VITE_API_URL)."
    : !signer
      ? "Connect a wallet to sign invites."
      : null;

  const make = useCallback(
    async (input: { label: string; amount: bigint; org?: string | undefined }, replaceId?: string) => {
      if (!api) throw new Error("Invites need the Soapay API (VITE_API_URL).");
      if (!signer) throw new Error("Connect a wallet to sign invites.");
      const inv = await createInvite(
        { label: input.label, amount: input.amount, ...(input.org ? { org: input.org } : {}) },
        { api, signer: signer.signer, employer: signer.employer, chainId: app.chainId, recipientUrl: app.recipientUrl },
        { invites: invites.filter((i) => i.id !== replaceId), employees },
      );
      await updateInvites((list) => [...list.filter((i) => i.id !== replaceId), inv]);
      setCreated(inv);
      return inv;
    },
    [api, app.chainId, app.recipientUrl, employees, invites, signer, updateInvites],
  );

  const guard = useCallback(async <T,>(fn: () => Promise<T>, fallback: T): Promise<T> => {
    setBusy(true);
    setError(null);
    try {
      return await fn();
    } catch (e) {
      setError((e as { shortMessage?: string }).shortMessage ?? (e instanceof Error ? e.message : String(e)));
      return fallback;
    } finally {
      setBusy(false);
    }
  }, []);

  const create = useCallback(
    (input: { label: string; amount: string; org?: string }) =>
      guard(async () => {
        const amount = tryParseUsdc(input.amount);
        if (!amount.ok) throw new Error(amount.error);
        return make({ label: input.label, amount: amount.value, org: input.org });
      }, null),
    [guard, make],
  );

  const reinvite = useCallback(
    (id: string) =>
      guard(async () => {
        const old = invites.find((i) => i.id === id);
        if (!old) return null;
        if (old.state.kind !== "expired") throw new Error("Only an expired invite can be re-sent");
        return make({ label: old.label, amount: old.amount, org: old.org }, id);
      }, null),
    [guard, invites, make],
  );

  const remove = useCallback(
    (id: string) =>
      guard(async () => {
        await updateInvites((list) => list.filter((i) => i.id !== id));
        setCreated((c) => (c?.id === id ? null : c));
      }, undefined),
    [guard, updateInvites],
  );

  // Polling: one pass at a time; enrolls through the normal resolve-and-pin path.
  const polling = useRef(false);
  const latest = useRef({ invites, employees });
  latest.current = { invites, employees };
  const pollNow = useCallback(async () => {
    if (!api || polling.current) return;
    const todo = latest.current.invites.filter(needsPolling);
    if (!todo.length) return;
    polling.current = true;
    try {
      const outcomes = await pollInvites(todo, { api, resolve: services.resolve, roster: latest.current.employees });
      if (!outcomes.size) return;
      let enrolled: ReturnType<typeof applyPollOutcomes>["enrolled"] = [];
      await updateEmployees((cur) => {
        const r = applyPollOutcomes([], cur, outcomes);
        enrolled = r.enrolled;
        return r.employees;
      });
      await updateInvites((cur) => applyPollOutcomes(cur, [], outcomes).invites);
      if (enrolled.length) setCreated((c) => (c && outcomes.has(c.id) ? null : c));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      polling.current = false;
    }
  }, [api, services.resolve, updateEmployees, updateInvites]);

  const pollMs = opts.pollMs ?? (services.mock ? MOCK_INVITE_POLL_MS : INVITE_POLL_MS);
  const hasWork = invites.some(needsPolling);
  useEffect(() => {
    if (!api || !hasWork) return;
    void pollNow();
    const t = setInterval(() => void pollNow(), pollMs);
    return () => clearInterval(t);
  }, [api, hasWork, pollMs, pollNow]);

  return {
    rows: invites.map((invite) => ({ invite, statusText: inviteStatusText(invite), canReinvite: invite.state.kind === "expired" })),
    unavailable,
    busy,
    error,
    created,
    create,
    reinvite,
    remove,
    pollNow,
    dismissCreated: () => setCreated(null),
    clearError: () => setError(null),
  };
}
