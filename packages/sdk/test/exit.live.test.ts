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
 * Funding: the employer needs PAY_AMOUNT USDC on Base Sepolia (default 18, at least the leg minimum
 * from `exitLegMinimum`, ≈ 16.4) and a little ETH for the approve + pay txs. The stealth address and
 * the destination never need ETH. The preflight refuses to send anything below the minimum.
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
  type ExitContext,
  type ExitLeg,
} from "../src/index.js";
import { env } from "./helpers/fork.js";

const log = (globalThis as unknown as { console: { log: (...a: unknown[]) => void } }).console.log;
const live = env.EXIT_LIVE === "1" && !!env.EMPLOYER_KEY;
const STEALTH_DISPERSE = "0x6B7a1cC570Af2DDd427DA694351438F0FE8039CA" as Address; // docs/testnet-deployment.md
const STATE_FILE = env.EXIT_STATE_FILE ?? ".exit-live.json";
const sleep = (ms: number) => new Promise((r) => (globalThis as unknown as { setTimeout: (f: () => void, ms: number) => void }).setTimeout(() => r(undefined), ms));

type State = { mnemonic: string; payTx?: Hex; payBlock?: string; stealth?: Address; destination?: Address; leg?: ExitLeg; log: string[] };

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
    const baseClient = createPublicClient({ chain: baseSepolia, transport: http(env.BASE_SEPOLIA_RPC_URL ?? "https://sepolia.base.org") });
    const sepClient = createPublicClient({ chain: sepolia, transport: http(env.SEPOLIA_RPC_URL ?? "https://ethereum-sepolia-rpc.publicnode.com") });

    // 1. Pay one fresh stealth address.
    if (!state.payTx) {
      const employer = privateKeyToAccount(env.EMPLOYER_KEY as Hex);
      const amount = BigInt(env.PAY_AMOUNT ?? 18_000_000);
      const { minimum } = exitLegMinimum(cfg);
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
    const announcements = await fetchAnnouncementsRpc({ client: baseClient as never, fromBlock: BigInt(state.payBlock!), toBlock: BigInt(state.payBlock!) });
    const [match] = scanAnnouncements(announcements, { spendingPublicKey: keys.spendingPublicKey, viewingPrivateKey: keys.viewingKey });
    expect(match).toBeDefined();
    const stealthKey = deriveStealthKey(match!, { spendingPrivateKey: keys.spendingKey, viewingPrivateKey: keys.viewingKey });
    state.stealth = getAddress(match!.announcement.stealthAddress);
    state.destination ??= privateKeyToAccount(generatePrivateKey()).address;
    if (!state.leg) {
      const amount = await baseClient.readContract({ address: cfg.cctp.source.usdc, abi: erc20Abi, functionName: "balanceOf", args: [state.stealth] });
      const plan = planExit({ sources: [{ stealthAddress: state.stealth, amount }], destination: state.destination, config: cfg });
      for (const w of plan.warnings) log(`warning: ${w}`);
      if (plan.belowMinimum.length) throw new Error(`stealth ${state.stealth} holds ${amount}, below the leg minimum ${plan.minimum}; not starting the exit`);
      state.leg = plan.legs[0]!;
      note(`planned exit of ${amount} from ${state.stealth} to ${state.destination}`);
    }

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
    log("EXIT LIVE STATE", JSON.stringify({ ...state, mnemonic: "<redacted>" }, null, 2));
    expect(leg.status).not.toBe("failed");
  }, 3_600_000);
});
