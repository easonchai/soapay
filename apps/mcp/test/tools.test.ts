import { describe, expect, it } from "vitest";
import { decodeFunctionData, getAddress, type Hex } from "viem";
import { ClusterGraph, announcerAbi, erc20Abi, stealthDisperseAbi, decodeHead, keysFromMnemonic } from "@soapay/sdk";
import { ApiError } from "../src/context.js";
import { createAgentIdentity, resolveName, whoami } from "../src/tools/identity.js";
import { pay as payTool } from "../src/tools/pay.js";
import { balance, scan } from "../src/tools/receive.js";
import { spend as spendTool } from "../src/tools/spend.js";
import { swapInPlace as swapTool } from "../src/tools/swap.js";
import { ToolError } from "../src/util.js";
import { AGENT_MNEMONIC, DISPERSE, EMPLOYER, PAYER, USDC, agentKeys, alice, bob, makeCtx, paymentsToAgent, u } from "./helpers.js";

// Tools return plan | result unions; tests read either shape.
const pay = (...a: Parameters<typeof payTool>): Promise<any> => payTool(...a);
const spend = (...a: Parameters<typeof spendTool>): Promise<any> => spendTool(...a);
const swapInPlace = (...a: Parameters<typeof swapTool>): Promise<any> => swapTool(...a);

async function err(p: Promise<unknown>): Promise<ToolError> {
  try {
    await p;
  } catch (e) {
    if (e instanceof ToolError) return e;
    throw e;
  }
  throw new Error("expected a ToolError");
}

describe("whoami", () => {
  it("returns name, meta-address, payer balances and caps; never a key", async () => {
    const { ctx, state } = makeCtx();
    state.data.identity = { label: "ledger-bot", name: "ledger-bot.soapay.eth", registrant: agentKeys.registrantAddress };
    const out = await whoami(ctx);
    expect(out).toMatchObject({
      name: "ledger-bot.soapay.eth",
      metaAddress: agentKeys.metaAddressURI,
      payer: { address: PAYER, usdc: "100", eth: "0.1" },
      guardrails: { maxPerCallUsdc: "10", maxPerDayUsdc: "15", remainingTodayUsdc: "15", payeeAllowlist: null },
    });
    const text = JSON.stringify(out);
    for (const secret of [agentKeys.spendingKey, agentKeys.viewingKey, agentKeys.registrantKey]) expect(text).not.toContain(secret.slice(2));
    expect(text).not.toContain("junk");
  });

  it("works without keys", async () => {
    const { ctx } = makeCtx({ keys: false, payer: false });
    expect(await whoami(ctx)).toMatchObject({ name: null, metaAddress: null, payer: null });
  });
});

describe("resolve_name", () => {
  it("resolves through the SDK path and reports pin/allowlist state", async () => {
    const { ctx, chain } = makeCtx({ env: { PAYEE_ALLOWLIST: "alice.soapay.eth" } });
    expect(await resolveName(ctx, { name: "Alice.Soapay.eth" })).toMatchObject({
      name: "alice.soapay.eth",
      metaAddress: alice.metaAddressURI,
      pinned: null,
      allowlisted: true,
    });
    expect(chain.resolveName).toHaveBeenCalledWith("alice.soapay.eth");
  });

  it("maps SDK name errors to codes", async () => {
    const { ctx } = makeCtx();
    expect((await err(resolveName(ctx, { name: "nobody.soapay.eth" }))).code).toBe("name_not_found");
  });
});

describe("create_agent_identity", () => {
  it("registers the meta-address, then claims the name with ENSIP-26 records", async () => {
    const { ctx, api, state } = makeCtx();
    const out = await createAgentIdentity(ctx, {
      label: "ledger-bot",
      description: "Books invoices and pays contractors.",
      capabilities: ["pay", "scan"],
      endpoints: { mcp: "https://mcp.example/soapay" },
    });
    expect(api.register).toHaveBeenCalledTimes(1);
    const reg = api.register.mock.calls[0]![0] as { registrant: string; metaAddress: string; signature: Hex };
    expect(reg).toMatchObject({ registrant: agentKeys.registrantAddress, metaAddress: agentKeys.metaAddressURI });

    const claim = api.claimName.mock.calls[0]![0] as any;
    expect(claim).toMatchObject({ label: "ledger-bot", registrant: agentKeys.registrantAddress, metaAddress: agentKeys.metaAddressURI });
    expect(claim.agent.endpoints).toEqual({ mcp: "https://mcp.example/soapay" });
    const context = JSON.parse(claim.agent.context);
    expect(context).toMatchObject({ name: "ledger-bot.soapay.eth", description: "Books invoices and pays contractors.", capabilities: ["pay", "scan"] });

    expect(out).toMatchObject({ name: "ledger-bot.soapay.eth", created: true });
    expect(Object.keys(out.records!)).toEqual(["agent-context", "agent-endpoint[mcp]"]);
    expect(state.data.identity?.name).toBe("ledger-bot.soapay.eth");
    expect(JSON.stringify(out)).not.toContain(agentKeys.registrantKey.slice(2));
  });

  it("is idempotent for a label it already owns and refuses someone else's", async () => {
    const { ctx, api, registry } = makeCtx();
    await createAgentIdentity(ctx, { label: "ledger-bot" });
    expect((await createAgentIdentity(ctx, { label: "ledger-bot" })).created).toBe(false);
    expect(api.claimName).toHaveBeenCalledTimes(1);
    registry.set("taken", { label: "taken", name: "taken.soapay.eth", registrant: getAddress("0x3333333333333333333333333333333333333333"), metaAddress: "", txHash: null });
    expect((await err(createAgentIdentity(ctx, { label: "taken" }))).code).toBe("label_taken");
  });

  it("treats an already-registered meta-address as fine and surfaces API errors", async () => {
    const { ctx, api } = makeCtx();
    api.register.mockRejectedValueOnce(new ApiError(409, "already_registered", "already"));
    expect((await createAgentIdentity(ctx, { label: "bot-one" })).registration).toEqual({ status: "already_registered" });
    api.claimName.mockRejectedValueOnce(new ApiError(409, "meta_mismatch", "no"));
    expect((await err(createAgentIdentity(ctx, { label: "bot-two" }))).code).toBe("names_meta_mismatch");
  });

  it("needs AGENT_MNEMONIC and a valid label", async () => {
    expect((await err(createAgentIdentity(makeCtx({ keys: false }).ctx, { label: "bot" }))).code).toBe("not_configured");
    expect((await err(createAgentIdentity(makeCtx().ctx, { label: "-bad" }))).code).toBe("invalid_label");
  });
});

const disperseAbi = stealthDisperseAbi;

describe("pay", () => {
  const payments = [
    { name: "alice.soapay.eth", amount: "2" },
    { name: "bob.soapay.eth", amount: 1.5 },
  ];

  it("dry run returns a plan and sends nothing; confirm approves the exact total then pays", async () => {
    const { ctx, chain, state } = makeCtx();
    const plan = await pay(ctx, { payments });
    expect(plan).toMatchObject({ totalUsdc: "3.5", lineCount: 2, txCount: 2 });
    expect(plan.lines.map((l: any) => l.name).sort()).toEqual(["alice.soapay.eth", "bob.soapay.eth"]);
    // Lines are sorted by stealth address, independent of names.
    const addrs = plan.lines.map((l: any) => BigInt(l.stealthAddress));
    expect(addrs[0]! < addrs[1]!).toBe(true);
    expect(chain.sendTransaction).not.toHaveBeenCalled();
    // Names are pinned at first use.
    expect(state.data.pins).toEqual({ "alice.soapay.eth": alice.metaAddressURI, "bob.soapay.eth": bob.metaAddressURI });

    const out = await pay(ctx, { confirm: plan.planId });
    expect(out.ok).toBe(true);
    expect(out.steps.map((s: any) => s.status)).toEqual(["landed", "landed"]);
    const [approve, payTx] = chain.sendTransaction.mock.calls.map((c) => c[0] as { to: string; data: Hex });
    expect(approve!.to).toBe(USDC);
    expect(decodeFunctionData({ abi: erc20Abi, data: approve!.data }).args).toEqual([DISPERSE, u(3.5)]);
    expect(payTx!.to).toBe(DISPERSE);
    const decoded = decodeFunctionData({ abi: disperseAbi, data: payTx!.data });
    expect(decoded.functionName).toBe("pay");
    const lines = (decoded.args as any)[1] as { head: bigint }[];
    expect(lines.map((l: any) => decodeHead(l.head).amount).reduce((a, b) => a + b, 0n)).toBe(u(3.5));
    // The allowance was read back before paying.
    expect(chain.allowance.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(ctx.caps.spentToday(ctx.now())).toBe(u(3.5));
  });

  it("skips the approval when the allowance already equals the total", async () => {
    const { ctx, chain, setAllowance } = makeCtx();
    const plan = await pay(ctx, { payments });
    setAllowance(u(3.5));
    const out = await pay(ctx, { confirm: plan.planId });
    expect(out.steps[0]).toEqual({ step: "approve", status: "skipped" });
    expect(chain.sendTransaction).toHaveBeenCalledTimes(1);
  });

  it("waits until the approval is visible before paying", async () => {
    const { ctx, chain } = makeCtx();
    let reads = 0;
    chain.allowance.mockImplementation(async () => (++reads < 4 ? 0n : u(3.5)));
    const plan = await pay(ctx, { payments });
    const out = await pay(ctx, { confirm: plan.planId });
    expect(out.ok).toBe(true);
    expect(reads).toBeGreaterThanOrEqual(4);
  });

  it("plans are single-use and expire after 10 minutes", async () => {
    const { ctx, chain, advance } = makeCtx();
    const a = await pay(ctx, { payments });
    await pay(ctx, { confirm: a.planId });
    expect((await err(pay(ctx, { confirm: a.planId }))).code).toBe("plan_used");
    const b = await pay(ctx, { payments });
    advance(601);
    expect((await err(pay(ctx, { confirm: b.planId }))).code).toBe("plan_expired");
    expect(chain.sendTransaction).toHaveBeenCalledTimes(2); // only the first plan's approve + pay
  });

  it("dry_run: false still only plans", async () => {
    const { ctx, chain } = makeCtx();
    const plan = await pay(ctx, { payments, dry_run: false });
    expect(plan.planId).toMatch(/^pay_/);
    expect(chain.sendTransaction).not.toHaveBeenCalled();
  });

  it("enforces per-call and per-day caps", async () => {
    const { ctx } = makeCtx();
    expect((await err(pay(ctx, { payments: [{ name: "alice.soapay.eth", amount: "10.01" }] }))).code).toBe("cap_per_call");
    const p = await pay(ctx, { payments: [{ name: "alice.soapay.eth", amount: "9" }] });
    await pay(ctx, { confirm: p.planId });
    expect((await err(pay(ctx, { payments: [{ name: "bob.soapay.eth", amount: "7" }] }))).code).toBe("cap_per_day");
    // A plan made before the day filled up is re-checked at confirm.
    const { ctx: c2 } = makeCtx();
    const x = await pay(c2, { payments: [{ name: "alice.soapay.eth", amount: "9" }] });
    const y = await pay(c2, { payments: [{ name: "alice.soapay.eth", amount: "9" }] });
    await pay(c2, { confirm: x.planId });
    expect((await err(pay(c2, { confirm: y.planId }))).code).toBe("cap_per_day");
  });

  it("enforces the payee allowlist", async () => {
    const { ctx } = makeCtx({ env: { PAYEE_ALLOWLIST: "alice.soapay.eth" } });
    expect((await err(pay(ctx, { payments }))).code).toBe("not_allowlisted");
    expect((await pay(ctx, { payments: [payments[0]!] })).lineCount).toBe(1);
  });

  it("refuses a name whose meta-address changed after pinning", async () => {
    const names = { "alice.soapay.eth": alice.metaAddressURI };
    const { ctx, chain } = makeCtx({ names });
    await pay(ctx, { payments: [{ name: "alice.soapay.eth", amount: "1" }] });
    names["alice.soapay.eth"] = keysFromMnemonic(AGENT_MNEMONIC, "rotated").metaAddressURI;
    const e = await err(pay(ctx, { payments: [{ name: "alice.soapay.eth", amount: "1" }] }));
    expect(e.code).toBe("pin_changed");
    expect(chain.sendTransaction).not.toHaveBeenCalled();
  });

  it("re-checks pins at confirm", async () => {
    const names = { "alice.soapay.eth": alice.metaAddressURI };
    const { ctx, chain } = makeCtx({ names });
    const p = await pay(ctx, { payments: [{ name: "alice.soapay.eth", amount: "1" }] });
    names["alice.soapay.eth"] = bob.metaAddressURI;
    expect((await err(pay(ctx, { confirm: p.planId }))).code).toBe("pin_changed");
    expect(chain.sendTransaction).not.toHaveBeenCalled();
  });

  it("stops at the first failed transaction", async () => {
    const { ctx, chain } = makeCtx();
    chain.waitForReceipt.mockResolvedValueOnce("reverted");
    const p = await pay(ctx, { payments });
    const out = await pay(ctx, { confirm: p.planId });
    expect(out.ok).toBe(false);
    expect(out.steps[0]).toMatchObject({ step: "approve", status: "failed" });
    expect(chain.sendTransaction).toHaveBeenCalledTimes(1);
  });

  it("needs a payer key and valid input", async () => {
    expect((await err(pay(makeCtx({ payer: false }).ctx, { payments }))).code).toBe("not_configured");
    expect((await err(pay(makeCtx().ctx, {}))).code).toBe("invalid_input");
  });
});

describe("scan / balance", () => {
  it("finds the agent's payments with real balances and the known payer", async () => {
    const anns = [...paymentsToAgent([1, 2.5], { payer: PAYER }), ...paymentsToAgent([4], { txHash: `0x${"ee".repeat(32)}` })];
    // Someone else's payment in the same run is not matched.
    const other = paymentsToAgent([9]).map((a) => ({ ...a, ephemeralPubKey: `0x02${"11".repeat(32)}` as Hex }));
    const { ctx, chain } = makeCtx({ announcements: [...anns, ...other], env: { KNOWN_PAYERS: EMPLOYER } });
    const out = await scan(ctx);
    expect(out.matches).toBe(3);
    expect(out.totalUsdc).toBe("7.5");
    expect(out.payments.every((p) => p.payerKnown)).toBe(true);
    expect(chain.verifyBalances).toHaveBeenCalledTimes(1);

    const b = await balance(ctx);
    expect(b).toMatchObject({ totalUsdc: "7.5", addresses: 3 });
    expect(b.clusters).toHaveLength(3); // nothing linked yet
  });

  it("flags unknown payers and trusts balances over metadata", async () => {
    const anns = paymentsToAgent([5]);
    const { ctx, chain } = makeCtx({ announcements: anns });
    chain.balances.set(anns[0]!.stealthAddress.toLowerCase(), u(1));
    const out = await scan(ctx);
    expect(out.payments[0]).toMatchObject({ balanceUsdc: "1", claimedAmountUsdc: "5", payerKnown: false });
    expect(out.payments[0]!.flags).toEqual(expect.arrayContaining(["unknown-payer", "hint-amount-mismatch"]));
  });
});

describe("spend", () => {
  it("to an address: guard warns when merging clusters; confirm sends one userOp per address", async () => {
    const anns = paymentsToAgent([3, 3]);
    const { ctx, chain, state } = makeCtx({ announcements: anns });
    const dest = getAddress("0x9999999999999999999999999999999999999999");
    const plan = await spend(ctx, { to: dest, amount: "5" });
    expect(plan.decision).toBe("warn");
    expect(plan.warnings.map((w: any) => w.code)).toContain("merge-clusters");
    expect(plan.parts).toHaveLength(2);
    expect(chain.spendMany).not.toHaveBeenCalled();

    const out = await spend(ctx, { confirm: plan.planId! });
    expect(out.ok).toBe(true);
    const spends = chain.spendMany.mock.calls[0]![0] as { to: string; amount: bigint; stealthKey: Hex }[];
    expect(spends.map((s) => s.to)).toEqual([dest, dest]);
    expect(spends.reduce((s, x) => s + x.amount, 0n)).toBe(u(5));
    // Keys never appear in the tool output.
    for (const s of spends) expect(JSON.stringify(out)).not.toContain(s.stealthKey.slice(2));
    // The guard graph records the new link.
    const g = ClusterGraph.fromJSON(state.data.guard!);
    expect(g.clusterOf(anns[0]!.stealthAddress)).toBe(g.clusterOf(anns[1]!.stealthAddress));
    expect(ctx.caps.spentToday(ctx.now())).toBe(u(5));
  });

  it("a single covering address is allowed without warnings", async () => {
    const { ctx } = makeCtx({ announcements: paymentsToAgent([3, 8]) });
    const plan = await spend(ctx, { to: "0x9999999999999999999999999999999999999999", amount: "2" });
    expect(plan.decision).toBe("allow");
    expect(plan.parts).toHaveLength(1);
  });

  it("blocks sending to the agent's own payer wallet (identifiable) with no planId and no override", async () => {
    const { ctx, chain } = makeCtx({ announcements: paymentsToAgent([3]) });
    const plan = await spend(ctx, { to: PAYER, amount: "1" });
    expect(plan.decision).toBe("block");
    expect(plan.reason).not.toMatch(/override/i);
    expect(plan.planId).toBeNull();
    expect(chain.spendMany).not.toHaveBeenCalled();
  });

  it("re-checks the guard at confirm", async () => {
    const { ctx, chain, state } = makeCtx({ announcements: paymentsToAgent([3]), env: { IDENTIFIABLE_ADDRESSES: "0x8888888888888888888888888888888888888888" } });
    const dest = getAddress("0x7777777777777777777777777777777777777777");
    const plan = await spend(ctx, { to: dest, amount: "1" });
    expect(plan.decision).toBe("allow");
    // Meanwhile the destination got labelled as the owner's main wallet.
    const g = ClusterGraph.fromJSON(state.data.guard!);
    g.setLabel(dest, "main-wallet");
    state.data.guard = g.toJSON();
    expect((await err(spend(ctx, { confirm: plan.planId! }))).code).toBe("guard_block");
    expect(chain.spendMany).not.toHaveBeenCalled();
  });

  it("to a name: each part goes to its own fresh stealth address with an announcement", async () => {
    const { ctx, chain } = makeCtx({ announcements: paymentsToAgent([3, 3]) });
    const plan = await spend(ctx, { to: "alice.soapay.eth", amount: "5" });
    expect(plan.decision).toBe("allow"); // fresh destinations link nothing
    const dests = plan.parts.map((p: any) => p.toStealthAddress);
    expect(new Set(dests).size).toBe(2);
    const out = await spend(ctx, { confirm: plan.planId! });
    expect(out.ok).toBe(true);
    expect(chain.execute).toHaveBeenCalledTimes(2);
    for (const call of chain.execute.mock.calls) {
      const p = call[0] as { calls: { to: string; data: Hex }[]; feeTokenSpend: bigint };
      expect(p.calls[0]!.to).toBe(USDC);
      const [to, amt] = decodeFunctionData({ abi: erc20Abi, data: p.calls[0]!.data }).args as [string, bigint];
      expect(dests).toContain(to);
      expect(p.feeTokenSpend).toBe(amt);
      const ann = decodeFunctionData({ abi: announcerAbi, data: p.calls[1]!.data });
      expect(ann.functionName).toBe("announce");
      expect(ann.args[1]).toBe(to);
    }
  });

  it("respects caps, the allowlist and the balance", async () => {
    const { ctx } = makeCtx({ announcements: paymentsToAgent([3]), env: { PAYEE_ALLOWLIST: "alice.soapay.eth" } });
    expect((await err(spend(ctx, { to: "0x9999999999999999999999999999999999999999", amount: "1" }))).code).toBe("not_allowlisted");
    expect((await err(spend(ctx, { to: "bob.soapay.eth", amount: "1" }))).code).toBe("not_allowlisted");
    expect((await err(spend(ctx, { to: "alice.soapay.eth", amount: "11" }))).code).toBe("cap_per_call");
    expect((await err(spend(ctx, { to: "alice.soapay.eth", amount: "4" }))).code).toBe("insufficient_funds");
    // 3 USDC held, 0.05 fee: 2.95 is the most one address can deliver.
    expect((await err(spend(ctx, { to: "alice.soapay.eth", amount: "3" }))).code).toBe("insufficient_funds");
    expect((await spend(ctx, { to: "alice.soapay.eth", amount: "2.95" })).decision).toBe("allow");
  });
});

describe("swap_in_place", () => {
  it("quotes from one covering address, then executes the re-quoted calls", async () => {
    const anns = paymentsToAgent([1, 5]);
    const { ctx, chain } = makeCtx({ announcements: anns });
    const plan = await swapInPlace(ctx, { tokenOut: "ETH", amount: "2" });
    const five = anns.find((a) => a.metadata.includes((5_000_000).toString(16).padStart(64, "0")))!;
    expect(plan.stealthAddress).toBe(five.stealthAddress);
    expect(chain.execute).not.toHaveBeenCalled();
    const out = await swapInPlace(ctx, { confirm: plan.planId });
    expect(out.ok).toBe(true);
    expect((chain.execute.mock.calls[0]![0] as { feeTokenSpend: bigint }).feeTokenSpend).toBe(u(2));
  });

  it("refuses to confirm below the planned minimum output", async () => {
    const { ctx, chain } = makeCtx({ announcements: paymentsToAgent([5]) });
    const plan = await swapInPlace(ctx, { tokenOut: "ETH", amount: "2" });
    const orig = chain.quoteSwap.getMockImplementation() as (p: any) => Promise<any>;
    chain.quoteSwap.mockImplementationOnce(async (p: any) => ({ ...(await orig(p)), minOut: 900n }));
    expect((await err(swapInPlace(ctx, { confirm: plan.planId }))).code).toBe("price_moved");
    expect(chain.execute).not.toHaveBeenCalled();
  });

  it("never combines addresses and checks input", async () => {
    const { ctx } = makeCtx({ announcements: paymentsToAgent([1, 1]) });
    expect((await err(swapInPlace(ctx, { tokenOut: "ETH", amount: "1.5" }))).code).toBe("insufficient_funds");
    expect((await err(swapInPlace(ctx, { tokenOut: "DOGE", amount: "1" }))).code).toBe("invalid_token");
    expect((await err(swapInPlace(ctx, { tokenOut: USDC, amount: "0.5" }))).code).toBe("invalid_token");
    expect((await err(swapInPlace(ctx, { tokenOut: "ETH", amount: "0.5", slippage_bps: 900 }))).code).toBe("invalid_input");
  });
});

