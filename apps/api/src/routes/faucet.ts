import { Hono } from "hono";
import { isAddress, type Address } from "viem";
import { getChainConfig } from "@soapay/sdk";
import { jsonBody, type AppDeps } from "../app.js";
import { claimFaucet } from "../faucet.js";
import { ApiError, errorBody } from "../util.js";

/**
 * POST /faucet {address}: the testnet welcome drop (D-52). The company app calls it when a wallet
 * connects; each address gets mock USDC once (and, if FAUCET_ETH_WEI > 0, a small ETH drip). A
 * repeat call answers `already_claimed` and the app shows nothing. 503 `faucet_disabled` off
 * testnet, when FAUCET_ENABLED=false, or without the relayer key.
 */
export function faucetRoutes(deps: AppDeps): Hono {
  const r = new Hono();
  r.post("/faucet", async (c) => {
    const { config } = deps;
    if (!config.faucet.enabled || !deps.faucetWallet) {
      return c.json({ code: "faucet_disabled", ...errorBody("faucet_disabled", "The test-funds drop is off on this server") }, 503);
    }
    const body = await jsonBody(c);
    const address = body.address;
    if (typeof address !== "string" || !isAddress(address, { strict: false })) throw new ApiError(400, "invalid_address", "address must be an address");
    const result = await claimFaucet(
      {
        config,
        db: deps.db,
        logger: deps.logger,
        now: deps.now,
        wallet: deps.faucetWallet,
        payToken: getChainConfig(config.chainId).usdc,
      },
      address as Address,
    );
    return c.json(result);
  });
  return r;
}
