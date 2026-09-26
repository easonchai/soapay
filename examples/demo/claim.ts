// Claims a soapay name the way the recipient app does: a sponsored ERC-6538 registration through the
// API relayer, then an ENSv2 subname with the `stealth` record. Shared by the demo setup scripts.
// Idempotent; phrases never leave this process except as signatures.
import { createPublicClient, http, type Address, type Chain, type Hex, type PublicClient, type Transport } from "viem";
import {
  ERC6538_REGISTRY,
  erc6538RegistryMinimalAbi,
  getChain,
  getRegistryNonce,
  keysFromMnemonic,
  PARENT_NAME,
  parseMetaAddress,
  resolveStealthMeta,
  signNameClaim,
  signRegisterKeysOnBehalf,
  type RegistryReader,
} from "@soapay/sdk";
import { c, metaOf, short } from "./local.js";

export const CHAIN_ID = 84532;
const chain = getChain(CHAIN_ID);

export const BASE_RPC_URL = process.env.RPC_URL || chain.chain.rpcUrls.default.http[0]!;
export const ENS_RPC_URL = process.env.ENS_RPC_URL || "https://ethereum-sepolia-rpc.publicnode.com";
export const baseClient: PublicClient<Transport, Chain> = createPublicClient({ chain: chain.chain, transport: http(BASE_RPC_URL, { retryCount: 3 }) });
export const ensClient: PublicClient<Transport, Chain> = createPublicClient({ chain: chain.ensChain!, transport: http(ENS_RPC_URL, { retryCount: 3 }) });

/**
 * Submits a signed ERC-6538 `registerKeysOnBehalf` from a wallet we control and returns the tx hash.
 * The fallback when the API relayer rate-limits (POST /register allows 3 per IP per hour): the
 * registrant's signature is the same, only who pays the gas changes.
 */
export type SelfRegister = (reg: { registrant: Address; metaAddressURI: string; signature: Hex }) => Promise<string>;

export function nameClaimer(apiUrl: string, opts: { selfRegister?: SelfRegister; waitOnNamesLimit?: boolean } = {}) {
  const API = apiUrl.replace(/\/+$/, "");

  async function api(path: string, body?: unknown): Promise<{ status: number; body: any }> {
    const res = await fetch(
      `${API}${path}`,
      body === undefined ? undefined : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) },
    );
    return { status: res.status, body: await res.json().catch(() => null) };
  }

  async function selfRegistered(name: string, registrant: Address, metaAddressURI: string, signature: Hex): Promise<{ status: number; body: any }> {
    console.log(`  ${name.padEnd(28)} ${c.dim("relayer rate-limited; submitting the signed registration ourselves")}`);
    const txHash = await opts.selfRegister!({ registrant, metaAddressURI, signature });
    return { status: 200, body: { txHash } };
  }

  async function claim(label: string, phrase: string): Promise<"claimed" | "existing"> {
    const keys = keysFromMnemonic(phrase);
    const name = `${label}.${PARENT_NAME}`;
    // Already ours on-chain (whichever API issued it)?
    const onchain = await resolveStealthMeta({ ensClient, baseClient: baseClient as unknown as RegistryReader, name }).catch(() => null);
    if (onchain?.metaAddressURI === keys.metaAddressURI) {
      console.log(`  ${name.padEnd(28)} ${c.dim("already claimed")}`);
      return "existing";
    }
    const existing = await api(`/names/${label}`);
    if (existing.status === 200) {
      if (existing.body.registrant?.toLowerCase() !== keys.registrantAddress.toLowerCase()) throw new Error(`${name} belongs to someone else; pick another label`);
      console.log(`  ${name.padEnd(28)} ${c.dim("already claimed")}`);
      return "existing";
    }

    // 1. Sponsored ERC-6538 registration: the registrant key signs, the API relays and pays gas.
    //    Skipped when the registry already holds this meta-address (a re-run after a partial claim).
    const registered = await baseClient
      .readContract({ address: ERC6538_REGISTRY, abi: erc6538RegistryMinimalAbi, functionName: "stealthMetaAddressOf", args: [keys.registrantAddress, 1n] })
      .then((b) => String(b).toLowerCase() === parseMetaAddress(keys.metaAddressURI).toLowerCase())
      .catch(() => false);
    let reg: { status: number; body: any } = { status: 409, body: { error: { code: "already_registered" } } };
    if (!registered) {
      const nonce = await getRegistryNonce(baseClient as unknown as RegistryReader, keys.registrantAddress);
      const regSig = await signRegisterKeysOnBehalf({ registrantKey: keys.registrantKey, metaAddressURI: keys.metaAddressURI, chainId: CHAIN_ID, nonce });
      reg = await api("/register", { registrant: keys.registrantAddress, metaAddress: keys.metaAddressURI, signature: regSig });
      if (reg.status === 429 && opts.selfRegister) reg = await selfRegistered(name, keys.registrantAddress, keys.metaAddressURI, regSig);
    }
    if (reg.status !== 200 && reg.body?.error?.code !== "already_registered") throw new Error(`POST /register: ${reg.body?.error?.message ?? reg.status}`);

    // 2. ENSv2 subname with the `stealth` record, issued by the API's issuer on Ethereum Sepolia.
    // Signed fresh per attempt: a wait for the rate-limit window could outlive a one-hour deadline.
    const postClaim = async () => {
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);
      const sig = await signNameClaim({ label, registrant: keys.registrantAddress, metaAddress: keys.metaAddressURI, deadline, chainId: CHAIN_ID, registrantKey: keys.registrantKey });
      return api("/names", { label, registrant: keys.registrantAddress, metaAddress: keys.metaAddressURI, deadline: deadline.toString(), signature: sig });
    };
    let res = await postClaim();
    // POST /names allows 10 claims per IP per hour. When opted in, wait the window out instead of failing.
    for (let i = 0; res.status === 429 && opts.waitOnNamesLimit && i < 3; i++) {
      const secs = Number(/retry in (\d+)s/.exec(res.body?.error?.message ?? "")?.[1] ?? 600);
      if (secs > 3_700) break;
      console.log(`  ${name.padEnd(28)} ${c.dim(`name claims rate-limited; waiting ${Math.ceil(secs / 60)} min`)}`);
      await new Promise((r) => setTimeout(r, (secs + 5) * 1_000));
      res = await postClaim();
    }
    // Issuance is two Sepolia txs; a proxy can time out (bare 502) while the API finishes. Wait for the row.
    for (let i = 0; res.status >= 500 && !res.body?.error && i < 20; i++) {
      await new Promise((r) => setTimeout(r, 6_000));
      const got = await api(`/names/${label}`);
      if (got.status === 200) res = got;
    }
    if (res.status !== 200 && res.status !== 201) throw new Error(`POST /names ${label}: ${res.body?.error?.message ?? res.status}`);
    console.log(`  ${name.padEnd(28)} ${c.green("claimed")} ${c.dim(`register ${reg.body?.txHash ?? "(already)"} · name ${res.body?.txHash ?? ""}`)}`);
    return "claimed";
  }

  /** Waits until the name resolves (ENS `stealth` record = ERC-6538 entry) to the phrase's meta-address. */
  async function verify(label: string, phrase: string): Promise<void> {
    const name = `${label}.${PARENT_NAME}`;
    for (let i = 0; ; i++) {
      try {
        const r = await resolveStealthMeta({ ensClient, baseClient: baseClient as unknown as RegistryReader, name });
        if (r.metaAddressURI !== metaOf(phrase)) throw new Error(`${name} resolves to a different meta-address`);
        console.log(`  ${name.padEnd(28)} ${c.green("resolves")} ${c.dim(short(r.metaAddressURI))} ${c.dim("(ENS stealth = ERC-6538)")}`);
        return;
      } catch (e) {
        if (i >= 10) throw e;
        await new Promise((r) => setTimeout(r, 3_000));
      }
    }
  }

  return { api, claim, verify };
}
