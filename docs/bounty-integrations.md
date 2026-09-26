# Bounty integrations: what, why, where, and how to verify

A single page for checking each integration against the prize criteria. Status as of 2026-09-26. "Live" means it ran on a public testnet, not a fork or a mock.

| | ENSv2 | World ID (IDKit) | Uniswap API |
| --- | --- | --- | --- |
| Role in the product | Pay-by-name identity; the employee alone controls where salary goes | Self-service key rotation (salary-redirect protection) | Convert salary *in place* inside a stealth address |
| Live on testnet | **Yes**, end to end | **Production mode live** (D-51); the World App run is the last step | **Yes** for swap-in-place (Base Sepolia, on-chain quote); Trading API live on Base mainnet (placeholder-swapper quote, executed on a fork) |
| Deep docs | `contracts/ENSV2.md` | `docs/worldid.md` | `FEEDBACK.md` |

---


## Prize requirements, checked one by one

Requirement text is quoted from the ETHGlobal Tokyo 2026 prize page (fetched 2026-09-26). ✅ met · ⏳ needs one action before submission.

### ENS: Best Use of ENSv2 ($6,000)

| Requirement | How Soapay meets it | Status |
| --- | --- | --- |
| "Project must be built on ENSv2 (Sepolia)" | `soapay.eth` with its own Permissioned Registry and one Permissioned Resolver per employee, on Sepolia (`contracts/ENSV2.md`, `packages/sdk/src/ensv2.ts`) | ✅ |
| "ENSv2 features should be central to the product, not a cosmetic add-on" | The name is how every payee is addressed, and ENSv2's per-name resolver plus access control (only the employee can write the `stealth` record) is what stops an employer, platform or thief from redirecting salary. `addr` is left unset on purpose. Agents get names with ENSIP-26 records | ✅ |
| "Your demo must be functional and not just include hard-coded values" | Names are issued live from an invite link (reserve → register → issue), resolved and pinned by the company app, and cross-checked against ERC-6538. Issuance tx: [0x4b11…e255](https://sepolia.etherscan.io/tx/0x4b11d38050ef0020f5de0e4a269ed278f206ee0f0d5b61f84aa4e9b56db2e255) | ✅ |
| "Link to a live demo" | https://soapay.up.railway.app (company app at `/`, employee app at `/app/`) | ✅ |
| "Code … open source and accessible on Github" | https://github.com/easonchai/soapay (public) | ✅ |

### World: Best Use of IDKit ($5,000)

| Requirement | How Soapay meets it | Status |
| --- | --- | --- |
| "Integrate IDKit in a functioning application … or onchain flow" | IDKit 4.3 in the employee app (`packages/worldid-react`), used on the Name screen and at the name step of onboarding | ✅ |
| "Use at least one supported World ID credential" | **Proof of Human**, one-time requests on the action `soapay-recovery`, matched by nullifier (D-54, D-58) | ✅ |
| "Verify the result on the server or onchain as appropriate" | `apps/api` checks the nonce (single use), action, credential, signal (or the nonce's bound signal), environment and, for rotation, that the nullifier matches the linked one, then verifies with the Developer Portal v4 endpoint; only then signs the EIP-712 `MetaRotation` attestation | ✅ |
| "Clearly explain the specific product event requiring trust and why the chosen credential is the minimum sufficient assurance" | The event is **account recovery**: replacing a leaked key, which changes where all future salary goes. A thief with the old key can rewrite the ENS record, but the payer's app only follows with a proof from the same human (the same World ID nullifier). Proof of Human is proportionate: World calls Selfie Check medium-assurance, which is too weak for moving pay, and passport-level identity would collect data we don't need ([docs/worldid.md](worldid.md)) | ✅ |
| "Demonstrate a successful verification" | Production mode is live (D-51). The run with a real World App is the last step | ⏳ owner runs it with the World App |
| "…and one meaningful alternative path (cancellation, unavailable credential, rejection, ineligible user)" | No World ID link, cancelled proof, a different person (another nullifier), expired or replayed proof: no attestation, so the company app **blocks** the line with "meta change unverified" until the employer approves by hand. A World ID linked after onboarding also has a 72-hour wait | ✅ in code; ⏳ show it in the demo video |
| "Integration debrief/feedback: time to first success, friction, missing capability or documentation, the one improvement with the greatest impact" | [docs/worldid.md → Integration debrief](worldid.md#integration-debrief) | ⏳ fill in "time to first success" after the live run |

### Uniswap: Best Uniswap Stack Contribution ($6,000)

| Requirement | How Soapay meets it | Status |
| --- | --- | --- |
| "A public GitHub repository with open-source code" | https://github.com/easonchai/soapay | ✅ |
| "A FEEDBACK.md file" | [FEEDBACK.md](../FEEDBACK.md), with live-verified findings and line pointers | ✅ |
| "A completed submission to the Uniswap Developer Feedback Form … that includes the link to your FEEDBACK.md" | Draft answers in [docs/submission/uniswap-feedback-form.md](submission/uniswap-feedback-form.md) | ⏳ owner submits |
| "README clearly points to the relevant contracts and lines of code" | README "Uniswap integration": `swap.ts` placeholder-swapper quote, route re-encoding, `/quote`-only client, in-place checks, entry points; `spend.ts` userOp pipeline; the fork E2E (line ranges updated 2026-09-26) | ✅ |
| Integration in the product | Convert salary **in place** inside a stealth address: Trading API quote (placeholder swapper, V2/V3 route rebuilt by us) → one 7702 userOp with Permit2 + Universal Router, gas in USDC. Live swap: [0x2bf6…5c81](https://sepolia.basescan.org/tx/0x2bf66ce2b28b118becdd5aba49d612a444bcffaa006c33b09b92165b5ec55c81) | ✅ |

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
- At enrollment the employee may link World ID: a one-time **Proof of Human** proof on the action `soapay-recovery`, whose nullifier the API stores (D-58).
- A later rotation needs a proof with the *same* nullifier, i.e. the same human.
- The API verifies it server-side and signs an EIP-712 `MetaRotation` attestation.
- The sender app **auto-accepts a changed pin only with that attestation** (checked against a pinned attester address). Otherwise the line is blocked ("possible salary redirect") until the employer approves it by hand.

**Why this credential:** see [docs/worldid.md](worldid.md#why-proof-of-human-is-the-proportionate-credential) (D-54): recovery moves future salary, so the strongest same-human proof (Proof of Human) is proportionate; Selfie Check is medium-assurance.

**Where:**
- `apps/api/src/humanVerifier/worldid.ts`, `routes/names.ts` + `routes/rotation.ts` (link, rotation, attestations), `routes/worldid.ts` (rp-context, config);
- `packages/worldid-react` (`<HumanCheck mode="create-session"|"rotate">`);
- `packages/sdk/src/rotation.ts` (typed data);
- `apps/sender/src/lib/attestation.ts` (enforcement).

**Alternative paths (the prize requires them)**, all refused and covered by tests:
- no World ID link on the name (`no_worldid_link`), or a different person (`human_mismatch`);
- a replayed proof (spent nonce), or an expired or cancelled proof;
- an environment or action mismatch;
- a late link inside its 72 h cooldown.

**Live proof:**
- RP `rp_3ede5fe1cab9af48` for app `app_0cc7167efe114ac2e0ef7d9827098353` is registered on-chain (production and staging), and action `soapay-recovery` exists in both. Two live proofs by the same identity on it verified (HTTP 200) with the same nullifier (09-26).
- `GET /api/worldid/config` on the running API returns enabled, with credential `proof_of_human` and action `soapay-recovery`.
- The sender's attestation gating was shown in mock mode (screenshots): attested → "Re-verified by World ID"; unattested → blocked.

**Not yet live:** a full link → rotate by a human (simulator or World App) against the running API with D-58 deployed. This is the #1 item to run before judging.

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

1. A World ID Proof of Human link → rotate (same nullifier), with a human (simulator or World App).
2. A Uniswap swap-in-place on Base Sepolia (done, on-chain quote); the Trading API path is proven with a live mainnet quote on a fork.
3. One compliant exit leg (needs a faucet top-up).
