// Live USDC balances of paid stealth wallets (CK's per-wallet view). Read-only; the result is
// shown next to the record, never used to pay.
import { useQuery } from "@tanstack/react-query";
import { useConfig } from "wagmi";
import { readContract } from "wagmi/actions";
import { erc20Abi, type Address } from "viem";
import type { RunRecord } from "../lib/run.js";
import { useStore } from "./store.js";

/** address (lowercase) → balance; null = the read failed; missing = still loading. */
export type BalanceMap = ReadonlyMap<string, bigint | null>;

export function useWalletBalances(addresses: readonly Address[]): { balances: BalanceMap; loading: boolean; refresh(): void } {
  const { app, runs } = useStore();
  const config = useConfig();
  const key = [...new Set(addresses.map((a) => a.toLowerCase()))].sort();
  const q = useQuery({
    queryKey: ["wallet-balances", app.chainId, app.usdc, key],
    // Demo: nothing on-chain; a wallet's balance is what the records say landed in it.
    enabled: key.length > 0 && !app.demo,
    staleTime: 15_000,
    queryFn: async () => {
      const out = new Map<string, bigint | null>();
      await Promise.all(
        key.map(async (a) => {
          const b = await readContract(config, {
            chainId: app.chainId,
            address: app.usdc,
            abi: erc20Abi,
            functionName: "balanceOf",
            args: [a as Address],
          }).catch(() => null);
          out.set(a, b);
        }),
      );
      return out as BalanceMap;
    },
  });
  if (app.demo) return { balances: demoLandedBalances(runs, key), loading: false, refresh: () => undefined };
  return { balances: q.data ?? new Map(), loading: q.isLoading, refresh: () => void q.refetch() };
}

/** Demo: sum of the landed lines into each address, across every run. Pure. */
export function demoLandedBalances(runs: readonly RunRecord[], lowercased: readonly string[]): BalanceMap {
  const out = new Map<string, bigint | null>(lowercased.map((a) => [a, 0n]));
  for (const r of runs) {
    for (const a of r.attempts) {
      for (const c of a.chunks) {
        if (c.status !== "landed") continue;
        for (const l of c.lines) {
          const k = l.stealthAddress.toLowerCase();
          if (out.has(k)) out.set(k, (out.get(k) ?? 0n) + l.amount);
        }
      }
    }
  }
  return out;
}
