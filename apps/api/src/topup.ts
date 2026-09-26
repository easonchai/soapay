import type { Address, Hash } from "viem";
import type { Config } from "./config.js";
import type { Db } from "./db.js";
import { hitRateLimit, type Logger } from "./util.js";

/** The slice of a viem wallet+public client on Ethereum Sepolia that the top-up needs. */
export type L1Funder = {
  address: Address;
  getBalance(args: { address: Address }): Promise<bigint>;
  estimateFeesPerGas(): Promise<{ maxFeePerGas?: bigint | undefined; gasPrice?: bigint | undefined }>;
  sendTransaction(args: { to: Address; value: bigint }): Promise<Hash>;
};

export type TopupResult =
  | { status: "sent"; txHash: Hash; value: string }
  | { status: "skipped"; reason: "not_configured" | "sufficient_balance" | "rate_limited" | "disabled" }
  | { status: "failed"; reason: string };

const DAY = 86_400;

/**
 * Sponsors the registrant's Sepolia gas for its own ENSv2 `setText` (docs/mvp-spec.md §2.1).
 * Sends only when the balance is below the need, never more than TOPUP_CAP_WEI, and within
 * per-registrant and global daily limits. Never throws: a failed top-up doesn't undo a rotation.
 */
export async function topUpRegistrant(
  deps: { config: Config; db: Db; logger: Logger; now: () => number; l1Funder: L1Funder | undefined },
  registrant: Address,
): Promise<TopupResult> {
  const { config, db, logger, l1Funder } = deps;
  if (!l1Funder) return { status: "skipped", reason: "not_configured" };
  const { gas, capWei, perRegistrant, perDay } = config.topup;
  if (perDay === 0 || perRegistrant === 0 || capWei === 0n) return { status: "skipped", reason: "disabled" };
  try {
    const fees = await l1Funder.estimateFeesPerGas();
    const price = fees.maxFeePerGas ?? fees.gasPrice ?? 0n;
    const need = gas * price;
    const balance = await l1Funder.getBalance({ address: registrant });
    if (balance >= need) return { status: "skipped", reason: "sufficient_balance" };
    const value = need - balance > capWei ? capWei : need - balance;

    // Check both limits before recording either, so one rejection doesn't burn the other.
    const now = deps.now();
    const peek = (bucket: string, key: string, limit: number) => {
      const row = db.prepare("SELECT window_start, count FROM rate_limits WHERE bucket = ? AND key = ?").get(bucket, key) as
        | { window_start: number; count: number }
        | undefined;
      return !(row && row.window_start === now - (now % DAY) && row.count >= limit);
    };
    if (!peek("topup:registrant", registrant, perRegistrant) || !peek("topup:global", "all", perDay)) {
      logger.warn("topup: rate limited", { registrant });
      return { status: "skipped", reason: "rate_limited" };
    }
    hitRateLimit(db, "topup:registrant", registrant, perRegistrant, DAY, now);
    hitRateLimit(db, "topup:global", "all", perDay, DAY, now);

    const txHash = await l1Funder.sendTransaction({ to: registrant, value });
    logger.info("topup: sent", { registrant, txHash, value: value.toString() });
    return { status: "sent", txHash, value: value.toString() };
  } catch (e) {
    const reason = (e as Error).message?.split("\n")[0] ?? "unknown";
    logger.error("topup: failed", { registrant, error: reason });
    return { status: "failed", reason: "top-up transaction failed" };
  }
}
