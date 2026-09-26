/**
 * Demo views (D-41), UI glue only: the protocol logic (rebuild a pay run from its receipt, mark the
 * viewer's lines, read the gasless-spend facts) lives in @soapay/sdk (`fetchPayRunBatch`,
 * `markOwnLines`, `readGaslessProof`). These hooks pick the inputs from the vault and the services.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  fetchPayRunBatch,
  markOwnLines,
  readGaslessProof,
  type GaslessProof,
  type LedgerEntry,
  type OwnedBatch,
  type PayRunBatch,
} from "@soapay/sdk";
import type { Address, Hex } from "viem";
import { useServices } from "../services/ServicesProvider.js";
import type { SpendRecord, ConvertRecord } from "../vault/types.js";
import { useWallet } from "./useWallet.js";

/** One transaction that paid at least one of the viewer's addresses. */
export type PayRunGroup = {
  txHash: Hex;
  blockNumber: bigint;
  payer: Address | null;
  /** The viewer's stealth addresses announced in this tx (matched by the scanner with the viewing key). */
  mine: Address[];
};

/** Groups the ledger by the transaction that announced each address. Newest first. Pure. */
export function payRunGroups(ledger: readonly LedgerEntry[]): PayRunGroup[] {
  const byTx = new Map<string, PayRunGroup>();
  for (const e of ledger) {
    for (const a of e.announcements) {
      const k = a.txHash.toLowerCase();
      const g = byTx.get(k) ?? { txHash: a.txHash, blockNumber: a.blockNumber, payer: e.payer, mine: [] };
      if (!g.mine.some((m) => m.toLowerCase() === e.stealthAddress.toLowerCase())) g.mine.push(e.stealthAddress);
      byTx.set(k, g);
    }
  }
  return [...byTx.values()].sort((a, b) => (a.blockNumber === b.blockNumber ? 0 : a.blockNumber > b.blockNumber ? -1 : 1));
}

type Load<T> = { status: "loading" } | { status: "ready"; value: T } | { status: "error"; error: string };

const errorText = (e: unknown) => (e instanceof Error ? e.message.split("\n")[0]! : String(e));

// Receipts never change once mined, so a rebuilt batch is cached for the session.
const batchCache = new Map<string, PayRunBatch>();

/**
 * The whole batch of one pay-run transaction, rebuilt from its receipt, with the viewer's lines marked.
 * `mine` comes from the scanner's matches, so "yours" means "your viewing key found it".
 */
export function usePayRunBatch(txHash: Hex): Load<OwnedBatch> {
  const svc = useServices();
  const wallet = useWallet();
  const chainId = svc.settings.chainId;
  const key = `${chainId}:${txHash.toLowerCase()}`;
  const [state, setState] = useState<Load<PayRunBatch>>(() => {
    const hit = batchCache.get(key);
    return hit ? { status: "ready", value: hit } : { status: "loading" };
  });

  useEffect(() => {
    const hit = batchCache.get(key);
    if (hit) {
      setState({ status: "ready", value: hit });
      return;
    }
    let live = true;
    setState({ status: "loading" });
    fetchPayRunBatch({ client: svc.client, txHash, chainId }).then(
      (batch) => {
        batchCache.set(key, batch);
        if (live) setState({ status: "ready", value: batch });
      },
      (e: unknown) => live && setState({ status: "error", error: errorText(e) }),
    );
    return () => {
      live = false;
    };
  }, [key, svc.client, txHash, chainId]);

  const mine = useMemo(
    () => wallet.state.matches.filter((m) => m.txHash.toLowerCase() === txHash.toLowerCase()).map((m) => m.stealthAddress),
    [wallet.state.matches, txHash],
  );
  return useMemo(() => (state.status === "ready" ? { status: "ready", value: markOwnLines(state.value, mine) } : state), [state, mine]);
}

/** Live facts about a stealth address after it spent: ETH balance, nonce, code, and the spend's receipt. */
export function useGaslessProof(address: Address, txHash?: Hex): Load<GaslessProof> & { refresh(): void } {
  const svc = useServices();
  const chainId = svc.settings.chainId;
  const [state, setState] = useState<Load<GaslessProof>>({ status: "loading" });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    setState({ status: "loading" });
    readGaslessProof({ client: svc.client, address, chainId, ...(txHash ? { txHash } : {}) }).then(
      (value) => live && setState({ status: "ready", value }),
      (e: unknown) => live && setState({ status: "error", error: errorText(e) }),
    );
    return () => {
      live = false;
    };
  }, [svc.client, address, txHash, chainId, tick]);
  const refresh = useCallback(() => setTick((t) => t + 1), []);
  return { ...state, refresh };
}

/** The latest spend or convert transaction sent from `address`, from the local history. Pure. */
export function lastSpendTx(address: Address, spends: readonly SpendRecord[], conversions: readonly ConvertRecord[]): { txHash: Hex; at: number } | null {
  let best: { txHash: Hex; at: number } | null = null;
  const same = (a: string) => a.toLowerCase() === address.toLowerCase();
  for (const s of spends) for (const p of s.parts) if (same(p.from) && p.txHash && (!best || s.at > best.at)) best = { txHash: p.txHash, at: s.at };
  for (const c of conversions) if (same(c.address) && c.txHash && (!best || c.at > best.at)) best = { txHash: c.txHash, at: c.at };
  return best;
}
