// `soapay scan`: recovery phrase (from an env var) → announcements → matches → real balances.
import { formatUnits, type Address } from "viem";
import {
  buildLedger,
  scanAnnouncementsWithStats,
  verifyBalances,
  type AnnouncementRecord,
  type LedgerEntry,
  type MulticallClient,
  type RegisteredChain,
  type ScanMatch,
  type SoapayKeys,
} from "@soapay/sdk";

export type ScanResult = {
  scanned: number;
  matches: ScanMatch[];
  /** Present when balances were read. */
  ledger?: LedgerEntry[];
};

export async function scanPayments(params: {
  keys: Pick<SoapayKeys, "spendingPublicKey" | "viewingKey">;
  announcements: readonly AnnouncementRecord[];
  chain: RegisteredChain;
  balancesClient?: MulticallClient;
}): Promise<ScanResult> {
  const { matches, stats } = scanAnnouncementsWithStats(params.announcements, {
    spendingPublicKey: params.keys.spendingPublicKey,
    viewingPrivateKey: params.keys.viewingKey,
  });
  if (!params.balancesClient || matches.length === 0) return { scanned: stats.scanned, matches };

  // Real balances for every registered ERC-20 plus any token the (untrusted) metadata names.
  const tokens = new Set<Address>();
  for (const a of Object.values(params.chain.assets)) if (a.kind === "erc20") tokens.add(a.address);
  for (const m of matches) if (m.hints) tokens.add(m.hints.token);
  const balances = await verifyBalances({ client: params.balancesClient, matches, tokens: [...tokens] });
  const ledger = buildLedger(
    matches,
    balances.filter((b) => b.balance !== 0n),
    [],
    { stealthDisperse: params.chain.stealthDisperse ? [params.chain.stealthDisperse] : [] },
  );
  return { scanned: stats.scanned, matches, ledger };
}

function decimalsFor(chain: RegisteredChain, token: Address): { decimals?: number; symbol: string } {
  const a = Object.values(chain.assets).find((x) => x.kind === "erc20" && x.address.toLowerCase() === token.toLowerCase());
  const out: { decimals?: number; symbol: string } = { symbol: a?.symbol ?? token };
  if (a && "decimals" in a && a.decimals !== undefined) out.decimals = a.decimals;
  return out;
}

function fmt(chain: RegisteredChain, token: Address, v: bigint | null): string {
  if (v === null) return "unknown";
  const { decimals, symbol } = decimalsFor(chain, token);
  return decimals === undefined ? `${v} (base units of ${symbol})` : `${formatUnits(v, decimals)} ${symbol}`;
}

export function formatScan(r: ScanResult, chain: RegisteredChain): string {
  const out = [`Scanned ${r.scanned} announcement(s) on ${chain.chain.name} (${chain.id}): ${r.matches.length} payment(s) to you.`];
  if (r.ledger) {
    if (r.ledger.length === 0 && r.matches.length > 0) out.push("All matched addresses are empty (already spent).");
    for (const e of r.ledger) {
      out.push(
        `  ${e.stealthAddress}  balance ${fmt(chain, e.token, e.balance)}  payer ${e.payer ?? "unknown"}${e.flags.length ? `  [${e.flags.join(", ")}]` : ""}`,
      );
    }
    return out.join("\n");
  }
  for (const m of r.matches) {
    const a = m.announcement;
    const hint = m.hints ? `claims ${fmt(chain, m.hints.token, m.hints.amount)} (unverified)` : "no metadata";
    out.push(`  ${a.stealthAddress}  ${hint}  block ${a.blockNumber}  tx ${a.txHash}`);
  }
  return out.join("\n");
}

export function scanJson(r: ScanResult) {
  return {
    scanned: r.scanned,
    matches: r.matches.map((m) => ({
      stealthAddress: m.announcement.stealthAddress,
      blockNumber: m.announcement.blockNumber.toString(),
      txHash: m.announcement.txHash,
      caller: m.announcement.caller,
      hint: m.hints ? { token: m.hints.token, amount: m.hints.amount.toString(), payer: m.hints.payer ?? null } : null,
    })),
    ledger:
      r.ledger?.map((e) => ({
        stealthAddress: e.stealthAddress,
        token: e.token,
        balance: e.balance === null ? null : e.balance.toString(),
        payer: e.payer,
        flags: e.flags,
      })) ?? null,
  };
}
