# Bounty integrations: what, why, where, and how to verify

A single page for checking each integration against the prize criteria. Status as of 2026-09-26. "Live" means it ran on a public testnet, not a fork or a mock.

| | ENSv2 | World ID (IDKit) | Uniswap API |
| --- | --- | --- | --- |
| Role in the product | Pay-by-name identity; the employee alone controls where salary goes | Self-service key rotation (salary-redirect protection) | Convert salary *in place* inside a stealth address |
| Live on testnet | **Yes**, end to end | **Partly**: RP and action live, full proof flow not yet run live | **Yes** for swap-in-place (Base Sepolia, on-chain quote); Trading API live on Base mainnet (placeholder-swapper quote, executed on a fork) |
| Deep docs | `contracts/ENSV2.md` | `docs/worldid.md` | `FEEDBACK.md` |

---

## ENSv2 (Sepolia): live

**What:** every employee (and agent) gets `<label>.soapay.eth`, an on-chain ENSv2 subname with its **own Permissioned Resolver**.
- Records `stealth` = the ERC-5564 meta-address and `soapay:registrant`. **`addr` is left unset**, so a plain wallet can't pay a static, linkable address.
- **Enhanced Access Control** gives the employee's registrant key the right to write **only** `stealth` (`ROLE_SET_TEXT` on `keccak256("stealth")`). Soapay's issuer can create names but can't touch existing records.
- Subnames are non-transferable, and the parent can revoke them.
- Agents (MCP) get ENSIP-26 records (`agent-context`, `agent-endpoint[...]`) at issuance: the prize's "agents as namespaces".

**Why it's central, not cosmetic:** the name *is* how an employer pays someone. The sender resolves it once, pins the meta-address, and blocks the line if the record ever changes. Per-record EAC is what makes "only the employee can redirect their salary" enforceable on-chain.

**Where:**
- `packages/sdk/src/ensv2.ts` (issuer, calldata builders, agent records);
- `apps/api/src/issuer.ts` and `routes/names.ts` (issuance in `POST /names`);
- `packages/sdk/src/names.ts` (resolve and pin);
- `contracts/test/ENSv2Names.fork.t.sol`;
- `contracts/tools/ensv2-*.ts`.

**Live proof (Sepolia):**
- `soapay.eth` registered (owner `0xC33FcD38…58dB`, register tx `0xec0e00d3…4726`) with a subname registry at `0x7403C470…7969`; the issuer `0x20E69b1f…068b` holds only ROLE_REGISTRAR.
- `alice.soapay.eth` issued, then the registrant rotated `stealth`, and the new value resolves (`ensv2:issue-demo`).
- API-issued names `pay392111.soapay.eth` and `pay730021.soapay.eth` were resolved by the employer and paid on Base Sepolia (see the Payroll section below).
- Agent name `mcp-agent-7c1e.soapay.eth`: `getEnsText` returns `agent-context` and `agent-endpoint[web]`.
- viem's default Universal Resolver resolves ENSv2 names on Sepolia (`addr` = null).

**Verify yourself:**
```bash
cd contracts && SEPOLIA_RPC_URL=https://ethereum-sepolia-rpc.publicnode.com forge test --match-contract ENSv2 -vv   # 5/5 against the live deployment (fork)
# resolve a live name
node -e 'import("viem").then(async({createPublicClient,http})=>{const{sepolia}=await import("viem/chains");const c=createPublicClient({chain:sepolia,transport:http("https://ethereum-sepolia-rpc.publicnode.com")});console.log(await c.getEnsText({name:"pay392111.soapay.eth",key:"stealth"}))})'
```

**Honest gaps:** ENSIP-25 (the agent-registry binding) is accepted but not set by default, because it only verifies once a live registry such as ERC-8004 lists the name.

---

## World ID (IDKit 4.x): partly live

**What:** one trust moment, **key rotation**. Changing the meta-address behind a name redirects future salary.
- At enrollment the employee may create a **Selfie Check session**.
- A later rotation must prove the *same* session (`proveSession`).
- The API verifies it server-side and signs an EIP-712 `MetaRotation` attestation.
- The sender app **auto-accepts a changed pin only with that attestation** (checked against a pinned attester address). Otherwise the line is blocked ("possible salary redirect") until the employer approves it by hand.

**Why this credential:** rotation asks "is this the same person who enrolled?", which is continuity, not uniqueness. Selfie Check sessions are World's recommended flow for repeat verification. Proof of Human would add an Orb requirement without answering that question better. There's deliberately **no** enrollment gate, since that would force an Orb visit on every employee. It's essential for pseudonymous DAO contributors, where the payer has no other way to confirm a change.

**Where:**
- `apps/api/src/humanVerifier/worldid.ts`, `routes/names.ts` (rotation, session attach, attestations), `routes/worldid.ts` (rp-context, config);
- `packages/worldid-react` (`<HumanCheck mode="create-session"|"rotate">`);
- `packages/sdk/src/rotation.ts` (typed data);
- `apps/sender/src/lib/attestation.ts` (enforcement).

**Alternative paths (the prize requires them)**, all refused and covered by tests:
- no session on the name, or a different person (session mismatch);
- a replayed session nullifier, or an expired or cancelled proof;
- an environment mismatch;
- a late-attached session inside its 72 h cooldown.

**Live proof:**
- RP `rp_3ede5fe1cab9af48` for app `app_0cc7167efe114ac2e0ef7d9827098353` is registered on-chain (production and staging), and action `soapay-enroll` exists in both.
- `GET /api/worldid/config` on the running API returns enabled, with credential `selfie`.
- The sender's attestation gating was shown in mock mode (screenshots): attested → "Re-verified by World ID"; unattested → blocked.

**Not yet live:** a real Selfie Check session created and proved by a human (simulator or World App) against the running API. This is the #1 item to run before judging.

**Verify yourself:** `pnpm --filter @soapay/api test` (the World ID refusal paths) and `pnpm --filter @soapay/sender test` (attestation gating). The debrief is in `docs/worldid.md`.

---

## Uniswap: swap-in-place live on Base Sepolia; Trading API live on mainnet

**What:** an employee converts part of a stealth address's USDC (e.g. to ETH or WETH) **inside the same address**, in one EIP-7702 userOp: `approve` → Permit2 → Universal Router swap, with gas paid in USDC by the Circle paymaster. No funds move between addresses, so no privacy clusters merge. The conversion preference stays local, never in a public record.

**Why it fits:** the PRD's spending flow is "spend without linking". Swapping in place is the one kind of spend that needs no destination at all, so it's privacy-neutral by construction.

**How the Trading API is used (D-27):** `/quote` only, with a fresh random **placeholder swapper** per quote. The SDK never calls `/swap`; it re-encodes the quoted V2/V3 route as Universal Router 2.1.2 commands paying the stealth address. A guard (`assertNoStealthAddress`) refuses any request that would carry the stealth address, so neither Uniswap nor our own API proxy ever sees it. Default on Base mainnet. On Base Sepolia (the API times out there), or for routes it can't rebuild exactly, the SDK quotes on-chain with QuoterV2 instead. Who sees what: [`docs/privacy-model.md`](privacy-model.md).

**Where:**
- `packages/sdk/src/swap.ts` (placeholder-swapper `/quote`, route re-encoder, privacy guard, on-chain QuoterV2 path; any calldata that pays anyone but the stealth address is rejected);
- `packages/sdk/src/spend.ts` (`executeFromStealth`);
- `apps/api` `POST /uniswap/quote` (a proxy so the API key never ships in the browser; `/swap` and `/check_approval` are closed);
- the recipient app's Convert screen.

**Proof (Base mainnet fork, real contracts, `packages/sdk/test/fork.e2e.test.ts`):**
- 20 USDC → 0.007419 WETH at the stealth address;
- 10 USDC → 0.00371 native ETH at the stealth address;
- every tokenOut transfer landed only at the stealth address, and allowances returned to 0;
- the stealth address never held ETH.

**Proof (live Trading API, 2026-09-26):** a real Base mainnet `/quote` through our proxy with a placeholder swapper, re-encoded locally and executed on a Base mainnet fork: 10 USDC → 0.00372 WETH and 10 USDC → 0.00372 native ETH at the stealth address, each above the quoted minimum; the only request body never contained the stealth address (`SWAP_API_URL=http://localhost:8787/uniswap FORK_E2E=1 …`).

**Not yet live:** a Trading API swap broadcast on Base mainnet itself (it runs on a mainnet fork; the testnet demo uses the on-chain quote).

**Prize requirements:** `FEEDBACK.md` at the repo root, with line pointers and live-verified findings: Base Sepolia routing times out upstream; a quote works with a placeholder swapper (now our default); the apparent spec-vs-skill conflict on the `/swap` body resolved (both forms are valid); chain ids accept numbers too. The team must also submit the Uniswap feedback form with a link to FEEDBACK.md.

**Verify yourself:** `FORK_E2E=1 pnpm --filter @soapay/sdk vitest run test/fork.e2e.test.ts`.

---

## Core payroll: live (context for all three)

- **`StealthDisperse`** is deployed on Base Sepolia at `0x6B7a1cC570Af2DDd427DA694351438F0FE8039CA` (CREATE2).
- **Live run:** two employees onboarded via the API with ENSv2 names, then resolved and pinned by the employer, then one pay run ([pay tx](https://sepolia.basescan.org/tx/0x24f23d610d1917905d3896e282243b07a038afb2bf266f94f11f31ea9e5b492d)). Each employee's scan found exactly their own line, and a gasless 7702 spend with the Circle paymaster went through ([spend tx](https://sepolia.basescan.org/tx/0x1167b83dfab7476ac32b286b890fdcfdba396766d9389778568d949cbffc1bae)).
- **Compliant exit** (Privacy Pools): the SDK and UI are built, and the Sepolia fork deposit and ragequit are proven. The live run is blocked on funds (about 18 USDC per leg).

## Before judging: run these live

1. A World ID Selfie Check session create → rotate, with a human (simulator or World App).
2. A Uniswap swap-in-place on Base Sepolia (done, on-chain quote); the Trading API path is proven with a live mainnet quote on a fork.
3. One compliant exit leg (needs a faucet top-up).
