import { describe, expect, it } from "vitest";
import { decodeFunctionData, erc20Abi, hexToBytes, numberToHex, type Address, type Hash, type Hex } from "viem";
import { privateKeyToAddress } from "viem/accounts";
import {
  buildMetadata77,
  CHAINS,
  derivePayRun,
  generateMnemonic,
  keysFromMnemonic,
  type AnnouncementRecord,
  type NameResolver,
  type RegisteredChain,
} from "@soapay/sdk";
import { parseCli, UsageError } from "../src/args.js";
import { parseCsv } from "../src/csv.js";
import { run, type CliIo, type PayerChain } from "../src/cli.js";

const USDC_SEPOLIA = CHAINS[84532].usdc;
const PAYER = "0x1111111111111111111111111111111111111111" as Address;

function counterKeys(): () => Uint8Array {
  let n = 0;
  return () => hexToBytes(numberToHex(++n, { size: 32 }));
}

function io(files: Record<string, string>, env: Record<string, string> = {}, extra: Partial<CliIo> = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const cli: CliIo = {
    stdout: (s) => out.push(s),
    stderr: (s) => err.push(s),
    env,
    readFile: async (p) => {
      const f = files[p];
      if (f === undefined) throw new Error(`ENOENT ${p}`);
      return f;
    },
    randomEphemeralKey: counterKeys(),
    ...extra,
  };
  return { cli, out, err };
}

const metas = Array.from({ length: 3 }, () => keysFromMnemonic(generateMnemonic()).metaAddressURI);

describe("argument parsing", () => {
  it("parses distribute with defaults", () => {
    expect(parseCli(["distribute", "--csv", "a.csv", "--asset", "usdc"])).toEqual({
      command: "distribute",
      csv: "a.csv",
      asset: "usdc",
      chainId: 84532,
      preset: "payroll",
      showLines: false,
      json: false,
      execute: false,
      allowMainnet: false,
    });
    const d = parseCli(["distribute", "--csv", "h.csv", "--asset", USDC_SEPOLIA, "--chain", "8453", "--preset", "dividend", "--total", "1000", "--chunk", "50", "--max-lines", "100", "--dry-run"]);
    expect(d).toMatchObject({ chainId: 8453, preset: "dividend", total: "1000", chunk: "50", maxLines: 100, execute: false });
  });

  it("rejects bad distribute flags", () => {
    const bad: string[][] = [
      ["distribute", "--asset", "usdc"],
      ["distribute", "--csv", "a.csv"],
      ["distribute", "--csv", "a.csv", "--asset", "usdc", "--preset", "dividend"],
      ["distribute", "--csv", "a.csv", "--asset", "usdc", "--preset", "vesting"],
      ["distribute", "--csv", "a.csv", "--asset", "usdc", "--total", "5"],
      ["distribute", "--csv", "a.csv", "--asset", "usdc", "--execute", "--dry-run"],
      ["distribute", "--csv", "a.csv", "--asset", "usdc", "--chain", "abc"],
      ["distribute", "--csv", "a.csv", "--asset", "usdc", "--disperse", "0x12"],
      ["distribute", "--csv", "a.csv", "--asset", "usdc", "--bogus"],
      ["frobnicate"],
    ];
    for (const argv of bad) expect(() => parseCli(argv), argv.join(" ")).toThrow(UsageError);
  });

  it("parses scan and refuses a phrase passed as a flag value", () => {
    expect(parseCli(["scan", "--mnemonic-env", "SOAPAY_PHRASE", "--from", "10", "--to", "20", "--no-balances"])).toEqual({
      command: "scan",
      mnemonicEnv: "SOAPAY_PHRASE",
      chainId: 84532,
      fromBlock: 10n,
      toBlock: 20n,
      balances: false,
      json: false,
    });
    expect(() => parseCli(["scan"])).toThrow(/mnemonic-env/);
    expect(() => parseCli(["scan", "--mnemonic-env", "test test junk"])).toThrow(/variable name/);
    expect(() => parseCli(["scan", "--mnemonic-env", "X", "--from", "20", "--to", "10"])).toThrow(/--to/);
    expect(parseCli(["scan", "--mnemonic-env", "X", "--known-payer", PAYER, "--known-payer", PAYER.toLowerCase()])).toMatchObject({ knownPayers: [PAYER, PAYER] });
    expect(() => parseCli(["scan", "--mnemonic-env", "X", "--known-payer", "0x12"])).toThrow(/--known-payer/);
  });
});

describe("csv", () => {
  it("reads headers, quotes and comments", () => {
    const rows = parseCsv('# payees\nRecipient,Amount,id\n"st:eth:0xab",1.5,"a, b"\n\n', ["recipient", "amount"]);
    expect(rows).toEqual([{ line: 3, values: { recipient: "st:eth:0xab", amount: "1.5", id: "a, b" } }]);
    expect(() => parseCsv("recipient\nx", ["recipient", "amount"])).toThrow(/amount/);
    expect(() => parseCsv("recipient,amount\nx", ["recipient", "amount"])).toThrow(/columns/);
  });
});

describe("soapay distribute (dry run)", () => {
  it("prints the plan: lines, chunks, gas, and sends nothing", async () => {
    const csv = `recipient,amount,id\n${metas[0]},1000.5,alice\n${metas[1]},250,bob\n${metas[2]},0.000001,carol\n`;
    const { cli, out } = io({ "pay.csv": csv });
    expect(await run(["distribute", "--csv", "pay.csv", "--asset", "usdc", "--show-lines"], cli)).toBe(0);
    const text = out.join("\n");
    expect(text).toContain("Soapay payroll plan (dry run)");
    expect(text).toContain("chain       Base Sepolia (84532)");
    expect(text).toContain(`asset       USDC ${USDC_SEPOLIA} (6 decimals)`);
    expect(text).toMatch(/recipients {2}3/);
    expect(text).toMatch(/lines {7}3/);
    expect(text).toContain("total       1250.500001 USDC");
    expect(text).toContain("txs         1 (lines per tx: 3; max 350)");
    expect(text).toContain("gas         126000 total");
    expect(text).toContain("StealthDisperse 0x6B7a1cC570Af2DDd427DA694351438F0FE8039CA");
    expect(text).toMatch(/warning: Only 3 recipient/);
    expect(text).toMatch(/alice/);
    expect(text).toContain("Nothing sent.");
  });

  it("dividend preset splits the total pro rata, with denominations, as JSON", async () => {
    const csv = `recipient,holdings\n${metas[0]},1\n${metas[1]},1\n${metas[2]},1\n`;
    const { cli, out } = io({ "h.csv": csv });
    const code = await run(["distribute", "--csv", "h.csv", "--asset", "usdc", "--preset", "dividend", "--total", "1000", "--chunk", "100", "--max-lines", "5", "--json"], cli);
    expect(code).toBe(0);
    const plan = JSON.parse(out.join("\n"));
    expect(plan.kind).toBe("dividend");
    expect(plan.total).toBe("1000000000");
    // 333.333334 + 333.333333 + 333.333333 → 4 lines each (3 × 100 + remainder).
    expect(plan.lines).toHaveLength(12);
    expect(plan.txs.map((t: { lines: number }) => t.lines)).toEqual([4, 4, 4]);
    const byRecipient = new Map<string, bigint>();
    for (const l of plan.lines) byRecipient.set(l.recipientId, (byRecipient.get(l.recipientId) ?? 0n) + BigInt(l.amount));
    expect([...byRecipient.values()].sort()).toEqual([333333333n, 333333333n, 333333334n].sort());
  });

  it("reports usage errors with exit code 2 and unsupported inputs clearly", async () => {
    const { cli, err } = io({ "pay.csv": `recipient,amount\n${metas[0]},1.0000001\n` });
    expect(await run(["distribute", "--csv", "pay.csv", "--asset", "usdc"], cli)).toBe(2);
    expect(err.join()).toMatch(/more than 6 decimals/);

    const dup = io({ "pay.csv": `recipient,amount\n${metas[0]},1\n${metas[0]},2\n` });
    expect(await run(["distribute", "--csv", "pay.csv", "--asset", "usdc"], dup.cli)).toBe(2);
    expect(dup.err.join()).toMatch(/same recipient/);

    const chain = io({ "pay.csv": `recipient,amount\n${metas[0]},1\n` });
    expect(await run(["distribute", "--csv", "pay.csv", "--asset", "usdc", "--chain", "1"], chain.cli)).toBe(1);
    expect(chain.err.join()).toMatch(/chain 1 is not registered/);

    const exec = io({ "pay.csv": `recipient,amount\n${metas[0]},1\n` });
    expect(await run(["distribute", "--csv", "pay.csv", "--asset", "usdc", "--execute"], exec.cli)).toBe(2);
    expect(exec.err.join()).toMatch(/PAYER_PRIVATE_KEY/);
  });
});

describe("soapay scan", () => {
  it("finds payments to the phrase's keys from an announcement source", async () => {
    const phrase = generateMnemonic();
    const keys = keysFromMnemonic(phrase);
    const lines = derivePayRun({
      recipients: [
        { metaAddressURI: keys.metaAddressURI, amount: 5_000_000n },
        { metaAddressURI: metas[0]!, amount: 7_000_000n },
      ],
    });
    const announcements: AnnouncementRecord[] = lines.map((l, i) => ({
      blockNumber: 100n,
      txHash: `0x${"cd".repeat(32)}`,
      logIndex: i,
      stealthAddress: l.stealthAddress,
      caller: PAYER,
      ephemeralPubKey: l.ephemeralPublicKey,
      metadata: buildMetadata77({ viewTag: l.viewTag, token: USDC_SEPOLIA, amount: l.amount, payer: PAYER }),
    }));
    const { cli, out } = io({}, { MY_PHRASE: phrase }, { announcementSource: { name: "fixture", fetch: async () => announcements } });
    expect(await run(["scan", "--mnemonic-env", "MY_PHRASE", "--no-balances"], cli)).toBe(0);
    const text = out.join("\n");
    expect(text).toContain("Scanned 2 announcement(s) on Base Sepolia (84532): 1 payment(s) to you.");
    expect(text).toContain("claims 5 USDC (unverified)");

    const missing = io({}, {});
    expect(await run(["scan", "--mnemonic-env", "NOPE", "--no-balances"], missing.cli)).toBe(2);
    expect(missing.err.join()).toMatch(/NOPE is not set/);
  });
});

describe("soapay distribute --execute", () => {
  const KEY = `0x${"42".repeat(32)}` as Hex;
  const DISPERSE = "0x6B7a1cC570Af2DDd427DA694351438F0FE8039CA" as Address;

  type Sent = { to: Address; data: Hex };
  function fakePayer(opts: { usdc?: bigint; eth?: bigint; allowanceLag?: number } = {}) {
    const sent: Sent[] = [];
    const events: string[] = [];
    let allowance = 0n;
    let lag = opts.allowanceLag ?? 0;
    let built = 0;
    const factory = (key: Hex, _chain: RegisteredChain, rpc: string): PayerChain => {
      built++;
      expect(key).toBe(KEY);
      expect(rpc).toMatch(/^https:\/\//);
      return {
        payer: privateKeyToAddress(key),
        tokenBalance: async () => opts.usdc ?? 10_000_000n,
        ethBalance: async () => opts.eth ?? 10n ** 16n,
        allowance: async () => {
          events.push("allowance");
          if (lag > 0) {
            lag--;
            return 0n;
          }
          return allowance;
        },
        sendTransaction: async (tx) => {
          sent.push(tx);
          events.push(tx.to === USDC_SEPOLIA ? "approve" : "pay");
          if (tx.to === USDC_SEPOLIA) {
            const d = decodeFunctionData({ abi: erc20Abi, data: tx.data });
            allowance = (d.args as readonly [Address, bigint])[1];
          }
          return `0x${sent.length.toString(16).padStart(64, "0")}` as Hash;
        },
        waitForTransactionReceipt: async () => ({ status: "success" }),
      };
    };
    return { factory, sent, events, built: () => built };
  }

  const dividendCsv = `recipient,holdings,id\n${metas[0]},500,ana\n${metas[1]},300,ben\n${metas[2]},200,cleo\n`;
  const argv = ["distribute", "--csv", "h.csv", "--asset", "usdc", "--preset", "dividend", "--total", "1", "--chunk", "0.1", "--execute"];

  it("prints a preflight, approves the exact total to StealthDisperse, then pays, with explorer links", async () => {
    const payer = fakePayer({ allowanceLag: 2 });
    const { cli, out, err } = io({ "h.csv": dividendCsv }, { PAYER_PRIVATE_KEY: KEY }, { payerChain: payer.factory, pollMs: 0 });
    expect(await run(argv, cli)).toBe(0);
    const text = out.join("\n");

    expect(text).toContain("Soapay dividend plan\n");
    expect(text).toContain("recipients  3 (3 meta-addresses)");
    expect(text).toContain(`payer       ${privateKeyToAddress(KEY)}`);
    expect(text).toContain("holds       10 USDC, 0.01 ETH for gas");
    expect(text).toContain("sends       1 USDC in 10 lines to 3 recipients");
    expect(text).toContain("txs         2: 1 approval (exact total, to StealthDisperse) + 1 pay (10 lines)");
    expect(text).toContain(`approve     https://sepolia.basescan.org/tx/0x${"1".padStart(64, "0")}`);
    expect(text).toContain(`pay 1/1     https://sepolia.basescan.org/tx/0x${"2".padStart(64, "0")}`);
    expect(text).toContain("Done: 1 USDC to 3 recipients on 10 fresh stealth addresses");
    expect(text).not.toContain("Nothing sent");

    // Approval for the exact total (never max), to the StealthDisperse spender.
    const [approve, pay] = payer.sent as [Sent, Sent];
    expect(payer.sent).toHaveLength(2);
    expect(decodeFunctionData({ abi: erc20Abi, data: approve.data })).toEqual({ functionName: "approve", args: [DISPERSE, 1_000_000n] });
    expect(pay.to).toBe(DISPERSE);
    // The first pay waits until the approval is visible (the RPC-lag fix).
    expect(payer.events).toEqual(["approve", "allowance", "allowance", "allowance", "pay"]);

    // The key is read from the environment and never echoed.
    expect([...out, ...err].join("\n")).not.toContain(KEY.slice(2));
  });

  it("sends nothing when the payer is short on the token or on gas", async () => {
    for (const [opts, msg] of [
      [{ usdc: 999_999n }, /holds 0.999999 USDC; the plan needs 1 USDC. Nothing was sent/],
      [{ eth: 0n }, /no ETH for gas on Base Sepolia. Nothing was sent/],
    ] as const) {
      const payer = fakePayer(opts);
      const { cli, err } = io({ "h.csv": dividendCsv }, { PAYER_PRIVATE_KEY: KEY }, { payerChain: payer.factory });
      expect(await run(argv, cli)).toBe(2);
      expect(err.join()).toMatch(msg);
      expect(payer.sent).toHaveLength(0);
    }
  });

  it("refuses a non-testnet chain without --allow-mainnet, before touching the key", async () => {
    const payer = fakePayer();
    const { cli, err } = io({ "h.csv": dividendCsv }, { PAYER_PRIVATE_KEY: KEY }, { payerChain: payer.factory });
    expect(await run([...argv, "--chain", "8453"], cli)).toBe(2);
    expect(err.join()).toMatch(/Base is not a testnet; --execute there also needs --allow-mainnet/);
    expect(payer.built()).toBe(0);
    expect(() => parseCli(["distribute", "--csv", "a", "--asset", "usdc", "--allow-mainnet"])).toThrow(/only applies with --execute/);
  });

  it("keeps stdout machine-readable with --json and reports names checked against ERC-6538", async () => {
    const payer = fakePayer();
    const resolver: NameResolver = {
      name: "fixture-ens",
      canResolve: () => true,
      resolve: async (id) => ({ metaAddressURI: metas[Number(id.slice(1, 2))]!, source: "ens" }),
    };
    const csv = `recipient,holdings\na0.soapay.eth,1\na1.soapay.eth,1\na2.soapay.eth,2\n`;
    const { cli, out, err } = io({ "h.csv": csv }, { PAYER_PRIVATE_KEY: KEY }, { payerChain: payer.factory, resolver, pollMs: 0 });
    expect(await run([...argv, "--json"], cli)).toBe(0);
    const [plan, result] = out.map((s) => JSON.parse(s));
    expect(plan.resolvedBy).toEqual({ ens: 3 });
    expect(result.links).toHaveLength(2);
    expect(result.links[1]).toMatch(/^https:\/\/sepolia\.basescan\.org\/tx\/0x/);
    expect(err.join("\n")).toContain("Preflight");

    const dry = io({ "h.csv": csv }, {}, { resolver });
    expect(await run(["distribute", "--csv", "h.csv", "--asset", "usdc", "--preset", "dividend", "--total", "1"], dry.cli)).toBe(0);
    expect(dry.out.join("\n")).toContain("recipients  3 (3 names checked against ERC-6538)");
  });
});
