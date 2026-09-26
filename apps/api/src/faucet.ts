import { getAddress, parseAbi, type Address, type Hash } from "viem";
import type { Config } from "./config.js";
import type { Db } from "./db.js";
import { ApiError, enforceRateLimits, type Logger } from "./util.js";

/** MockUSDC.mint (contracts/src/MockUSDC.sol): MINTER_ROLE only, held by the relayer key. */
export const mockUsdcMintAbi = parseAbi(["function mint(address to, uint256 amount)"]);

/** The relayer wallet as the faucet sees it (Base Sepolia). */
export type FaucetWallet = {
  address: Address;
  getBalance(args: { address: Address }): Promise<bigint>;
  mint(args: { token: Address; to: Address; amount: bigint }): Promise<Hash>;
  sendEth(args: { to: Address; value: bigint }): Promise<Hash>;
  waitForReceipt(hash: Hash): Promise<{ status: "success" | "reverted" }>;
};

export type FaucetDrop = {
  status: "sent";
  address: Address;
  usdc: { amount: string; txHash: Hash };
  eth: { amount: string; txHash: Hash } | null;
  /** Why no ETH was sent, when none was. */
  ethSkipped?: "sufficient_balance" | "relayer_low" | "disabled";
};
export type FaucetResult = FaucetDrop | { status: "already_claimed"; address: Address };

const DAY = 86_400;

/** One send at a time from the relayer, so concurrent claims never race for a nonce. */
let queue: Promise<unknown> = Promise.resolve();
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const next = queue.then(fn, fn);
  queue = next.catch(() => undefined);
  return next;
}

/**
 * The testnet welcome drop (D-52): once per address, mint `faucet.usdcAmount` mock USDC and, if the
 * wallet holds less than `faucet.ethDripWei`, top it up to that much ETH (skipped while the relayer
 * holds less than `faucet.minRelayerEthWei`). Claims live in sqlite; a failed drop is forgotten so
 * the wallet can try again. Daily global and per-IP caps apply to new claims only.
 */
export async function claimFaucet(
  deps: { config: Config; db: Db; logger: Logger; now: () => number; wallet: FaucetWallet; payToken: Address; ip: string },
  rawAddress: Address,
): Promise<FaucetResult> {
  const { config, db, logger, wallet } = deps;
  const cfg = config.faucet;
  const address = getAddress(rawAddress);
  const now = deps.now();

  const existing = db.prepare("SELECT status FROM faucet_claims WHERE address = ?").get(address) as { status: string } | undefined;
  if (existing) return { status: "already_claimed", address };

  const dayStart = now - (now % DAY);
  const today = (db.prepare("SELECT COUNT(*) AS n FROM faucet_claims WHERE created_at >= ?").get(dayStart) as { n: number }).n;
  if (today >= cfg.perDay) throw new ApiError(429, "faucet_daily_cap", "Today's test-funds drops are used up; try again tomorrow (UTC)");
  enforceRateLimits(db, [{ bucket: "faucet:ip", key: deps.ip, limit: cfg.perIpPerDay }], DAY, now);

  // Reserve the claim first, so a concurrent request for the same address gets already_claimed.
  try {
    db.prepare("INSERT INTO faucet_claims (address, status, usdc_amount, created_at, updated_at) VALUES (?, 'pending', ?, ?, ?)").run(
      address,
      cfg.usdcAmount.toString(),
      now,
      now,
    );
  } catch {
    return { status: "already_claimed", address };
  }

  try {
    const drop = await serial(async (): Promise<FaucetDrop> => {
      const usdcTx = await wallet.mint({ token: deps.payToken, to: address, amount: cfg.usdcAmount });
      const receipt = await wallet.waitForReceipt(usdcTx);
      if (receipt.status !== "success") throw new Error("mint reverted");

      let eth: FaucetDrop["eth"] = null;
      let ethSkipped: FaucetDrop["ethSkipped"];
      if (cfg.ethDripWei === 0n) ethSkipped = "disabled";
      else {
        const [balance, relayerBalance] = await Promise.all([wallet.getBalance({ address }), wallet.getBalance({ address: wallet.address })]);
        if (balance >= cfg.ethDripWei) ethSkipped = "sufficient_balance";
        else if (relayerBalance < cfg.minRelayerEthWei + cfg.ethDripWei) {
          ethSkipped = "relayer_low";
          logger.warn("faucet: relayer ETH below the drip floor", { relayer: wallet.address });
        } else {
          const value = cfg.ethDripWei - balance;
          const ethTx = await wallet.sendEth({ to: address, value });
          eth = { amount: value.toString(), txHash: ethTx };
        }
      }
      return { status: "sent", address, usdc: { amount: cfg.usdcAmount.toString(), txHash: usdcTx }, eth, ...(ethSkipped ? { ethSkipped } : {}) };
    });
    db.prepare("UPDATE faucet_claims SET status = 'sent', usdc_tx = ?, eth_wei = ?, eth_tx = ?, updated_at = ? WHERE address = ?").run(
      drop.usdc.txHash,
      drop.eth?.amount ?? null,
      drop.eth?.txHash ?? null,
      deps.now(),
      address,
    );
    logger.info("faucet: sent", { address, usdcTx: drop.usdc.txHash, ethTx: drop.eth?.txHash ?? null });
    return drop;
  } catch (e) {
    db.prepare("DELETE FROM faucet_claims WHERE address = ?").run(address);
    logger.error("faucet: failed", { address, error: (e as Error).message?.split("\n")[0] });
    throw new ApiError(502, "faucet_failed", "Sending test funds failed; try again shortly");
  }
}
