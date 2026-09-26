# Bounty integrations: what, why, where, and how to verify

A single page for checking each integration against the prize criteria. Status as of 2026-09-26. "Live" means it ran on a public testnet, not a fork or a mock.

| | ENSv2 | World ID (IDKit) |
| --- | --- | --- |
| Role in the product | Pay-by-name identity; the employee alone controls where salary goes | Self-service key rotation (salary-redirect protection) |
| Live on testnet | **Yes**, end to end | **Production mode live** (D-51); the World App run is the last step |
| Deep docs | `contracts/ENSV2.md` | `docs/worldid.md` |

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
| "Use at least one supported World ID credential" | **Proof of Human**, in a World ID session: created at linking, proved at recovery (D-54, D-59) | ✅ |
| "Verify the result on the server or onchain as appropriate" | `apps/api` checks the nonce (single use), credential, signal (or the nonce's bound signal), environment, the session nullifier (single use) and, for rotation, that the session id is the one linked to the name, then verifies with the Developer Portal v4 endpoint; only then signs the EIP-712 `MetaRotation` attestation | ✅ |
| "Clearly explain the specific product event requiring trust and why the chosen credential is the minimum sufficient assurance" | The event is **account recovery**: replacing a leaked key, which changes where all future salary goes. A thief with the old key can rewrite the ENS record, but the payer's app only follows with a proof of the same person's World ID session. Proof of Human is proportionate: World calls Selfie Check medium-assurance, which is too weak for moving pay, and passport-level identity would collect data we don't need ([docs/worldid.md](worldid.md)) | ✅ |
| "Demonstrate a successful verification" | Production mode is live (D-51). The run with a real World App is the last step | ⏳ owner runs it with the World App |
| "…and one meaningful alternative path (cancellation, unavailable credential, rejection, ineligible user)" | No World ID session, cancelled proof, another person's session, expired or replayed proof: no attestation, so the company app **blocks** the line with "meta change unverified" until the employer approves by hand. A World ID linked after onboarding also has a 72-hour wait | ✅ in code; ⏳ show it in the demo video |
| "Integration debrief/feedback: time to first success, friction, missing capability or documentation, the one improvement with the greatest impact" | [docs/worldid.md → Integration debrief](worldid.md#integration-debrief) | ⏳ fill in "time to first success" after the live run |

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
- At enrollment the employee may link World ID: a **Proof of Human session** (`IDKit.createSession`, QR shown inline in the app), whose session id the API stores (D-59).
- A later rotation needs a proof of that *same* session (`IDKit.proveSession`), i.e. the same person.
- The API verifies it server-side and signs an EIP-712 `MetaRotation` attestation.
- The sender app **auto-accepts a changed pin only with that attestation** (checked against a pinned attester address). Otherwise the line is blocked ("possible salary redirect") until the employer approves it by hand.

**Why this credential:** see [docs/worldid.md](worldid.md#why-proof-of-human-is-the-proportionate-credential) (D-54): recovery moves future salary, so the strongest same-human proof (Proof of Human) is proportionate; Selfie Check is medium-assurance.

**Where:**
- `apps/api/src/humanVerifier/worldid.ts`, `routes/names.ts` + `routes/rotation.ts` (link, rotation, attestations), `routes/worldid.ts` (rp-context, config);
- `packages/worldid-react` (`<HumanCheck mode="create-session"|"rotate">`);
- `packages/sdk/src/rotation.ts` (typed data);
- `apps/sender/src/lib/attestation.ts` (enforcement).

**Alternative paths (the prize requires them)**, all refused and covered by tests:
- no World ID session on the name (`no_session`), or another session (`session_mismatch`);
- a replayed proof (spent nonce or session nullifier), or an expired or cancelled proof;
- an environment or binding mismatch;
- a late link inside its 72 h cooldown.

**Live proof:**
- A fresh app and RP (`app_c47a43da4fea435146d14ae5e9f503ea` / `rp_25e1826d2548c1d9`; the first RP silently didn't support sessions) ran a minimal production session request with the owner's World ID, verified at `/api/v4/verify` (HTTP 200, 09-26). The API reads the ids from its environment (Railway).
- `GET /api/worldid/config` on the running API returns enabled, with credential `proof_of_human`.
- The sender's attestation gating was shown in mock mode (screenshots): attested → "Re-verified by World ID"; unattested → blocked.

**Not yet live:** a full link → rotate by a human with the World ID app against the running API with D-59 deployed. This is the #1 item to run before judging.

**Verify yourself:** `pnpm --filter @soapay/api test` (the World ID refusal paths) and `pnpm --filter @soapay/sender test` (attestation gating). The debrief is in `docs/worldid.md`.

---

## Core payroll: live (context for both)

- **`StealthDisperse`** is deployed on Base Sepolia at `0x6B7a1cC570Af2DDd427DA694351438F0FE8039CA` (CREATE2).
- **Live run:** two employees onboarded via the API with ENSv2 names, then resolved and pinned by the employer, then one pay run ([pay tx](https://sepolia.basescan.org/tx/0x24f23d610d1917905d3896e282243b07a038afb2bf266f94f11f31ea9e5b492d)). Each employee's scan found exactly their own line, and a gasless 7702 spend with the Circle paymaster went through ([spend tx](https://sepolia.basescan.org/tx/0x1167b83dfab7476ac32b286b890fdcfdba396766d9389778568d949cbffc1bae)).
- **Compliant exit** (Privacy Pools): the SDK and UI are built, and the Sepolia fork deposit and ragequit are proven. The live run is blocked on funds (about 18 USDC per leg).

## Before judging: run these live

1. A World ID Proof of Human session link → rotate (same session), with a human and the World ID app.
2. One compliant exit leg (needs a faucet top-up).
