/**
 * LIVE exit on Base Sepolia → Ethereum Sepolia. Skipped unless EXIT_LIVE=1. Spends real testnet USDC.
 *
 *   set -a; source ../../contracts/.env; set +a
 *   EXIT_LIVE=1 EMPLOYER_KEY=$DEPLOYER_PRIVATE_KEY [PAY_AMOUNT=18000000] [EXIT_LIVE_MINUTES=45] \
 *     pnpm --filter @soapay/sdk exec vitest run test/exit.live.test.ts --disable-console-intercept
 *
 * Pays one fresh stealth address through the deployed StealthDisperse, then runs the exit legs
 * (bridge → forwarded mint → deposit → ASP → withdraw to a fresh address). State, including the
 * throwaway recipient mnemonic, is saved to `.exit-live.json` (git-ignored, testnet only) after
 * every step, so re-running resumes where it stopped (the same command finishes a run that timed
 * out waiting for the ASP). Keys are never printed.
 *
 * Funding: the employer needs PAY_AMOUNT USDC on Base Sepolia (default 18) and a little ETH for the
 * approve + pay txs. The preflight refuses anything below the leg minimum (`exitLegMinimum`): ≈ 18.6
 * USDC with EXIT_WITHDRAW=direct, ≈ 81 through the testnet relayer (its fixed ≈ 21.5 USDC fee and the
 * pool's 30% limit). The stealth address never needs ETH.
 *
 * Withdrawal: through the relayer by default. EXIT_WITHDRAW=direct makes the destination wallet send
 * `PrivacyPool.withdraw` itself (D-48): it needs a little Sepolia ETH for gas, and its key is read from
 * `state.destinationKey` in the state file (generated with a fresh destination on first run; never printed).
 */
import { describe, expect, it } from "vitest";
import { createPublicClient, createWalletClient, erc20Abi, getAddress, http, type Address, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { baseSepolia, sepolia } from "viem/chains";
import {
  EXIT_BASE_SEPOLIA_TO_SEPOLIA,
  advanceExitLeg,
  exitLegMinimum,
  createSpendClient,
  derivePayRun,
  deriveStealthKey,
  encodeStealthDisperseCalls,
  fetchAnnouncementsRpc,
  generateMnemonic,
  isExitLegFinal,
  keysFromMnemonic,
  pimlicoFeesPerGas,
  planExit,
  scanAnnouncements,
  type DirectWithdrawSender,
  type ExitContext,
  type ExitLeg,
} from "../src/index.js";
import { env } from "./helpers/fork.js";

const log = (globalThis as unknown as { console: { log: (...a: unknown[]) => void } }).console.log;
const live = env.EXIT_LIVE === "1" && !!env.EMPLOYER_KEY;
const STEALTH_DISPERSE = "0x6B7a1cC570Af2DDd427DA694351438F0FE8039CA" as Address; // docs/testnet-deployment.md
const STATE_FILE = env.EXIT_STATE_FILE ?? ".exit-live.json";
const sleep = (ms: number) => new Promise((r) => (globalThis as unknown as { setTimeout: (f: () => void, ms: number) => void }).setTimeout(() => r(undefined), ms));

type State = { mnemonic: string; payTx?: Hex; payBlock?: string; stealth?: Address; destination?: Address; destinationKey?: Hex; leg?: ExitLeg; log: string[] };

describe.skipIf(!live)("LIVE exit (EXIT_LIVE=1)", () => {
  it("pays a stealth address, bridges, deposits, waits for the ASP, withdraws", async () => {
    const fs = (await import("node:fs" as string)) as { existsSync(p: string): boolean; readFileSync(p: string, e: string): string; writeFileSync(p: string, d: string, o?: object): void };
    const state: State = fs.existsSync(STATE_FILE) ? JSON.parse(fs.readFileSync(STATE_FILE, "utf8")) : { mnemonic: generateMnemonic(), log: [] };
    const save = () => fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), { mode: 0o600 });
    const note = (s: string) => {
      state.log.push(`${new Date().toISOString()} ${s}`);
      log(s);
      save();
    };
    save();
    const keys = keysFromMnemonic(state.mnemonic);
    const cfg = EXIT_BASE_SEPOLIA_TO_SEPOLIA;
    const direct = env.EXIT_WITHDRAW === "direct";
    const baseClient = createPublicClient({ chain: baseSepolia, transport: http(env.BASE_SEPOLIA_RPC_URL ?? "https://sepolia.base.org") });
    const sepClient = createPublicClient({ chain: sepolia, transport: http(env.SEPOLIA_RPC_URL ?? "https://ethereum-sepolia-rpc.publicnode.com") });

    // 1. Pay one fresh stealth address.
    if (!state.payTx) {
      const employer = privateKeyToAccount(env.EMPLOYER_KEY as Hex);
      const amount = BigInt(env.PAY_AMOUNT ?? 18_000_000);
      const { minimum } = exitLegMinimum(cfg, {}, { via: direct ? "direct" : "relayer" });
      if (amount < minimum) throw new Error(`PAY_AMOUNT ${amount} is below the exit leg minimum ${minimum} (pool minimum + CCTP + forward fee + paymaster prefunds)`);
      const bal = await baseClient.readContract({ address: cfg.cctp.source.usdc, abi: erc20Abi, functionName: "balanceOf", args: [employer.address] });
      if (bal < amount) throw new Error(`employer ${employer.address} holds ${bal} USDC on Base Sepolia; needs ${amount} (top up ${amount - bal}; faucet.circle.com gives 10 per request)`);
      const lines = derivePayRun({ recipients: [{ metaAddressURI: keys.metaAddressURI, amount, id: "exit-live" }] });
      const calls = encodeStealthDisperseCalls({ stealthDisperse: STEALTH_DISPERSE, token: cfg.cctp.source.usdc, lines });
      const wallet = createWalletClient({ account: employer, chain: baseSepolia, transport: http(env.BASE_SEPOLIA_RPC_URL ?? "https://sepolia.base.org") });
      const a = await wallet.sendTransaction(calls.approve);
      await baseClient.waitForTransactionReceipt({ hash: a });
      const p = await wallet.sendTransaction(calls.pays[0]!);
      const r = await baseClient.waitForTransactionReceipt({ hash: p });
      expect(r.status).toBe("success");
      state.payTx = p;
      state.payBlock = r.blockNumber.toString();
      note(`pay: https://sepolia.basescan.org/tx/${p}`);
    }

    // 2. Recipient side: find the payment by scanning, recover the stealth key.
    // Public RPCs are load-balanced: the node answering getLogs can lag the one that returned the receipt.
    const announcements = await (async () => {
      for (let i = 0; ; i++) {
        try {
          return await fetchAnnouncementsRpc({ client: baseClient as never, fromBlock: BigInt(state.payBlock!), toBlock: BigInt(state.payBlock!) });
        } catch (e) {
          if (i >= 20 || !/beyond current head|block range/i.test(String(e))) throw e;
          await new Promise((r) => setTimeout(r, 3_000));
        }
      }
    })();
    const [match] = scanAnnouncements(announcements, { spendingPublicKey: keys.spendingPublicKey, viewingPrivateKey: keys.viewingKey });
    expect(match).toBeDefined();
    const stealthKey = deriveStealthKey(match!, { spendingPrivateKey: keys.spendingKey, viewingPrivateKey: keys.viewingKey });
    state.stealth = getAddress(match!.announcement.stealthAddress);
    if (!state.destination) {
      // A fresh destination whose key stays in the 0600 state file, so a direct withdrawal can be sent from it.
      state.destinationKey = generatePrivateKey();
      state.destination = privateKeyToAccount(state.destinationKey).address;
      save();
    }
    if (!state.leg) {
      const amount = await baseClient.readContract({ address: cfg.cctp.source.usdc, abi: erc20Abi, functionName: "balanceOf", args: [state.stealth] });
      const plan = planExit({ sources: [{ stealthAddress: state.stealth, amount }], destination: state.destination, config: cfg, withdrawVia: direct ? "direct" : "relayer" });
      for (const w of plan.warnings) log(`warning: ${w}`);
      if (plan.belowMinimum.length) throw new Error(`stealth ${state.stealth} holds ${amount}, below the leg minimum ${plan.minimum}; not starting the exit`);
      state.leg = plan.legs[0]!;
      note(`planned exit of ${amount} from ${state.stealth} to ${state.destination}`);
    }

    // EXIT_WITHDRAW=direct: the destination wallet sends PrivacyPool.withdraw itself, paying Sepolia ETH gas.
    const directSender = (): DirectWithdrawSender => {
      if (!state.destinationKey) throw new Error("EXIT_WITHDRAW=direct needs state.destinationKey in the state file");
      const account = privateKeyToAccount(state.destinationKey);
      if (account.address.toLowerCase() !== state.destination!.toLowerCase()) throw new Error("state.destinationKey does not match state.destination");
      const wallet = createWalletClient({ account, chain: sepolia, transport: http(env.SEPOLIA_RPC_URL ?? "https://ethereum-sepolia-rpc.publicnode.com") });
      return {
        address: account.address,
        async sendTransaction(t) {
          const eth = await sepClient.getBalance({ address: account.address });
          if (eth === 0n) throw new Error(`insufficient funds: destination ${account.address} holds 0 Sepolia ETH for the withdrawal gas`);
          const hash = await wallet.sendTransaction({ to: t.to, data: t.data, chain: sepolia });
          note(`direct withdraw sent: https://sepolia.etherscan.io/tx/${hash}`);
          return hash;
        },
      };
    };
    const bundler = (id: number) => env[`BUNDLER_URL_${id}`] ?? `https://public.pimlico.io/v2/${id}/rpc`;
    const ctx: ExitContext = {
      // Live demo: withdraw as soon as the ASP approves, in one part.
      config: { ...cfg, withdrawDelayMs: { min: 0, max: 0 } },
      spendClients: {
        [baseSepolia.id]: createSpendClient({ chainId: baseSepolia.id, publicClient: baseClient, bundlerUrl: bundler(baseSepolia.id), estimateFeesPerGas: pimlicoFeesPerGas }),
        [sepolia.id]: createSpendClient({ chainId: sepolia.id, publicClient: sepClient, bundlerUrl: bundler(sepolia.id), estimateFeesPerGas: pimlicoFeesPerGas }),
      },
      stealthKey,
      keys,
      withdrawParts: 1,
      leaveChange: false,
      // Optional per-run fee caps (USDC base units), e.g. when Sepolia gas spikes past the SDK default.
      ...(env.EXIT_MAX_RELAY_FEE_BPS ? { maxRelayFeeBps: BigInt(env.EXIT_MAX_RELAY_FEE_BPS) } : {}),
      ...(env.EXIT_MAX_FEE_L1_USDC ? { maxFeeUsdc: { [sepolia.id]: BigInt(env.EXIT_MAX_FEE_L1_USDC) } } : {}),
      ...(direct ? { withdrawVia: "direct" as const, directWithdraw: directSender() } : {}),
      persist: (l) => {
        state.leg = l;
        save();
      },
    };

    const deadline = Date.now() + Number(env.EXIT_LIVE_MINUTES ?? 45) * 60_000;
    let leg = state.leg!;
    while (!isExitLegFinal(leg) && Date.now() < deadline) {
      const next = await advanceExitLeg(ctx, leg);
      if (next !== leg) {
        state.leg = next;
        note(`${next.status}${next.error ? ` (error: ${next.error})` : ""} txs=${JSON.stringify(next.txs)}`);
      }
      leg = next;
      if (next.status === "failed") break;
      await sleep(next.status === "pending-asp" ? 30_000 : 10_000);
    }
    const links: Record<string, string> = {
      burn: "https://sepolia.basescan.org/tx/",
      mint: "https://sepolia.etherscan.io/tx/",
      deposit: "https://sepolia.etherscan.io/tx/",
      withdraw: "https://sepolia.etherscan.io/tx/",
      refund: "https://sepolia.etherscan.io/tx/",
    };
    for (const [k, h] of Object.entries(leg.txs)) if (h) log(`${k}: ${links[k]}${h}`);
    log("EXIT LIVE STATE", JSON.stringify({ ...state, mnemonic: "<redacted>", ...(state.destinationKey ? { destinationKey: "<redacted>" } : {}) }, null, 2));
    expect(leg.status).not.toBe("failed");
  }, 3_600_000);
});
