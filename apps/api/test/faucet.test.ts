import { describe, expect, it, vi } from "vitest";
import { getAddress, type Address, type Hash } from "viem";
import { MOCK_USDC_BASE_SEPOLIA } from "@soapay/sdk";
import type { FaucetWallet } from "../src/faucet.js";
import { j, makeTestApp, NOW } from "./helpers.js";

const RELAYER = "0x509aD63D73f41FA9DD7162F7FcD3876090C8157F" as Address;
const WALLET = "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd" as Address;
const hash = (n: number) => `0x${n.toString(16).padStart(64, "0")}` as Hash;

function fakeWallet(opts: { balances?: Record<string, bigint>; mintFails?: boolean; reverted?: boolean } = {}) {
  let n = 0;
  const balances = Object.fromEntries(Object.entries(opts.balances ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
  const w = {
    address: RELAYER,
    getBalance: vi.fn(async ({ address }: { address: Address }) => balances[address.toLowerCase()] ?? 0n),
    mint: vi.fn(async (_a: { token: Address; to: Address; amount: bigint }) => {
      if (opts.mintFails) throw new Error("nonce too low");
      return hash(++n);
    }),
    sendEth: vi.fn(async (_a: { to: Address; value: bigint }) => hash(1000 + ++n)),
    waitForReceipt: vi.fn(async (_h: Hash) => ({ status: opts.reverted ? ("reverted" as const) : ("success" as const) })),
  };
  return w satisfies FaucetWallet;
}

const claim = (t: ReturnType<typeof makeTestApp>, address: string = WALLET) => t.post("/faucet", { address });

describe("POST /faucet (testnet welcome drop)", () => {
  it("mints 1,000,000 mock USDC once per address; the repeat is already_claimed", async () => {
    const w = fakeWallet();
    const t = makeTestApp({ faucetWallet: w });
    const res = await claim(t);
    expect(res.status).toBe(200);
    const body = await j(res);
    expect(body).toMatchObject({ status: "sent", address: getAddress(WALLET), usdc: { amount: "1000000000000", txHash: hash(1) }, eth: null, ethSkipped: "disabled" });
    expect(w.mint).toHaveBeenCalledWith({ token: getAddress(MOCK_USDC_BASE_SEPOLIA), to: getAddress(WALLET), amount: 1_000_000_000_000n });
    expect(w.sendEth).not.toHaveBeenCalled(); // FAUCET_ETH_WEI defaults to 0 (owner decision pending)

    const again = await claim(t, WALLET.toUpperCase().replace("0X", "0x"));
    expect(await j(again)).toEqual({ status: "already_claimed", address: getAddress(WALLET) });
    expect(w.mint).toHaveBeenCalledTimes(1);
    const row = t.db.prepare("SELECT status, usdc_tx FROM faucet_claims WHERE address = ?").get(getAddress(WALLET)) as { status: string; usdc_tx: string };
    expect(row).toEqual({ status: "sent", usdc_tx: hash(1) });
  });

  it("drips ETH up to FAUCET_ETH_WEI only when the wallet is below it and the relayer is above its floor", async () => {
    const env = { FAUCET_ETH_WEI: "500000000000000" };
    // Wallet holds 0.0001 ETH: topped up by 0.0004.
    const w = fakeWallet({ balances: { [WALLET]: 100_000_000_000_000n, [RELAYER]: 100_000_000_000_000_000n } });
    const t = makeTestApp({ env, faucetWallet: w });
    const body = await j(await claim(t));
    expect(body.eth).toEqual({ amount: "400000000000000", txHash: expect.any(String) });
    expect(w.sendEth).toHaveBeenCalledWith({ to: getAddress(WALLET), value: 400_000_000_000_000n });

    // Wallet already holds enough.
    const rich = "0x1111111111111111111111111111111111111111";
    const w2 = fakeWallet({ balances: { [rich]: 1_000_000_000_000_000n, [RELAYER]: 100_000_000_000_000_000n } });
    const t2 = makeTestApp({ env, faucetWallet: w2 });
    expect(await j(await claim(t2, rich))).toMatchObject({ status: "sent", eth: null, ethSkipped: "sufficient_balance" });
    expect(w2.sendEth).not.toHaveBeenCalled();

    // Relayer below 0.02 ETH + the drip: USDC still goes out, ETH does not.
    const w3 = fakeWallet({ balances: { [RELAYER]: 20_000_000_000_000_000n } });
    const t3 = makeTestApp({ env, faucetWallet: w3 });
    expect(await j(await claim(t3))).toMatchObject({ status: "sent", eth: null, ethSkipped: "relayer_low" });
    expect(w3.mint).toHaveBeenCalledTimes(1);
    expect(w3.sendEth).not.toHaveBeenCalled();
  });

  it("caps new claims per day across all IPs, and per IP", async () => {
    const t = makeTestApp({ env: { FAUCET_PER_DAY: "2", FAUCET_PER_IP_PER_DAY: "10" }, faucetWallet: fakeWallet() });
    const addr = (i: number) => `0x${i.toString(16).padStart(40, "0")}`;
    expect((await claim(t, addr(1))).status).toBe(200);
    t.setIp("10.0.0.9");
    expect((await claim(t, addr(2))).status).toBe(200);
    const capped = await claim(t, addr(3));
    expect(capped.status).toBe(429);
    expect(await j(capped)).toMatchObject({ error: { code: "faucet_daily_cap" } });
    // Already-claimed callers are answered even at the cap (the app calls on every connect).
    expect(await j(await claim(t, addr(1)))).toMatchObject({ status: "already_claimed" });
    // The next UTC day opens again.
    t.setNow(NOW + 86_400);
    expect((await claim(t, addr(3))).status).toBe(200);

    const p = makeTestApp({ env: { FAUCET_PER_IP_PER_DAY: "1" }, faucetWallet: fakeWallet() });
    expect((await claim(p, addr(1))).status).toBe(200);
    expect((await claim(p, addr(2))).status).toBe(429);
  });

  it("forgets a failed drop so the wallet can try again", async () => {
    const t = makeTestApp({ faucetWallet: fakeWallet({ mintFails: true }) });
    const res = await claim(t);
    expect(res.status).toBe(502);
    expect(await j(res)).toMatchObject({ error: { code: "faucet_failed" } });
    expect(t.db.prepare("SELECT COUNT(*) AS n FROM faucet_claims").get()).toEqual({ n: 0 });

    const r = makeTestApp({ faucetWallet: fakeWallet({ reverted: true }) });
    expect((await claim(r)).status).toBe(502);
  });

  it("is 503 faucet_disabled off testnet, when disabled, or without the relayer", async () => {
    expect((await claim(makeTestApp({ env: { CHAIN_ID: "8453" }, faucetWallet: fakeWallet() }))).status).toBe(503);
    expect((await claim(makeTestApp({ env: { FAUCET_ENABLED: "false" }, faucetWallet: fakeWallet() }))).status).toBe(503);
    const none = await claim(makeTestApp());
    expect(none.status).toBe(503);
    expect(await j(none)).toMatchObject({ code: "faucet_disabled" });
  });

  it("rejects a bad address", async () => {
    const t = makeTestApp({ faucetWallet: fakeWallet() });
    expect((await claim(t, "not-an-address")).status).toBe(400);
  });
});
