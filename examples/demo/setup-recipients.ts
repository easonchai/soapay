// One-time setup for the "plug it into anything" demo: gives each demo dividend holder a soapay
// name, the same way the recipient app does (sponsored ERC-6538 registration through the API
// relayer, then an ENSv2 subname claim), and writes examples/demo/holders.csv.
//
//   SOAPAY_API=http://localhost:8787 pnpm --filter @soapay/examples demo:setup
//
// Idempotent: names that already belong to the holder are skipped. Phrases stay in the git-ignored
// scripts/.demo-recipients.local.json and are never printed.
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createPublicClient, http } from "viem";
import {
  getChain,
  getRegistryNonce,
  keysFromMnemonic,
  PARENT_NAME,
  resolveStealthMeta,
  signNameClaim,
  signRegisterKeysOnBehalf,
  type RegistryReader,
} from "@soapay/sdk";
import { c, loadOrCreateLocal, metaOf, REPO, short } from "./local.js";

const API = (process.env.SOAPAY_API ?? "http://localhost:8787").replace(/\/+$/, "");
const CHAIN_ID = 84532;
const chain = getChain(CHAIN_ID);
const base = createPublicClient({ chain: chain.chain, transport: http(process.env.RPC_URL, { retryCount: 3 }) });
const ens = createPublicClient({
  chain: chain.ensChain!,
  transport: http(process.env.ENS_RPC_URL ?? "https://ethereum-sepolia-rpc.publicnode.com", { retryCount: 3 }),
});

async function api(path: string, body?: unknown): Promise<{ status: number; body: any }> {
  const res = await fetch(`${API}${path}`, body === undefined ? undefined : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return { status: res.status, body: await res.json().catch(() => null) };
}

async function claim(label: string, phrase: string): Promise<void> {
  const keys = keysFromMnemonic(phrase);
  const name = `${label}.${PARENT_NAME}`;
  // Already ours on-chain (whichever API issued it)?
  const onchain = await resolveStealthMeta({ ensClient: ens, baseClient: base as unknown as RegistryReader, name }).catch(() => null);
  if (onchain?.metaAddressURI === keys.metaAddressURI) {
    console.log(`  ${name.padEnd(28)} ${c.dim("already claimed")}`);
    return;
  }
  const existing = await api(`/names/${label}`);
  if (existing.status === 200) {
    if (existing.body.registrant?.toLowerCase() !== keys.registrantAddress.toLowerCase()) throw new Error(`${name} belongs to someone else; pick another label`);
    console.log(`  ${name.padEnd(28)} ${c.dim("already claimed")}`);
    return;
  }

  // 1. Sponsored ERC-6538 registration: the registrant key signs, the API relays and pays gas.
  const nonce = await getRegistryNonce(base as unknown as RegistryReader, keys.registrantAddress);
  const regSig = await signRegisterKeysOnBehalf({ registrantKey: keys.registrantKey, metaAddressURI: keys.metaAddressURI, chainId: CHAIN_ID, nonce });
  const reg = await api("/register", { registrant: keys.registrantAddress, metaAddress: keys.metaAddressURI, signature: regSig });
  if (reg.status !== 200 && reg.body?.error?.code !== "already_registered") throw new Error(`POST /register: ${reg.body?.error?.message ?? reg.status}`);

  // 2. ENSv2 subname with the `stealth` record, issued by the API's issuer on Ethereum Sepolia.
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);
  const sig = await signNameClaim({ label, registrant: keys.registrantAddress, metaAddress: keys.metaAddressURI, deadline, chainId: CHAIN_ID, registrantKey: keys.registrantKey });
  const res = await api("/names", { label, registrant: keys.registrantAddress, metaAddress: keys.metaAddressURI, deadline: deadline.toString(), signature: sig });
  if (res.status !== 200 && res.status !== 201) throw new Error(`POST /names ${label}: ${res.body?.error?.message ?? res.status}`);
  console.log(`  ${name.padEnd(28)} ${c.green("claimed")} ${c.dim(`register ${reg.body?.txHash ?? "(already)"} · name ${res.body?.txHash ?? ""}`)}`);
}

async function verify(label: string, phrase: string): Promise<void> {
  const name = `${label}.${PARENT_NAME}`;
  for (let i = 0; ; i++) {
    try {
      const r = await resolveStealthMeta({ ensClient: ens, baseClient: base as unknown as RegistryReader, name });
      if (r.metaAddressURI !== metaOf(phrase)) throw new Error(`${name} resolves to a different meta-address`);
      console.log(`  ${name.padEnd(28)} ${c.green("resolves")} ${c.dim(short(r.metaAddressURI))} ${c.dim("(ENS stealth = ERC-6538)")}`);
      return;
    } catch (e) {
      if (i >= 10) throw e;
      await new Promise((r) => setTimeout(r, 3_000));
    }
  }
}

const local = loadOrCreateLocal();
console.log(c.bold(`Demo holders (API ${API})`));
for (const h of local.holders) await claim(h.label, h.phrase);
for (const h of local.holders) await verify(h.label, h.phrase);

// The AI agent is a holder like the others: one pay run, indistinguishable lines. Its name is
// claimed by `demo:agent claim` (through the MCP server), which the demo script runs first.
const rows = [
  "# Revenue-share register for the Soapay demo (public data only): three people, one raw meta-address, one AI agent.",
  "# recipient = a soapay name (resolved on ENSv2, cross-checked against ERC-6538) or a raw meta-address.",
  "recipient,holdings,id",
  ...local.holders.map((h, i) => `${h.label}.${PARENT_NAME},${[4000, 2500, 1500][i] ?? 1000},${h.label.replace(/^dividend-/, "")}`),
  `${metaOf(local.rawHolder.phrase)},500,${local.rawHolder.id}`,
  `${local.agent.label}.${PARENT_NAME},1500,${local.agent.label}`,
];
const csvPath = resolve(REPO, "examples/demo/holders.csv");
writeFileSync(csvPath, `${rows.join("\n")}\n`);
console.log(`Wrote ${csvPath}`);
