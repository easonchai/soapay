import { createPublicClient, createWalletClient, http, erc20Abi, type Hex } from "viem";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { baseSepolia, sepolia } from "viem/chains";
import { readFileSync } from "node:fs";
import {
  generateMnemonic, keysFromMnemonic, getRegistryNonce, signRegisterKeysOnBehalf, signNameClaim, resolveStealthMeta,
  derivePayRun, encodeStealthDisperseCalls, fetchAnnouncements, scanAnnouncements, verifyBalances, buildLedger,
  deriveStealthKey, createSpendClient, spendFromStealth, pimlicoFeesPerGas, ClusterGraph, planSpend,
} from "./src/index.js";
const API = "http://localhost:8787", RPC = "https://sepolia.base.org";
const USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e" as const, SD = "0x6B7a1cC570Af2DDd427DA694351438F0FE8039CA" as const;
const env = Object.fromEntries(readFileSync("../../contracts/.env", "utf8").split("\n").filter(Boolean).map((l) => l.split("=") as [string, string]));
const employer = privateKeyToAccount(env.DEPLOYER_PRIVATE_KEY as Hex);
const base = createPublicClient({ chain: baseSepolia, transport: http(RPC) });
const ens = createPublicClient({ chain: sepolia, transport: http("https://ethereum-sepolia-rpc.publicnode.com") });
const wallet = createWalletClient({ account: employer, chain: baseSepolia, transport: http(RPC) });
const post = async (p: string, b: unknown) => { const r = await fetch(API + p, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b) }); const j = await r.json(); if (!r.ok) throw new Error(p + " " + JSON.stringify(j)); return j; };
const bal = (a: `0x${string}`) => base.readContract({ address: USDC, abi: erc20Abi, functionName: "balanceOf", args: [a] });
const fmt = (x: bigint) => (Number(x) / 1e6).toFixed(6);

// 1. Onboard two employees through the API (gasless registration + ENSv2 name).
const staff = [{ amount: 3_000_000n }, { amount: 2_500_000n }].map((s) => ({ ...s, keys: keysFromMnemonic(generateMnemonic()), label: "pay" + Math.floor(Math.random() * 1e6) }));
for (const s of staff) {
  const k = s.keys;
  await post("/register", { registrant: k.registrantAddress, metaAddress: k.metaAddressURI, signature: await signRegisterKeysOnBehalf({ registrantKey: k.registrantKey, metaAddressURI: k.metaAddressURI, chainId: 84532, nonce: await getRegistryNonce(base, k.registrantAddress) }) });
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);
  await post("/names", { label: s.label, registrant: k.registrantAddress, metaAddress: k.metaAddressURI.toLowerCase(), deadline: deadline.toString(), signature: await signNameClaim({ label: s.label, registrant: k.registrantAddress, metaAddress: k.metaAddressURI.toLowerCase(), deadline, chainId: 84532, registrantKey: k.registrantKey } as never) });
  console.log("1 onboarded", s.label + ".soapay.eth");
}
// 2. Employer enrolls by NAME: resolve through ENSv2 and pin.
const pinned = [];
for (const s of staff) { const r = await resolveStealthMeta({ ensClient: ens, baseClient: base, name: `${s.label}.soapay.eth` } as never); pinned.push(r.metaAddressURI); }
console.log("2 pinned", pinned.length, "meta-addresses via ENSv2");
// 3. Pay run through StealthDisperse (approve exact total + pay).
const lines = derivePayRun({ recipients: staff.map((s, i) => ({ metaAddressURI: pinned[i]!, amount: s.amount, id: s.label })) });
const calls = encodeStealthDisperseCalls({ stealthDisperse: SD, token: USDC, lines });
for (const c of [calls.approve, ...calls.pays]) {
  const h = await wallet.sendTransaction(c); const r = await base.waitForTransactionReceipt({ hash: h }); console.log("3 tx", r.status, `https://sepolia.basescan.org/tx/${h}`);
  if (c === calls.approve) for (let i = 0; i < 10 && (await base.readContract({ address: USDC, abi: erc20Abi, functionName: "allowance", args: [employer.address, SD] })) < calls.total; i++) await new Promise((r) => setTimeout(r, 1500));
}
// 4. Each employee scans via the API indexer.
await new Promise((r) => setTimeout(r, 8000));
const { announcements } = await fetchAnnouncements({ apiUrl: API, fromBlock: 47290264n });
for (const s of staff) {
  const m = scanAnnouncements(announcements, { spendingPublicKey: s.keys.spendingPublicKey, viewingPrivateKey: s.keys.viewingKey });
  const ledger = buildLedger(m, await verifyBalances({ client: base as never, matches: m, tokens: [USDC] }), [employer.address], { stealthDisperse: [SD] });
  console.log("4 scan", s.label, "found", m.length, "total", fmt(ledger.reduce((a, x) => a + (x.balance ?? 0n), 0n)), "payerKnown", ledger.every((x) => x.payerKnown));
  (s as any).match = m[0];
}
// 5. First employee spends 1 USDC to a fresh address: 7702 + Pimlico public bundler + Circle paymaster.
const s0 = staff[0]! as any, to = privateKeyToAccount(generatePrivateKey()).address;
const from = s0.match.announcement.stealthAddress;
console.log("5 guard", planSpend(new ClusterGraph().addStealth(from), { from: [from], to }).decision);
const client = createSpendClient({ chainId: 84532, publicClient: base as never, bundlerUrl: "https://public.pimlico.io/v2/84532/rpc", estimateFeesPerGas: pimlicoFeesPerGas });
const res = await spendFromStealth(client, { stealthKey: deriveStealthKey(s0.match, { spendingPrivateKey: s0.keys.spendingKey, viewingPrivateKey: s0.keys.viewingKey }), to, amount: 1_000_000n });
console.log("5 spend delegated", res.delegated, "fee", fmt(res.feeEstimate), `https://sepolia.basescan.org/tx/${res.txHash}`);
console.log("5 dest", fmt(await bal(to)), "stealth left", fmt(await bal(from)), "stealth ETH", await base.getBalance({ address: from }));
