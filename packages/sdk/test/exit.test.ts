import { describe, expect, it } from "vitest";
import {
  decodeAbiParameters,
  decodeFunctionData,
  encodeAbiParameters,
  encodeEventTopics,
  erc20Abi,
  getAddress,
  pad,
  parseAbiParameters,
  type Address,
  type Hash,
  type Hex,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import {
  CCTP_FORWARD_HOOK_DATA,
  EXIT_BASE_SEPOLIA_TO_SEPOLIA as CONFIG,
  ENTRYPOINT_V08,
  SNARK_SCALAR_FIELD,
  advanceExitLeg,
  buildBurnCalls,
  cctpMaxFee,
  derivePoolSecrets,
  exitLegMinimum,
  getExitConfig,
  keysFromMnemonic,
  loadPrivacyPoolsSdk,
  planExit,
  planRoundWithdrawals,
  ppEntrypointAbi,
  ppPoolAbi,
  tokenMessengerV2Abi,
  type ExecuteParams,
  type ExitContext,
  type ExitLeg,
  type SpendClient,
  type SpendOptions,
} from "../src/index.js";

const MNEMONIC = "test test test test test test test test test test test junk";
const keys = keysFromMnemonic(MNEMONIC);
const SRC = CONFIG.source;
const DST = CONFIG.dest;
const DEST_WALLET = "0x000000000000000000000000000000000000bEEF" as Address;
const FEE_RECEIVER = "0x349746Ab142B5d0D65899d9bcB6f2Cd53AB084d8" as Address;
const PAYMASTER_FEE = 40_000n;

const tx = (n: number): Hash => pad(`0x${n.toString(16)}`, { size: 32 }) as Hash;

describe("derivePoolSecrets", () => {
  it("is deterministic from the spending key, distinct per index and child, inside the field", () => {
    const a = derivePoolSecrets(keys, 0);
    expect(derivePoolSecrets(keysFromMnemonic(MNEMONIC), 0)).toEqual(a);
    const all = [a, derivePoolSecrets(keys, 1), derivePoolSecrets(keys, 0, 1), derivePoolSecrets(keys, 1, 1)];
    const values = all.flatMap((s) => [s.nullifier, s.secret]);
    expect(new Set(values.map(String)).size).toBe(values.length);
    for (const v of values) {
      expect(v).toBeGreaterThan(0n);
      expect(v).toBeLessThan(SNARK_SCALAR_FIELD);
    }
    const other = keysFromMnemonic("legal winner thank year wave sausage worth useful legal winner thank yellow");
    expect(derivePoolSecrets(other, 0)).not.toEqual(a);
    expect(() => derivePoolSecrets(keys, -1)).toThrow();
  });
});

describe("planning helpers", () => {
  it("routes by (source, dest)", () => {
    expect(getExitConfig(84532, 11155111)).toBe(CONFIG);
    expect(() => getExitConfig(8453, 1)).toThrow(/no route/);
  });

  it("cctpMaxFee = ceil(protocol bps) + forward tier", () => {
    const row = { finalityThreshold: 1000, minimumFee: 1.3, forwardFee: { low: 1_470_130, med: 1_806_763, high: 2_143_397 } };
    // 14 USDC * 1.3 bps = 1820 units
    expect(cctpMaxFee(14_000_000n, row, "med")).toBe(1820n + 1_806_763n);
    expect(cctpMaxFee(14_000_001n, row, "low")).toBe(1821n + 1_470_130n);
    expect(cctpMaxFee(10n, { finalityThreshold: 2000, minimumFee: 0 }, "med")).toBe(0n);
  });

  it("round partial withdrawals", () => {
    expect(planRoundWithdrawals(11_880_000n, { unit: 1_000_000n })).toEqual([5_000_000n, 5_000_000n, 1_880_000n]);
    expect(planRoundWithdrawals(11_880_000n, { unit: 1_000_000n, leaveChange: true })).toEqual([5_000_000n, 5_000_000n]);
    expect(planRoundWithdrawals(900_000n, { unit: 1_000_000n })).toEqual([900_000n]);
    const parts = planRoundWithdrawals(12_345_678n, { unit: 1_000_000n, parts: 3 });
    expect(parts.reduce((a, b) => a + b, 0n)).toBe(12_345_678n);
  });

  it("planExit: one leg per address, consecutive pool indices, JSON-safe, warnings", () => {
    const a = privateKeyToAccount(generatePrivateKey()).address;
    const b = privateKeyToAccount(generatePrivateKey()).address;
    const { legs, fees, warnings } = planExit({
      sources: [
        { stealthAddress: a, amount: 14_000_000n },
        { stealthAddress: b, amount: 11_500_000n },
      ],
      destination: DEST_WALLET,
      config: CONFIG,
      firstPoolIndex: 7,
      now: 1,
    });
    expect(legs.map((l) => l.poolIndex)).toEqual([7, 8]);
    expect(legs[0]).toMatchObject({ status: "planned", amount: "14000000", destination: DEST_WALLET, source: SRC, dest: DST });
    expect(JSON.parse(JSON.stringify(legs))).toEqual(legs);
    expect(fees.total).toBeGreaterThan(0n);
    expect(fees.estimatedReceived).toBeLessThan(25_500_000n);
    expect(warnings.some((w) => w.includes("link to each other"))).toBe(true);
    expect(warnings.some((w) => w.includes(b) && w.includes("minimum"))).toBe(true);
    expect(() => planExit({ sources: [{ stealthAddress: a, amount: 1n }, { stealthAddress: a, amount: 1n }], destination: DEST_WALLET, config: CONFIG })).toThrow(/twice/);
  });

  it("burn calls: approve + depositForBurnWithHook to the same stealth address with the forward hook", () => {
    const s = privateKeyToAccount(generatePrivateKey()).address;
    const calls = buildBurnCalls(CONFIG, s, 13_000_000n, 1_900_000n);
    expect(calls).toHaveLength(2);
    const approve = decodeFunctionData({ abi: erc20Abi, data: calls[0]!.data! });
    expect(approve.args).toEqual([CONFIG.cctp.source.tokenMessenger, 13_000_000n]);
    const burn = decodeFunctionData({ abi: tokenMessengerV2Abi, data: calls[1]!.data! });
    expect(burn.args).toEqual([13_000_000n, 0, pad(s.toLowerCase() as Hex, { size: 32 }), CONFIG.cctp.source.usdc, pad("0x0", { size: 32 }), 1_900_000n, 1000, CCTP_FORWARD_HOOK_DATA]);
  });
});

// ---------------------------------------------------------------------------------------------
// A mocked world: two chains, Iris, the ASP and the relayer
// ---------------------------------------------------------------------------------------------

type World = ReturnType<typeof makeWorld>;

function makeWorld(opts: { stealthKey: Hex; sourceBalance: bigint }) {
  const stealth = privateKeyToAccount(opts.stealthKey).address;
  const w = {
    stealth,
    balances: { [SRC]: opts.sourceBalance, [DST]: 0n } as Record<number, bigint>,
    epNonce: { [SRC]: 0n, [DST]: 0n } as Record<number, bigint>,
    usedNonce: false,
    iris: "none" as "none" | "pending" | "complete",
    forwardState: "PENDING" as string,
    asp: "pending" as "pending" | "approved" | "declined",
    receipts: new Map<string, { status: "success" | "reverted"; logs: { address: Address; data: Hex; topics: Hex[] }[] }>(),
    opLogs: [] as { chain: number; nonce: bigint; tx: Hash; success: boolean }[],
    sends: [] as { chain: number; calls: ExecuteParams["calls"]; feeTokenSpend: bigint }[],
    relays: [] as unknown[],
    stateLeaves: [] as bigint[],
    aspLeaves: [1n, 2n] as bigint[],
    latestRoot: 0n,
    label: 424242n,
    txCounter: 100,
    /** When set, execute calls onSubmit then throws (crash between send and save). */
    crashAfterSubmit: false,
    /** When crashing, whether the op still lands on-chain. */
    landsAnyway: false,
    /** The relayer's response is lost (the request itself went through when `relayLands`). */
    relayLost: false,
    relayLands: false,
    spentNullifiers: new Set<bigint>(),
    withdrawnLogs: [] as { tx: Hash; nullifier: bigint }[],
  };
  const nextTx = () => tx(w.txCounter++);

  const publicClient = (chain: number) => ({
    async readContract(a: { address: Address; functionName: string; args?: readonly unknown[] }) {
      switch (a.functionName) {
        case "balanceOf":
          return w.balances[chain];
        case "getNonce":
          return w.epNonce[chain];
        case "usedNonces":
          return w.usedNonce ? 1n : 0n;
        case "latestRoot":
          return w.latestRoot;
        case "nullifierHashes":
          return w.spentNullifiers.has(a.args![0] as bigint);
        default:
          throw new Error(`readContract ${a.functionName}`);
      }
    },
    async getBlockNumber() {
      return 10_000n;
    },
    async getLogs(a: { address: Address; args?: Record<string, unknown> }) {
      if (getAddress(a.address) === ENTRYPOINT_V08)
        return w.opLogs.filter((l) => l.chain === chain).map((l) => ({ transactionHash: l.tx, args: { nonce: l.nonce, success: l.success } }));
      if (getAddress(a.address) === getAddress(CONFIG.pool.pool))
        return w.withdrawnLogs.map((l) => ({ transactionHash: l.tx, args: { _spentNullifier: l.nullifier } }));
      return [{ transactionHash: tx(999) }];
    },
    async getTransactionReceipt({ hash }: { hash: Hash }) {
      const r = w.receipts.get(hash);
      if (!r) throw new Error("receipt not found");
      return r;
    },
  });
  const client = (chain: number) => ({ chainId: chain, publicClient: publicClient(chain) }) as unknown as SpendClient;

  async function execute(c: SpendClient, params: ExecuteParams, options: SpendOptions = {}) {
    const chain = c.chainId;
    const nonce = w.epNonce[chain]!;
    await options.onSubmit?.({ sender: stealth, nonce, chainId: chain });
    const hash = nextTx();
    const land = () => {
      w.sends.push({ chain, calls: params.calls, feeTokenSpend: params.feeTokenSpend ?? 0n });
      w.epNonce[chain] = nonce + 1n;
      w.balances[chain] = w.balances[chain]! - PAYMASTER_FEE - (params.feeTokenSpend ?? 0n);
      w.opLogs.push({ chain, nonce, tx: hash, success: true });
      const target = getAddress(params.calls.at(-1)!.to);
      if (target === getAddress(CONFIG.pool.entrypoint)) depositEffects(hash, params);
      if (target === getAddress(CONFIG.pool.pool)) {
        w.balances[chain] = w.balances[chain]! + depositValue;
        w.receipts.set(hash, { status: "success", logs: [] });
      }
    };
    if (w.crashAfterSubmit) {
      if (w.landsAnyway) land();
      throw new Error("bundler connection dropped");
    }
    land();
    return { from: stealth, userOpHash: hash, txHash: hash, delegated: nonce === 0n, feeEstimate: PAYMASTER_FEE };
  }

  let depositValue = 0n;
  async function depositEffectsAsync(hash: Hash, params: ExecuteParams) {
    const pp = await loadPrivacyPoolsSdk();
    const { args } = decodeFunctionData({ abi: ppEntrypointAbi, data: params.calls[1]!.data! });
    const [, amount, precommitment] = args as readonly [Address, bigint, bigint];
    depositValue = amount - (amount * CONFIG.pool.vettingFeeBps) / 10_000n;
    const s = derivePoolSecrets(keys, 0);
    const commitment = pp.getCommitment(depositValue, w.label, s.nullifier as never, s.secret as never);
    expect(pp.hashPrecommitment(s.nullifier as never, s.secret as never)).toBe(precommitment);
    w.stateLeaves = [11n, 12n, commitment.hash];
    const data = encodeAbiParameters(parseAbiParameters("uint256, uint256, uint256, uint256"), [commitment.hash, w.label, depositValue, precommitment]);
    const topics = encodeEventTopics({ abi: ppPoolAbi, eventName: "Deposited", args: { _depositor: stealth } }) as Hex[];
    w.receipts.set(hash, { status: "success", logs: [{ address: CONFIG.pool.pool, data, topics }] });
  }
  let pendingDeposit: Promise<void> = Promise.resolve();
  const depositEffects = (hash: Hash, params: ExecuteParams) => {
    pendingDeposit = depositEffectsAsync(hash, params);
  };

  const json = (body: unknown, status = 200) => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  });

  async function fetch(url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) {
    await pendingDeposit;
    if (url.includes("/v2/burn/USDC/fees/6/0"))
      return json([
        { finalityThreshold: 1000, minimumFee: 1.3, forwardFee: { low: 1_470_130, med: 1_806_763, high: 2_143_397 } },
        { finalityThreshold: 2000, minimumFee: 0, forwardFee: { low: 1_470_130, med: 1_806_763, high: 2_143_397 } },
      ]);
    if (url.includes("/v2/messages/6?transactionHash=")) {
      if (w.iris === "none") return json({ error: "not found" }, 404);
      return json({
        messages: [
          w.iris === "pending"
            ? { status: "pending_confirmations", attestation: "PENDING", eventNonce: tx(77), message: "0x" }
            : { status: "complete", attestation: "0xa77e", eventNonce: tx(77), message: "0xabcd", forwardState: w.forwardState, ...(w.forwardState === "COMPLETE" ? { forwardTxHash: tx(555) } : {}) },
        ],
      });
    }
    if (url.endsWith(`/${DST}/public/mt-leaves`)) {
      expect(init?.headers?.["X-Pool-Scope"]).toBe(CONFIG.pool.scope.toString());
      return json({ aspLeaves: w.aspLeaves.map(String), stateTreeLeaves: w.stateLeaves.map(String) });
    }
    if (url.endsWith(`/${DST}/public/deposits-by-label`))
      return json(w.asp === "pending" ? [] : [{ label: String(w.label), reviewStatus: w.asp }]);
    if (url.includes("/relayer/details"))
      return json({ feeBPS: "10", feeReceiverAddress: FEE_RECEIVER, chainId: DST, assetAddress: CONFIG.pool.asset, minWithdrawAmount: "100", maxGasPrice: "1" });
    if (url.endsWith("/relayer/quote")) {
      const body = JSON.parse(init!.body!) as { recipient: Address };
      return json({
        baseFeeBPS: "10",
        feeBPS: "10",
        gasPrice: "1",
        feeCommitment: {
          expiration: Date.now() + 60_000,
          withdrawalData: encodeAbiParameters(parseAbiParameters("address, address, uint256"), [body.recipient, FEE_RECEIVER, 10n]),
          signedRelayerCommitment: "0x1234",
        },
      });
    }
    if (url.endsWith("/relayer/request")) {
      const body = JSON.parse(init!.body!) as { publicSignals: string[] };
      w.relays.push(body);
      const hash = nextTx();
      w.receipts.set(hash, { status: "success", logs: [] });
      if (w.relayLost) {
        if (w.relayLands) {
          const n = BigInt(body.publicSignals[1]!);
          w.spentNullifiers.add(n);
          w.withdrawnLogs.push({ tx: hash, nullifier: n });
        }
        throw new Error("socket hang up");
      }
      return json({ success: true, txHash: hash, requestId: "r", timestamp: 0 });
    }
    throw new Error(`unexpected fetch ${url}`);
  }

  return { w, client, execute, fetch, settle: () => pendingDeposit };
}

function makeCtx(world: ReturnType<typeof makeWorld>, stealthKey: Hex, over: Partial<ExitContext> = {}): ExitContext & { clock: { t: number }; persisted: ExitLeg[] } {
  const clock = { t: 1_000 };
  const persisted: ExitLeg[] = [];
  const ctx: ExitContext & { clock: { t: number }; persisted: ExitLeg[] } = {
    config: { ...CONFIG, withdrawDelayMs: { min: 1_000, max: 1_000 } },
    spendClients: { [SRC]: world.client(SRC), [DST]: world.client(DST) },
    stealthKey,
    keys,
    fetch: world.fetch,
    now: () => clock.t,
    random: () => 0.5,
    persist: (l) => void persisted.push(l),
    execute: world.execute,
    estimate: (async () => ({ fee: PAYMASTER_FEE })) as never,
    prover: {
      proveWithdrawal: async () => ({ proof: { pi_a: ["1", "2", "1"], pi_b: [["3", "4"], ["5", "6"], ["1", "0"]], pi_c: ["7", "8", "1"] }, publicSignals: ["9"] }),
      proveCommitment: async () => ({ proof: { pi_a: ["1", "2"], pi_b: [["3", "4"], ["5", "6"]], pi_c: ["7", "8"] }, publicSignals: ["1", "2", "3", "4"] }),
    },
    clock,
    persisted,
    ...over,
  };
  return ctx;
}

/** Serialize → parse between every step: the state must survive a reload unchanged. */
async function step(ctx: ExitContext, leg: ExitLeg): Promise<ExitLeg> {
  const reloaded = JSON.parse(JSON.stringify(leg)) as ExitLeg;
  const next = await advanceExitLeg(ctx, reloaded);
  expect(JSON.parse(JSON.stringify(next))).toEqual(next);
  return next;
}

function freshLeg(amount = 14_000_000n) {
  const stealthKey = generatePrivateKey();
  const world = makeWorld({ stealthKey, sourceBalance: amount });
  const { legs } = planExit({ sources: [{ stealthAddress: world.w.stealth, amount }], destination: DEST_WALLET, config: CONFIG, now: 0 });
  return { stealthKey, world, leg: legs[0]! };
}

async function toPendingAsp(ctx: ExitContext, world: World, leg: ExitLeg) {
  const w = world.w;
  leg = await step(ctx, leg); // burn
  expect(leg.status).toBe("burning");
  w.iris = "complete";
  w.forwardState = "COMPLETE";
  leg = await step(ctx, leg);
  expect(leg.status).toBe("awaiting-mint");
  w.usedNonce = true;
  w.balances[DST] = BigInt(leg.burn!.amount) - BigInt(leg.burn!.maxFee);
  leg = await step(ctx, leg);
  expect(leg.status).toBe("minted");
  leg = await step(ctx, leg); // deposit
  expect(leg.status).toBe("depositing");
  await world.settle();
  leg = await step(ctx, leg);
  expect(leg.status).toBe("pending-asp");
  return leg;
}

describe("advanceExitLeg (mocked chain, ASP and relayer)", () => {
  it("happy path through every state, resumable from JSON at each step", async () => {
    const { stealthKey, world, leg: planned } = freshLeg();
    const { w } = world;
    const ctx = makeCtx(world, stealthKey);

    let leg = await step(ctx, planned);
    expect(leg.status).toBe("burning");
    expect(leg.txs.burn).toBeDefined();
    expect(leg.pending).toBeUndefined();
    const burnSend = w.sends[0]!;
    expect(burnSend.chain).toBe(SRC);
    const burn = decodeFunctionData({ abi: tokenMessengerV2Abi, data: burnSend.calls[1]!.data! });
    expect(burn.args[2]).toBe(pad(w.stealth.toLowerCase() as Hex, { size: 32 }));
    // burn + margin-adjusted paymaster fee fits the balance
    expect(BigInt(leg.burn!.amount)).toBe(14_000_000n - (PAYMASTER_FEE + PAYMASTER_FEE / 10n));
    expect(BigInt(leg.burn!.maxFee)).toBe(cctpMaxFee(BigInt(leg.burn!.amount), { finalityThreshold: 1000, minimumFee: 1.3, forwardFee: { low: 0, med: 1_806_763, high: 0 } }, "med"));

    // Iris has nothing yet, then pending: no transition, same object back.
    expect(await advanceExitLeg(ctx, leg)).toBe(leg);
    w.iris = "pending";
    expect((await step(ctx, leg)).status).toBe("burning");

    w.iris = "complete";
    leg = await step(ctx, leg);
    expect(leg.status).toBe("awaiting-mint");
    expect(leg.cctp).toMatchObject({ nonce: tx(77), message: "0xabcd", attestation: "0xa77e" });

    expect((await step(ctx, leg)).status).toBe("awaiting-mint"); // not minted yet
    w.usedNonce = true;
    w.balances[DST] = 12_100_000n;
    leg = await step(ctx, leg);
    expect(leg.status).toBe("minted");
    expect(leg.mint).toEqual({ amount: "12100000" });
    expect(leg.txs.mint).toBe(tx(999)); // from MessageReceived logs (forwardState not COMPLETE)

    leg = await step(ctx, leg);
    expect(leg.status).toBe("depositing");
    expect(w.sends).toHaveLength(2);
    expect(w.sends[1]!.chain).toBe(DST);
    const dep = decodeFunctionData({ abi: ppEntrypointAbi, data: w.sends[1]!.calls[1]!.data! });
    expect(dep.args[1]).toBe(12_100_000n - (PAYMASTER_FEE + PAYMASTER_FEE / 10n));
    await world.settle();

    leg = await step(ctx, leg);
    expect(leg.status).toBe("pending-asp");
    expect(leg.deposit!.label).toBe(String(w.label));
    const value = BigInt(leg.deposit!.value);
    expect(leg.remaining).toBe(String(value));

    expect((await step(ctx, leg)).status).toBe("pending-asp");
    w.aspLeaves = [1n, w.label, 2n];
    const pp = await loadPrivacyPoolsSdk();
    w.latestRoot = pp.generateMerkleProof(w.aspLeaves, w.label).root;
    leg = await step(ctx, leg);
    expect(leg.status).toBe("approved");
    expect(leg.notBefore).toBe(ctx.clock.t + 1_000);
    expect(leg.withdrawPlan!.map(BigInt).reduce((a, b) => a + b, 0n)).toBe(value);

    // Before the delay: untouched.
    expect(await advanceExitLeg(ctx, leg)).toBe(leg);
    ctx.clock.t += 1_000;
    leg = await step(ctx, leg);
    expect(leg.status).toBe("withdrawing");
    expect(w.relays).toHaveLength(1);
    const relay = w.relays[0] as { withdrawal: { processooor: Address; data: Hex }; scope: string; chainId: number };
    expect(getAddress(relay.withdrawal.processooor)).toBe(getAddress(CONFIG.pool.entrypoint));
    const [recipient] = decodeAbiParameters(parseAbiParameters("address, address, uint256"), relay.withdrawal.data);
    expect(recipient).toBe(DEST_WALLET);
    expect(relay.scope).toBe(CONFIG.pool.scope.toString());

    // Confirm part 1; the change commitment (child 1) goes into the state tree.
    const first = BigInt(leg.withdrawPlan![0]!);
    leg = await step(ctx, leg);
    expect(leg.status).toBe("approved");
    expect(leg.remaining).toBe(String(value - first));
    const change = derivePoolSecrets(keys, 0, 1);
    w.stateLeaves.push(pp.getCommitment(value - first, w.label, change.nullifier as never, change.secret as never).hash);

    while (leg.status !== "done") {
      ctx.clock.t += 1_000;
      leg = await step(ctx, leg);
      expect(leg.error).toBeUndefined();
      if (leg.status === "withdrawing") {
        const done = leg.withdrawals.filter((x) => x.done);
        const rem = BigInt(leg.remaining!) - BigInt(leg.withdrawals.at(-1)!.amount);
        const s = derivePoolSecrets(keys, 0, done.length + 1);
        if (rem > 0n) w.stateLeaves.push(pp.getCommitment(rem, w.label, s.nullifier as never, s.secret as never).hash);
      }
    }
    expect(leg.remaining).toBe("0");
    expect(leg.withdrawals.every((x) => x.done)).toBe(true);
    expect(leg.withdrawals.map((x) => x.child)).toEqual(leg.withdrawals.map((_, i) => i));
    expect(w.sends).toHaveLength(2); // withdrawals never go through the stealth address
    expect(await advanceExitLeg(ctx, leg)).toBe(leg); // final
  });

  it("declined → ragequit back to the stealth address → refunded", async () => {
    const { stealthKey, world, leg: planned } = freshLeg();
    const ctx = makeCtx(world, stealthKey);
    let leg = await toPendingAsp(ctx, world, planned);
    world.w.asp = "declined";
    leg = await step(ctx, leg);
    expect(leg.status).toBe("declined");
    leg = await step(ctx, leg);
    expect(leg.status).toBe("refunded");
    expect(leg.txs.refund).toBeDefined();
    const rq = world.w.sends.at(-1)!;
    expect(rq.chain).toBe(DST);
    expect(getAddress(rq.calls[0]!.to)).toBe(getAddress(CONFIG.pool.pool));
    const { functionName, args } = decodeFunctionData({ abi: ppPoolAbi, data: rq.calls[0]!.data! });
    expect(functionName).toBe("ragequit");
    expect((args[0] as { pubSignals: readonly bigint[] }).pubSignals).toEqual([1n, 2n, 3n, 4n]);
    expect(await advanceExitLeg(ctx, leg)).toBe(leg);
  });

  it("idempotent: concurrent and repeated advances send one burn", async () => {
    const { stealthKey, world, leg } = freshLeg();
    const ctx = makeCtx(world, stealthKey);
    const [a, b] = await Promise.all([advanceExitLeg(ctx, leg), advanceExitLeg(ctx, leg)]);
    expect(a).toBe(b);
    expect(world.w.sends).toHaveLength(1);
    await advanceExitLeg(ctx, a);
    await advanceExitLeg(ctx, a);
    expect(world.w.sends).toHaveLength(1);
    // persist ran with `pending` before the op left
    expect(ctx.persisted[0]!.pending).toMatchObject({ step: "burn", chainId: SRC, nonce: "0" });
  });

  it("crash after submit, op landed: resume adopts its tx and does not resend", async () => {
    const { stealthKey, world, leg } = freshLeg();
    const ctx = makeCtx(world, stealthKey);
    world.w.crashAfterSubmit = true;
    world.w.landsAnyway = true;
    const crashed = await step(ctx, leg);
    expect(crashed.status).toBe("planned");
    expect(crashed.pending).toMatchObject({ step: "burn", nonce: "0" });
    expect(crashed.error).toMatch(/dropped/);
    world.w.crashAfterSubmit = false;
    // Resume from what persist saved (the app reloads it from the vault).
    const saved = ctx.persisted.at(-1)!;
    const resumed = await step(ctx, saved);
    expect(resumed.status).toBe("burning");
    expect(resumed.txs.burn).toBe(world.w.opLogs[0]!.tx);
    expect(resumed.pending).toBeUndefined();
    expect(world.w.sends).toHaveLength(1);
  });

  it("crash after submit, op never landed: resume sends once more", async () => {
    const { stealthKey, world, leg } = freshLeg();
    const ctx = makeCtx(world, stealthKey);
    world.w.crashAfterSubmit = true;
    const crashed = await step(ctx, leg);
    expect(crashed.pending).toBeDefined();
    world.w.crashAfterSubmit = false;
    const resumed = await step(ctx, crashed);
    expect(resumed.status).toBe("burning");
    expect(world.w.sends).toHaveLength(1);
    expect(world.w.epNonce[SRC]).toBe(1n);
  });

  it("never simulates a deposit below the pool minimum, even with a large fee cap", async () => {
    // Live 2026-09-26: an 8 USDC Sepolia cap made balance - cap < minDeposit, so the fee probe reverted
    // with MinimumDepositAmount although the real fee left enough to deposit.
    const { stealthKey, world, leg: start } = freshLeg(18_000_000n);
    const probes: bigint[] = [];
    const ctx = makeCtx(world, stealthKey, {
      maxFeeUsdc: { [DST]: 8_000_000n },
      estimate: (async (_c: unknown, p: ExecuteParams) => {
        if (p.calls[1] && getAddress(p.calls[1].to) === getAddress(CONFIG.pool.entrypoint)) {
          const { args } = decodeFunctionData({ abi: ppEntrypointAbi, data: p.calls[1].data! });
          probes.push(args[1] as bigint);
        }
        return { fee: PAYMASTER_FEE };
      }) as never,
    });
    const leg = await toPendingAsp(ctx, world, start);
    expect(probes.length).toBeGreaterThan(0);
    for (const p of probes) expect(p).toBeGreaterThanOrEqual(CONFIG.pool.minDeposit);
    expect(BigInt(leg.deposit!.amount)).toBeGreaterThanOrEqual(CONFIG.pool.minDeposit);
  });

  it("resumes the deposit after a crash the same way", async () => {
    const { stealthKey, world, leg: planned } = freshLeg();
    const ctx = makeCtx(world, stealthKey);
    let leg = await step(ctx, planned);
    world.w.iris = "complete";
    leg = await step(ctx, leg);
    world.w.usedNonce = true;
    world.w.balances[DST] = 12_000_000n;
    leg = await step(ctx, leg);
    expect(leg.status).toBe("minted");
    world.w.crashAfterSubmit = true;
    world.w.landsAnyway = true;
    leg = await step(ctx, leg);
    expect(leg).toMatchObject({ status: "minted", pending: { step: "deposit", chainId: DST } });
    world.w.crashAfterSubmit = false;
    leg = await step(ctx, leg);
    expect(leg.status).toBe("depositing");
    expect(world.w.sends.filter((s) => s.chain === DST)).toHaveLength(1);
    await world.settle();
    leg = await step(ctx, leg);
    expect(leg.status).toBe("pending-asp");
  });

  it("minted below the pool minimum: stays minted and says how much is missing", async () => {
    const { stealthKey, world, leg: planned } = freshLeg();
    const ctx = makeCtx(world, stealthKey);
    let leg = await step(ctx, planned);
    world.w.iris = "complete";
    leg = await step(ctx, leg);
    world.w.usedNonce = true;
    world.w.balances[DST] = 9_000_000n;
    leg = await step(ctx, leg);
    leg = await step(ctx, leg);
    expect(leg.status).toBe("minted");
    expect(leg.error).toMatch(/needs \d+ more USDC/);
    expect(world.w.sends.filter((s) => s.chain === DST)).toHaveLength(0);
  });

  it("forwarding failed: hands the attested message to the mint fallback", async () => {
    const { stealthKey, world, leg: planned } = freshLeg();
    const calls: unknown[] = [];
    const ctx = makeCtx(world, stealthKey, {
      mintFallback: async (a) => {
        calls.push(a);
        return tx(4242);
      },
    });
    let leg = await step(ctx, planned);
    world.w.iris = "complete";
    world.w.forwardState = "FAILED";
    leg = await step(ctx, leg);
    leg = await step(ctx, leg);
    expect(calls).toEqual([{ message: "0xabcd", attestation: "0xa77e", dest: DST }]);
    expect(leg.status).toBe("awaiting-mint");
    expect(leg.txs.mint).toBe(tx(4242));
  });
});

describe("exitLegMinimum (the real leg minimum)", () => {
  /** The step machine's arithmetic at a given source balance, with the estimated prefunds. */
  const simulate = (balance: bigint) => {
    const m = (f: bigint) => f + f / 10n;
    const burn = balance - m(CONFIG.estimates.sourceGas);
    const minted = burn - (burn * 130n + 999_999n) / 1_000_000n - CONFIG.estimates.forwardFee;
    return minted - CONFIG.ragequitReserve - m(CONFIG.estimates.destGas);
  };

  it("testnet: ≈ 16.4 USDC (pool minimum + CCTP fee + forward fee + paymaster prefunds), exact at the edge", () => {
    const { minimum, breakdown } = exitLegMinimum(CONFIG);
    expect(minimum).toBeGreaterThan(16_300_000n);
    expect(minimum).toBeLessThan(16_600_000n);
    expect(minimum).toBeGreaterThan(12_660_000n); // the old, underestimated planner minimum
    expect(simulate(minimum)).toBeGreaterThanOrEqual(CONFIG.pool.minDeposit);
    expect(simulate(minimum - 1n)).toBeLessThan(CONFIG.pool.minDeposit);
    expect(breakdown.minDeposit).toBe(10_000_000n);
    expect(breakdown.destGas).toBe(CONFIG.estimates.destGas + CONFIG.estimates.destGas / 10n);
    expect(breakdown.minDeposit + breakdown.destGas + breakdown.forwardFee + breakdown.cctpProtocolFee + breakdown.sourceGas).toBe(minimum);
  });

  it("follows live quotes: pricier gas or forwarding raises it, a standard (free) transfer lowers it", () => {
    const base = exitLegMinimum(CONFIG).minimum;
    const pricier = exitLegMinimum(CONFIG, { destGas: 5_000_000n }).minimum; // +1.25 prefund, +10% headroom, + its CCTP bps
    expect(pricier - base).toBeGreaterThanOrEqual(1_375_000n);
    expect(pricier - base).toBeLessThan(1_376_000n);
    expect(exitLegMinimum(CONFIG, { forwardFee: 1_530_000n }).minimum).toBeLessThan(base);
    const standard = exitLegMinimum({ ...CONFIG, cctp: { ...CONFIG.cctp, minFinalityThreshold: 2000 } });
    expect(standard.breakdown.cctpProtocolFee).toBe(0n);
    expect(exitLegMinimum(CONFIG, { cctpMinimumFeeBps: 0 }).minimum).toBe(standard.minimum);
  });

  it("planExit flags legs below it (and passes the ones at it)", () => {
    const min = exitLegMinimum(CONFIG).minimum;
    const a = privateKeyToAccount(generatePrivateKey()).address;
    const b = privateKeyToAccount(generatePrivateKey()).address;
    const plan = planExit({ sources: [{ stealthAddress: a, amount: min }, { stealthAddress: b, amount: min - 1n }], destination: DEST_WALLET, config: CONFIG });
    expect(plan.minimum).toBe(min);
    expect(plan.belowMinimum).toEqual([b]);
    expect(plan.warnings.some((w) => w.includes(b) && w.includes(`below the ${min}`))).toBe(true);
    expect(plan.warnings.some((w) => w.includes(a) && w.includes("below"))).toBe(false);
  });
});

describe("withdrawal persistence (relayer response lost)", () => {
  const SPENT = 777n;
  const proverWith = (signals: string[]) => ({
    proveWithdrawal: async () => ({ proof: { pi_a: ["1", "2", "1"], pi_b: [["3", "4"], ["5", "6"], ["1", "0"]], pi_c: ["7", "8", "1"] }, publicSignals: signals }),
    proveCommitment: async () => ({ proof: { pi_a: ["1", "2"], pi_b: [["3", "4"], ["5", "6"]], pi_c: ["7", "8"] }, publicSignals: ["1", "2", "3", "4"] }),
  });

  async function toApproved(landing: boolean) {
    const { stealthKey, world, leg: planned } = freshLeg();
    const ctx = makeCtx(world, stealthKey, { prover: proverWith(["5", String(SPENT), "9", "0", "0", "0", "0", "0"]) });
    let leg = await toPendingAsp(ctx, world, planned);
    world.w.aspLeaves = [1n, world.w.label, 2n];
    const pp = await loadPrivacyPoolsSdk();
    world.w.latestRoot = pp.generateMerkleProof(world.w.aspLeaves, world.w.label).root;
    leg = await step(ctx, leg);
    expect(leg.status).toBe("approved");
    ctx.clock.t += 1_000;
    world.w.relayLost = true;
    world.w.relayLands = landing;
    const before = ctx.persisted.length;
    leg = await step(ctx, leg);
    // Saved with the pending marker before the request left, and still on the returned leg.
    expect(ctx.persisted.length).toBe(before + 1);
    expect(ctx.persisted.at(-1)!.pendingWithdraw).toMatchObject({ spentNullifier: String(SPENT), child: 0 });
    expect(leg.status).toBe("approved");
    expect(leg.pendingWithdraw?.spentNullifier).toBe(String(SPENT));
    expect(leg.error).toMatch(/hang up/);
    world.w.relayLost = false;
    return { ctx, world, leg };
  }

  it("landed: resume adopts the Withdrawn tx and never relays again", async () => {
    const { ctx, world, leg: crashed } = await toApproved(true);
    // Resume from the vault copy (what persist saved), as after a reload.
    const leg = await step(ctx, ctx.persisted.at(-1)!);
    expect(leg.status).toBe("withdrawing");
    expect(leg.txs.withdraw).toBe(world.w.withdrawnLogs[0]!.tx);
    expect(leg.withdrawals).toEqual([{ amount: crashed.pendingWithdraw!.amount, child: 0, tx: world.w.withdrawnLogs[0]!.tx }]);
    expect(leg.pendingWithdraw).toBeUndefined();
    expect(world.w.relays).toHaveLength(1);
    const confirmed = await step(ctx, leg);
    expect(confirmed.withdrawals[0]!.done).toBe(true);
  });

  it("not landed: waits out the retry window, then relays once more", async () => {
    const { ctx, world, leg } = await toApproved(false);
    const waiting = await advanceExitLeg(ctx, leg); // inside the window: no relay
    expect(waiting).toMatchObject({ status: "approved", pendingWithdraw: leg.pendingWithdraw });
    expect(world.w.relays).toHaveLength(1);
    ctx.clock.t += 5 * 60_000;
    const next = await step(ctx, leg);
    expect(next.status).toBe("withdrawing");
    expect(next.pendingWithdraw).toBeUndefined();
    expect(world.w.relays).toHaveLength(2);
  });

  it("a relayer refusal clears the marker (nothing went out)", async () => {
    const { stealthKey, world, leg: planned } = freshLeg();
    const ctx = makeCtx(world, stealthKey, { prover: proverWith(["5", String(SPENT)]) });
    let leg = await toPendingAsp(ctx, world, planned);
    world.w.aspLeaves = [1n, world.w.label, 2n];
    const pp = await loadPrivacyPoolsSdk();
    world.w.latestRoot = pp.generateMerkleProof(world.w.aspLeaves, world.w.label).root;
    leg = await step(ctx, leg);
    ctx.clock.t += 1_000;
    const f = ctx.fetch!;
    ctx.fetch = async (url, init) =>
      url.endsWith("/relayer/request") ? { ok: true, status: 200, json: async () => ({ success: false, error: "nope" }), text: async () => "" } : f(url, init);
    leg = await step(ctx, leg);
    expect(leg.status).toBe("approved");
    expect(leg.pendingWithdraw).toBeUndefined();
    expect(leg.error).toMatch(/nope/);
  });
});
