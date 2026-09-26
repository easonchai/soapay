/**
 * `scan` / `balance`: announcements from the API index, matched with the viewing key, real
 * balances read on-chain (metadata amounts are never trusted), then the ledger and the
 * guard's cluster view. The viewing and spending keys stay in this process.
 */
import { getAddress, type Address, type Hex } from "viem";
import { balanceView, buildLedger, deriveStealthKey, scanAnnouncementsWithStats, type AnnouncementRecord, type LedgerEntry } from "@soapay/sdk";
import type { Ctx } from "../context.js";
import { loadGraph, update } from "../state.js";
import { errorMessage, formatUsdc, ToolError } from "../util.js";
import { requireKeys } from "./identity.js";

export type Holding = {
  stealthAddress: Address;
  balance: bigint;
  /** The announcement that pays this address (public data; re-derives the key on demand). */
  announcement: AnnouncementRecord;
  entry: LedgerEntry;
};

export async function collect(ctx: Ctx) {
  const keys = requireKeys(ctx);
  let announcements: AnnouncementRecord[];
  try {
    announcements = await ctx.api.announcements();
  } catch (e) {
    throw new ToolError("scan_failed", `could not fetch announcements from the API: ${errorMessage(e)}`);
  }
  const { matches, stats } = scanAnnouncementsWithStats(announcements, {
    spendingPublicKey: keys.spendingPublicKey,
    viewingPrivateKey: keys.viewingKey,
  });
  const usdc = ctx.chain.usdc;
  const rows = matches.length ? await ctx.chain.verifyBalances(matches, [usdc]) : [];
  const knownPayers = [...ctx.config.knownPayers, ...(ctx.payer ? [ctx.payer] : [])];
  const ledger = buildLedger(matches, rows, knownPayers, { stealthDisperse: [ctx.config.stealthDisperse] });

  // Every matched address joins the guard graph as a stealth singleton (idempotent).
  const graph = loadGraph(ctx.state.read());
  for (const m of matches) graph.addStealth(m.announcement.stealthAddress, { runId: m.announcement.txHash });
  for (const a of [...ctx.config.identifiableAddresses, ...(ctx.payer ? [ctx.payer] : [])]) {
    if (!graph.labelOf(a)) graph.setLabel(a, "main-wallet");
  }
  update(ctx.state, (d) => void (d.guard = graph.toJSON()));

  const holdings: Holding[] = [];
  for (const e of ledger) {
    if (e.balance === null || e.balance === 0n || e.token.toLowerCase() !== usdc.toLowerCase()) continue;
    const a = e.announcements[0];
    if (a) holdings.push({ stealthAddress: e.stealthAddress, balance: e.balance, announcement: a, entry: e });
  }
  return { stats, ledger, holdings, graph };
}

/** Spending key for a holding; derived on demand, never stored or returned. */
export function stealthKeyFor(ctx: Ctx, announcement: AnnouncementRecord): Hex {
  const keys = requireKeys(ctx);
  return deriveStealthKey({ announcement }, { spendingPrivateKey: keys.spendingKey, viewingPrivateKey: keys.viewingKey });
}

export async function scan(ctx: Ctx) {
  const { stats, ledger } = await collect(ctx);
  const total = ledger.reduce((s, e) => s + (e.balance ?? 0n), 0n);
  return {
    scanned: stats.scanned,
    matches: stats.matches,
    totalUsdc: formatUsdc(total),
    payments: ledger.map((e) => ({
      stealthAddress: e.stealthAddress,
      balanceUsdc: e.balance === null ? null : formatUsdc(e.balance),
      payer: e.payer,
      payerKnown: e.payerKnown,
      claimedAmountUsdc: e.claimedAmount === null ? null : formatUsdc(e.claimedAmount),
      flags: e.flags,
      txHash: e.announcements[0]?.txHash ?? null,
      block: e.announcements[0]?.blockNumber ?? null,
    })),
    note: "Amounts are real on-chain balances. `unknown-payer` rows may be spam; the metadata amount is a hint only.",
  };
}

export async function balance(ctx: Ctx) {
  const { holdings, graph } = await collect(ctx);
  const view = balanceView(graph, Object.fromEntries(holdings.map((h) => [getAddress(h.stealthAddress), h.balance])));
  return {
    totalUsdc: formatUsdc(view.total),
    addresses: holdings.length,
    clusters: view.clusters.map((c) => ({
      id: c.id,
      identified: c.identified,
      totalUsdc: formatUsdc(c.total),
      addresses: c.addresses.map((a) => ({ address: a.address, usdc: formatUsdc(a.balance) })),
    })),
    note: "Each cluster is a set of addresses already linked on-chain. Spending from several clusters at once links them.",
  };
}
