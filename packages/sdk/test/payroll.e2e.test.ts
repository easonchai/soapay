/**
 * Full payroll loop on a Base mainnet fork, against the real canonical ERC-6538 Registry,
 * ERC-5564 Announcer, USDC, EntryPoint v0.8, Simple7702Account and Circle Paymaster, plus a freshly
 * deployed StealthDisperse. Skipped unless FORK_E2E=1.
 *
 *   FORK_E2E=1 [FORK_RPC_URL=https://mainnet.base.org] pnpm --filter @soapay/sdk vitest run test/payroll.e2e.test.ts
 *
 * Flow: employees derive keys from a seed → a relayer registers their meta-addresses gaslessly →
 * the employer enrolls (reads the pinned meta-address) → one pay run through StealthDisperse →
 * every employee scans and finds exactly their own lines with real balances → one employee spends
 * a stealth payment with 7702 + the USDC paymaster, after the consolidation guard allows it.
 * Requires `forge build` in contracts/ (reads the StealthDisperse artifact).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createPublicClient,
  createWalletClient,
  decodeEventLog,
  encodeAbiParameters,
  erc20Abi,
  getAddress,
  http,
  isAddressEqual,
  keccak256,
  numberToHex,
  parseAbiParameters,
  parseEther,
  type Address,
  type Chain,
  type Hex,
  type PublicClient,
  type Transport,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";
import {
  ANNOUNCER_ADDRESS,
  CHAINS,
  ClusterGraph,
  REGISTRY_ADDRESS,
  announcerAbi,
  buildLedger,
  buildRegisterKeysOnBehalfCall,
  createSpendClient,
  derivePayRun,
  deriveStealthKey,
  encodeStealthDisperseCalls,
  fetchAnnouncementsRpc,
  formatMetaAddressURI,
  generateMnemonic,
  getRegistryNonce,
  keysFromMnemonic,
  planSpend,
  registryAbi,
  scanAnnouncements,
  signRegisterKeysOnBehalf,
  spendFromStealth,
  verifyBalances,
  type PayRunLine,
  type SoapayKeys,
} from "../src/index.js";
import { env, selfBundler, startAnvil, type Anvil } from "./helpers/fork.js";

const enabled = env.FORK_E2E === "1";
/** vitest runs from packages/sdk. */
const cwd = (globalThis as unknown as { process: { cwd: () => string } }).process.cwd;
const USDC = CHAINS[base.id].usdc;
/** FiatTokenV2_2 `balanceAndBlacklistStates` mapping slot. */
const USDC_BALANCE_SLOT = 9n;
const usdc = (n: number) => BigInt(Math.round(n * 1e6));

const SALARIES = [
  { name: "alice", amount: usdc(5000) },
  { name: "bob", amount: usdc(4250.5) },
  { name: "carol", amount: usdc(3000) },
];

describe.skipIf(!enabled)("Base fork E2E: full payroll loop", () => {
  let anvil: Anvil;
  let publicClient: PublicClient<Transport, Chain>;
  let stealthDisperse: Address;
  let deployBlock: bigint;
  const employer = privateKeyToAccount(generatePrivateKey());
  const relayer = privateKeyToAccount(generatePrivateKey());
  const employees: { name: string; amount: bigint; keys: SoapayKeys; pinnedMeta?: string }[] = SALARIES.map((s) => ({
    ...s,
    keys: keysFromMnemonic(generateMnemonic()),
  }));
  let lines: PayRunLine[] = [];
  let payTxs: Hex[] = [];

  const wallet = (account: typeof employer) => createWalletClient({ account, chain: base, transport: http(anvil.url) });
  const erc20 = (who: Address) => publicClient.readContract({ address: USDC, abi: erc20Abi, functionName: "balanceOf", args: [who] });
  const setBalance = (who: Address, eth: string) =>
    publicClient.request({ method: "anvil_setBalance" as never, params: [who, numberToHex(parseEther(eth))] as never });
  const fundUsdc = async (who: Address, amount: bigint) => {
    const slot = keccak256(encodeAbiParameters(parseAbiParameters("address, uint256"), [who, USDC_BALANCE_SLOT]));
    await publicClient.request({ method: "anvil_setStorageAt" as never, params: [USDC, slot, numberToHex(amount, { size: 32 })] as never });
  };
  const send = async (account: typeof employer, tx: { to: Address; data: Hex }) => {
    const hash = await wallet(account).sendTransaction(tx);
    const r = await publicClient.waitForTransactionReceipt({ hash });
    expect(r.status, hash).toBe("success");
    return r;
  };

  beforeAll(async () => {
    anvil = await startAnvil();
    publicClient = createPublicClient({ chain: base, transport: http(anvil.url) }) as unknown as PublicClient<Transport, Chain>;
    await setBalance(employer.address, "1");
    await setBalance(relayer.address, "1");
    await fundUsdc(employer.address, usdc(100_000));

    const { readFileSync } = (await import("node:fs" as string)) as { readFileSync: (p: string, e: string) => string };
    const artifact = JSON.parse(
      readFileSync(`${cwd()}/../../contracts/out/StealthDisperse.sol/StealthDisperse.json`, "utf8"),
    ) as { bytecode: { object: Hex } };
    const hash = await wallet(employer).deployContract({ abi: [], bytecode: artifact.bytecode.object });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    stealthDisperse = getAddress(receipt.contractAddress!);
    deployBlock = receipt.blockNumber;
  }, 180_000);

  afterAll(() => anvil?.stop());

  it("1. onboarding: each employee's meta-address is registered gaslessly by a relayer", async () => {
    for (const e of employees) {
      const registrant = e.keys.registrantAddress;
      const nonce = await getRegistryNonce(publicClient, registrant);
      const signature = await signRegisterKeysOnBehalf({
        registrantKey: e.keys.registrantKey,
        metaAddressURI: e.keys.metaAddressURI,
        chainId: base.id,
        nonce,
      });
      await send(relayer, buildRegisterKeysOnBehalfCall({ registrant, signature, metaAddressURI: e.keys.metaAddressURI }));
      // The registrant never held ETH: registration was sponsored.
      expect(await publicClient.getBalance({ address: registrant })).toBe(0n);
    }
  }, 120_000);

  it("2. enrollment: the employer reads and pins each meta-address from ERC-6538", async () => {
    for (const e of employees) {
      const raw = await publicClient.readContract({
        address: REGISTRY_ADDRESS,
        abi: registryAbi,
        functionName: "stealthMetaAddressOf",
        args: [e.keys.registrantAddress, 1n],
      });
      e.pinnedMeta = formatMetaAddressURI(raw);
      expect(e.pinnedMeta).toBe(e.keys.metaAddressURI.toLowerCase());
    }
  });

  it("3. pay run: one StealthDisperse tx pays every line to a fresh address and announces it", async () => {
    // Denominate bob's salary to show several lines for one person landing on unrelated addresses.
    lines = derivePayRun({
      recipients: employees.map((e) => ({ metaAddressURI: e.pinnedMeta!, amount: e.amount, id: e.name })),
      denominate: (amount, r) => (r.id === "bob" ? [usdc(1000), usdc(1000), usdc(1000), usdc(1000), amount - usdc(4000)] : [amount]),
    });
    expect(lines).toHaveLength(7);

    const calls = encodeStealthDisperseCalls({ stealthDisperse, token: USDC, lines });
    await send(employer, calls.approve);
    const before = await erc20(employer.address);
    payTxs = [];
    for (const pay of calls.pays) payTxs.push((await send(employer, pay)).transactionHash);
    expect(before - (await erc20(employer.address))).toBe(calls.total);
    expect(await erc20(stealthDisperse)).toBe(0n); // holds no funds

    // Every line: a fresh EOA, exactly its amount, one Announcement in the same tx, ascending order.
    const receipt = await publicClient.getTransactionReceipt({ hash: payTxs[0]! });
    const announced = receipt.logs
      .filter((l) => isAddressEqual(l.address, ANNOUNCER_ADDRESS))
      .map((l) => decodeEventLog({ abi: announcerAbi, data: l.data, topics: l.topics }).args as { stealthAddress: Address; caller: Address });
    expect(announced.map((a) => a.stealthAddress)).toEqual(lines.map((l) => l.stealthAddress));
    for (const [i, l] of lines.entries()) {
      expect(await erc20(l.stealthAddress)).toBe(l.amount);
      expect(await publicClient.getCode({ address: l.stealthAddress })).toBeUndefined();
      expect(isAddressEqual(announced[i]!.caller, stealthDisperse)).toBe(true);
      if (i > 0) expect(BigInt(l.stealthAddress) > BigInt(lines[i - 1]!.stealthAddress)).toBe(true);
    }
    // No stealth address equals any registrant (the name never pays a static address).
    const registrants = new Set(employees.map((e) => e.keys.registrantAddress.toLowerCase()));
    for (const l of lines) expect(registrants.has(l.stealthAddress.toLowerCase())).toBe(false);
  }, 120_000);

  it("4. scanning: each employee finds exactly their own lines, amounts from real balances", async () => {
    const announcements = await fetchAnnouncementsRpc({ client: publicClient, fromBlock: deployBlock, toBlock: await publicClient.getBlockNumber() });
    for (const e of employees) {
      const matches = scanAnnouncements(announcements, { spendingPublicKey: e.keys.spendingPublicKey, viewingPrivateKey: e.keys.viewingKey });
      const mine = lines.filter((l) => l.recipientId === e.name).map((l) => l.stealthAddress).sort();
      expect(matches.map((m) => getAddress(m.announcement.stealthAddress)).sort()).toEqual(mine);

      const balances = await verifyBalances({ client: publicClient, matches, tokens: [USDC] });
      const ledger = buildLedger(matches, balances, [employer.address], { stealthDisperse: [stealthDisperse] });
      expect(ledger.reduce((s, x) => s + (x.balance ?? 0n), 0n)).toBe(e.amount);
      for (const entry of ledger) {
        expect(entry.payerKnown).toBe(true);
        expect(isAddressEqual(entry.payer!, employer.address)).toBe(true);
      }
      // Every recovered key controls its address (deriveStealthKey checks this itself).
      for (const m of matches) deriveStealthKey(m, { spendingPrivateKey: e.keys.spendingKey, viewingPrivateKey: e.keys.viewingKey });
    }
  }, 180_000);

  it("5. spending: the guard allows one address → fresh destination; 7702 + USDC paymaster, no ETH ever", async () => {
    const alice = employees[0]!;
    const announcements = await fetchAnnouncementsRpc({ client: publicClient, fromBlock: deployBlock, toBlock: await publicClient.getBlockNumber() });
    const [match] = scanAnnouncements(announcements, { spendingPublicKey: alice.keys.spendingPublicKey, viewingPrivateKey: alice.keys.viewingKey });
    const from = getAddress(match!.announcement.stealthAddress);
    const to = privateKeyToAccount(generatePrivateKey()).address;

    const graph = new ClusterGraph();
    graph.addStealth(from);
    expect(planSpend(graph, { from: [from], to }).decision).toBe("allow");
    // Sending to a coworker-known wallet would be blocked without an explicit override.
    graph.setLabel(to, "coworker-known");
    expect(planSpend(graph, { from: [from], to }).decision).toBe("block");
    graph.setLabel(to, undefined);

    const bundler = selfBundler(publicClient, anvil.url);
    await setBalance(bundler.bundler.address, "1");
    const client = createSpendClient({
      chainId: base.id,
      publicClient,
      bundlerTransport: bundler.transport,
      estimateFeesPerGas: async () => {
        const { baseFeePerGas } = await publicClient.getBlock();
        return { maxFeePerGas: 2n * (baseFeePerGas ?? 0n) + 1_000_000n, maxPriorityFeePerGas: 1_000_000n };
      },
    });
    const stealthKey = deriveStealthKey(match!, { spendingPrivateKey: alice.keys.spendingKey, viewingPrivateKey: alice.keys.viewingKey });
    const res = await spendFromStealth(client, { stealthKey, to, amount: usdc(1234) });
    expect(res.delegated).toBe(true);
    expect(await erc20(to)).toBe(usdc(1234));
    // Privacy invariant 2: no stealth address was ever funded with ETH.
    for (const l of lines) expect(await publicClient.getBalance({ address: l.stealthAddress })).toBe(0n);
  }, 180_000);
});
