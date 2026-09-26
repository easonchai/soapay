import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import {
  ENTRYPOINT_V08,
  SIMPLE_7702_ACCOUNT,
  fetchPayRunBatch,
  gaslessProofFromReads,
  generateMnemonic,
  getChainConfig,
  keysFromMnemonic,
  markOwnLines,
  planSpend,
  ClusterGraph,
  deriveStealthKey,
  readGaslessProof,
  scanAnnouncements,
  type AnnouncementRecord,
  type LedgerEntry,
  type PayRunBatch,
} from "@soapay/sdk";
import { getAddress, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { lastSpendTx, payRunGroups } from "../src/hooks/useChainViews.js";
import { BatchTable } from "../src/screens/PayRunViews.js";
import { GaslessProofView, proofHeadline, proofRows } from "../src/screens/GaslessProof.js";
import { GuardDecision, linkTxHashes } from "../src/screens/GuardDecision.js";
import { MOCK_EMPLOYER, createMockFetch, createMockPublicClient, createMockSpendService, setMockIdentity } from "../src/services/mock.js";

const CHAIN = 84532;
const UNIT = 1_000_000n;
const TX_A: Hex = `0x${"aa".repeat(32)}`;
const TX_B: Hex = `0x${"bb".repeat(32)}`;
const addr = (n: number) => getAddress(`0x${n.toString(16).padStart(40, "0")}`);

function ann(stealth: Address, txHash: Hex, block: bigint, logIndex: number): AnnouncementRecord {
  return { blockNumber: block, txHash, logIndex, stealthAddress: stealth, caller: addr(0xd15), ephemeralPubKey: "0x", metadata: "0x" };
}
function entry(stealth: Address, anns: AnnouncementRecord[]): LedgerEntry {
  return { stealthAddress: stealth, token: addr(1), balance: 500n * UNIT, payer: MOCK_EMPLOYER, payerKnown: true, claimedAmount: null, flags: [], announcements: anns };
}

/** 11 lines, 3 of them mine (denominations: one person, several lines). */
function batch(): PayRunBatch {
  const lines = Array.from({ length: 11 }, (_, i) => ({
    index: i,
    stealthAddress: addr(0x1000 + i),
    amount: i === 10 ? 100n * UNIT : 500n * UNIT,
    payer: MOCK_EMPLOYER,
    caller: addr(0xd15),
    ephemeralPubKey: "0x" as Hex,
    metadata: "0x" as Hex,
    logIndex: 2 * i + 1,
  }));
  return { txHash: TX_A, blockNumber: 100n, from: MOCK_EMPLOYER, to: addr(0xd15), token: addr(1), lines, total: 5_100n * UNIT, unfunded: 0 };
}

describe("payRunGroups", () => {
  it("groups my addresses by the pay-run tx that announced them, newest first", () => {
    const groups = payRunGroups([
      entry(addr(1), [ann(addr(1), TX_A, 100n, 1)]),
      entry(addr(2), [ann(addr(2), TX_A, 100n, 3)]),
      entry(addr(3), [ann(addr(3), TX_B, 200n, 1)]),
    ]);
    expect(groups.map((g) => g.txHash)).toEqual([TX_B, TX_A]);
    expect(groups[1]!.mine).toEqual([addr(1), addr(2)]);
    expect(groups[1]!.payer).toBe(MOCK_EMPLOYER);
  });
});

describe("lastSpendTx", () => {
  it("finds the latest spend or convert from an address", () => {
    const a = addr(7);
    const spends = [
      { at: 1, to: addr(9), override: false, parts: [{ from: a, amount: "1", userOpHash: TX_A, txHash: TX_A }] },
      { at: 3, to: addr(9), override: false, parts: [{ from: addr(8), amount: "1", userOpHash: TX_B, txHash: TX_B }] },
    ];
    const conversions = [
      { at: 2, address: a, amountIn: "1", tokenOut: addr(1), symbol: "ETH", amountOut: "1", minOut: "1", userOpHash: TX_B, txHash: TX_B },
    ];
    expect(lastSpendTx(a, spends, conversions)).toEqual({ txHash: TX_B, at: 2 });
    expect(lastSpendTx(addr(99), spends, conversions)).toBeNull();
  });
});

describe("BatchTable: same transaction, two views", () => {
  const mine = [addr(0x1002), addr(0x1005), addr(0x100a)];

  it("coworker view: every line, amounts, owner unknown, nothing highlighted", () => {
    render(<BatchTable batch={markOwnLines(batch(), mine)} myView={false} txUrl="https://sepolia.basescan.org/tx/0xaa" />);
    const root = screen.getByTestId("batch-views");
    expect(root.dataset.view).toBe("coworker");
    expect(within(root).getAllByRole("row")).toHaveLength(12); // header + 11
    expect(within(root).getAllByText("unknown")).toHaveLength(11);
    expect(within(root).queryByText("You")).toBeNull();
    expect(root.querySelectorAll("[data-mine]")).toHaveLength(0);
    expect(screen.getByTestId("batch-caption").textContent).toMatch(/everything anyone can see on-chain: 11 payments totalling 5,100\.00 USDC/);
    expect(screen.getByRole("link", { name: /View on Basescan/ }).getAttribute("href")).toBe("https://sepolia.basescan.org/tx/0xaa");
  });

  it("my view: the same lines, mine highlighted as You, an honest count", () => {
    render(<BatchTable batch={markOwnLines(batch(), mine)} myView />);
    const root = screen.getByTestId("batch-views");
    expect(within(root).getAllByText("You")).toHaveLength(3);
    expect(within(root).getAllByText("unknown")).toHaveLength(8);
    expect(root.querySelectorAll("[data-mine]")).toHaveLength(3);
    expect(screen.getByTestId("batch-caption").textContent).toMatch(/3 of 11 lines are yours \(1,100\.00 USDC\)/);
    expect(screen.queryByRole("link")).toBeNull();
  });
});

describe("gas proof mapping", () => {
  const A = getAddress("0x535a79686fc7c65d2f19ba62c3f99125c2a6f72b");
  const designator = `0xef0100${SIMPLE_7702_ACCOUNT.slice(2).toLowerCase()}` as Hex;
  const links = { tx: (h: string) => `https://x/tx/${h}`, address: (a: string) => `https://x/address/${a}` };

  it("states only verifiable facts, each linked", () => {
    const p = gaslessProofFromReads({ address: A, ethBalance: 0n, nonce: 1, code: designator }, { chainId: CHAIN });
    const rows = proofRows(p, links);
    expect(rows.map((r) => r.key)).toEqual(["eth", "code", "nonce"]);
    expect(rows[0]).toMatchObject({ value: "0 ETH", href: `https://x/address/${A}` });
    expect(rows[1]!.value).toMatch(/EIP-7702, delegate = Simple7702Account/);
    expect(rows[2]!.value).toMatch(/no transaction of its own/);
    expect(proofHeadline(p)).toBe("0 ETH here.");
    render(<GaslessProofView proof={p} links={links} />);
    expect(document.body.textContent).not.toMatch(/never received ETH\./);
    expect(document.body.textContent).toMatch(/Not claimed: that this address never received ETH/);
  });

  it("a mock spend on the Base Sepolia demo reads back as sponsored: 0 ETH, no fee (D-52)", async () => {
    const keys = keysFromMnemonic(generateMnemonic());
    setMockIdentity(keys.metaAddressURI);
    const client = createMockPublicClient(CHAIN);
    await client.getBlockNumber(); // builds the mock world
    const logs = await client.getLogs({ fromBlock: 0n, toBlock: 10n ** 12n });
    const anns: AnnouncementRecord[] = logs.map((l) => ({
      blockNumber: l.blockNumber,
      txHash: l.transactionHash,
      logIndex: l.logIndex,
      ...l.args,
    }));
    const found = scanAnnouncements(anns, { spendingPublicKey: keys.spendingPublicKey, viewingPrivateKey: keys.viewingKey });
    const payRun = found.find((m) => m.announcement.caller !== getAddress("0xbad0000000000000000000000000000000000bad"))!;
    const stealthKey = deriveStealthKey(payRun, { spendingPrivateKey: keys.spendingKey, viewingPrivateKey: keys.viewingKey });
    expect(privateKeyToAccount(stealthKey).address).toBe(payRun.announcement.stealthAddress);
    const [sent] = await createMockSpendService().sendAll([{ stealthKey, to: addr(0xfeed), amount: 100n * UNIT }] as never);
    const proof = await readGaslessProof({ client: client as never, address: sent!.from, chainId: CHAIN, txHash: sent!.txHash! });
    expect(proof.ethBalance).toBe(0n);
    expect(proof.account.simple7702).toBe(true);
    expect(proof.neverSentTx).toBe(true);
    expect(proof.spend).toMatchObject({ paymasterKind: "sponsored", entryPoint: getAddress(ENTRYPOINT_V08), success: true, usdcFee: 0n });
    expect(proofHeadline(proof)).toBe("0 ETH here. Gas was sponsored (testnet); on mainnet the Circle paymaster takes it in USDC.");
    const rows = proofRows(proof, { tx: () => undefined, address: () => undefined });
    expect(rows.find((r) => r.key === "paymaster")!.value).toMatch(/^Sponsoring paymaster \(testnet\)/);
    expect(rows.find((r) => r.key === "fee")!.value).toMatch(/sponsored on this testnet/);
  });
});

describe("mock pay runs rebuild from receipts", () => {
  it("a mock pay-run receipt has Transfer + Announcement per line, ascending; my key finds exactly my chunks", async () => {
    const keys = keysFromMnemonic(generateMnemonic());
    setMockIdentity(keys.metaAddressURI);
    const client = createMockPublicClient(CHAIN);
    await client.getBlockNumber();
    const logs = await client.getLogs({ fromBlock: 0n, toBlock: 10n ** 12n });
    const anns: AnnouncementRecord[] = logs.map((l) => ({ blockNumber: l.blockNumber, txHash: l.transactionHash, logIndex: l.logIndex, ...l.args }));
    const found = scanAnnouncements(anns, { spendingPublicKey: keys.spendingPublicKey, viewingPrivateKey: keys.viewingKey });
    const firstRun = found.map((m) => m.announcement).sort((a, b) => (a.blockNumber < b.blockNumber ? -1 : 1))[0]!;
    const b = await fetchPayRunBatch({ client: client as never, txHash: firstRun.txHash, chainId: CHAIN });
    const mine = found.filter((m) => m.announcement.txHash === firstRun.txHash).map((m) => m.announcement.stealthAddress);
    const owned = markOwnLines(b, mine);
    // 2,600 USDC in 500 chunks = 6 lines; coworkers' 20,200 USDC = 44 lines.
    expect(owned.mineCount).toBe(6);
    expect(owned.mineTotal).toBe(2_600n * UNIT);
    expect(owned.lines).toHaveLength(50);
    expect(owned.total).toBe(22_800n * UNIT);
    expect(owned.unfunded).toBe(0);
    const addrs = owned.lines.map((l) => BigInt(l.stealthAddress));
    expect(addrs.every((a, i) => i === 0 || a > addrs[i - 1]!)).toBe(true);
    expect(owned.lines.every((l) => l.payer === getAddress(MOCK_EMPLOYER) && l.amount !== null && l.amount <= 500n * UNIT)).toBe(true);
    expect(getChainConfig(CHAIN).usdc).toBe(b.token);
  });
});

describe("mock announcement indexer", () => {
  it("serves announcements as JSON (the Transfer side stays in receipts)", async () => {
    setMockIdentity(keysFromMnemonic(generateMnemonic()).metaAddressURI);
    const res = await createMockFetch(CHAIN)("http://mock.local/announcements?limit=5");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: Record<string, unknown>[] };
    expect(body.items).toHaveLength(5);
    expect(body.items[0]).not.toHaveProperty("transfer");
  });
});

describe("guard copy: pay-run hashes are short links", () => {
  const h = `0x681f${"0".repeat(56)}9e2a`;
  it("linkTxHashes shortens and links each hash", () => {
    render(<p>{linkTxHashes(`same pay run (${h}); the combined amount`, (x) => `https://x/tx/${x}`)}</p>);
    const a = screen.getByRole("link");
    expect(a.textContent).toBe("0x681f…9e2a");
    expect(a.getAttribute("href")).toBe(`https://x/tx/${h}`);
    expect(document.body.textContent).not.toContain(h);
  });

  it("GuardDecision renders the amount-leak warning without the raw hash", () => {
    const g = new ClusterGraph();
    const A = addr(0xa);
    const B = addr(0xb);
    g.addStealth(A, { runId: h, amount: 500n });
    g.addStealth(B, { runId: h, amount: 500n });
    const plan = planSpend(g, { from: [A, B], to: addr(0xc) });
    render(<GuardDecision plan={plan} override={false} onOverride={() => {}} />);
    expect(document.body.textContent).toContain("0x681f…9e2a");
    expect(document.body.textContent).not.toContain(h);
  });
});
