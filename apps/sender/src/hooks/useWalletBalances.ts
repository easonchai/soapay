// Live USDC balances of paid stealth wallets (CK's per-wallet view). Read-only; the result is
// shown next to the record, never used to pay.
import { useQuery } from "@tanstack/react-query";
import { useConfig } from "wagmi";
import { readContract } from "wagmi/actions";
import { erc20Abi, type Address } from "viem";
import { useStore } from "./store.js";

/** address (lowercase) → balance; null = the read failed; missing = still loading. */
export type BalanceMap = ReadonlyMap<string, bigint | null>;

export function useWalletBalances(addresses: readonly Address[]): { balances: BalanceMap; loading: boolean; refresh(): void } {
  const { app } = useStore();
  const config = useConfig();
  const key = [...new Set(addresses.map((a) => a.toLowerCase()))].sort();
  const q = useQuery({
    queryKey: ["wallet-balances", app.chainId, app.usdc, key],
    enabled: key.length > 0,
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
  return { balances: q.data ?? new Map(), loading: q.isLoading, refresh: () => void q.refetch() };
}
