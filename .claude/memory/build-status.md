---
name: build-status
description: Checkpoint log of the multi-agent build, i.e. what is done, in flight, blocked; read first when resuming
metadata:
  type: project
---
**Checkpoint 1 (2026-09-25): groundwork committed on `yudhishthra`**
- Done: `docs/mvp-spec.md` (packed calldata layout, resolver signature hash, SDK module ownership, API routes). SDK skeleton with per-chain `CHAINS`, ABIs and module stubs. `apps/gateway` renamed to `apps/api`. Base Sepolia and Sepolia RPC endpoints added to foundry.toml.
- Verified on-chain: Announcer, Registry, USDC, EntryPoint v0.8, Simple7702Account and CREATE2 deployer on Base Sepolia; ENS registry on Sepolia.
- Wave 1 (parallel agents, worktrees): contract packing, offchain resolver, SDK identity, SDK payrun+scan, SDK spend, SDK guard/denominations/Safe, API.
- Wave 2 (after wave 1 merges): recipient app, sender app, end-to-end on a local fork.
- Blocked on the owner: deploy broadcasts, soapay.eth on Sepolia, relayer funding, bundler URL.

**How to apply:** append a new checkpoint section at each milestone; don't rewrite history. Related: [[decision-mvp-scope]].

**Checkpoint 2 (2026-09-25): wave 1 partly merged; scope adds ENSv2, World ID and Uniswap**
- Merged into `yudhishthra`: packed StealthDisperse (31 tests + 4 fork; about 37.8k gas/line all-in, so 350 lines keeps a 21% margin; fixed vectors in PLAN.md); SDK keys/registration/names (EIP-712 domain verified live on Base and Base Sepolia); SDK guard/denominations/Safe (MultiSendCallOnly 0x9641…02e2, outer op=1 delegatecall).
- The SDK's constants.ts and abis.ts no longer import ScopeLift, so the API can load the SDK in plain Node. ScopeLift's registry ABI lacks the NonceIncremented event; the deployed bytecode has it.
- The ENSv1 off-chain resolver agent was stopped unmerged; naming switches to ENSv2 ([[decision-naming]]). The API agent was redirected: no CCIP route, plus pluggable `NameIssuer` and `HumanVerifier` hooks.
- Still running: SDK payrun+scan, SDK spend, API.
- Next: an ENSv2 agent (research + contracts/scripts + issuer), then World ID (after the API merges) and the Uniswap swap (after spend merges), then wave 2 apps.
- Checkpoint 2b: SDK spend merged (Circle Paymaster v0.8, verified at Base 0x0578…00Ec and Base Sepolia 0x3BA9…8966; paymasterData = mode 0x00|token|permitAmount|permitSig; postOp gas ≥ 35000; EntryPoint nonce key fixed at 0 to avoid a timestamp fingerprint). Open: the spend agent believes USDC permits DO validate for Simple7702Account-delegated EOAs (ERC-1271 → ECDSA recover == self), contrary to the CLAUDE.md note, which came from a fork test with a different delegate. Verify live before changing CLAUDE.md. Uniswap agent started.
- Checkpoint 2c: SDK payrun+scan merged. The TS head encoder matches the contract's fixed vectors (test wired). The /announcements contract is `?from&to&limit&cursor` → `{items[{blockNumber str, txHash, logIndex num, stealthAddress, caller, ephemeralPubKey, metadata}], nextCursor|null}`. Scan cost is about 1.5 ms per announcement (one ECDH each; the view tag only skips the later steps), so the recipient app must scan in Web Workers, incrementally from its last block. The metadata payer is trusted only when `caller` is a known StealthDisperse; otherwise payer = caller.
- Checkpoint 2d: apps/api merged (52 tests): /register relayer (idempotent, rate-limited), /names (NameClaim via SDK verifyNameClaim, name_history, pluggable NameIssuer with optional updateMeta, HumanVerifier → 403), /announcements (the scanner's contract), /health, Dockerfile. The NameClaim EIP-712 chainId is the API's CHAIN_ID (84532). Ops: sepolia.base.org caps getLogs at 1k blocks, so backfill needs a better RPC in prod.
- Design point: World ID can only *enforce* salary-redirect protection if the ENSv2 `stealth` write goes through the gate. Preferred: an on-chain guard contract holds the setText role and verifies World ID + the registrant signature, if World ID on-chain verification exists on Sepolia; fallback: the API gates writes. The World ID agent decides from research.
- Checkpoint 2e (resume notes, in case the session restarts): agents in flight, each in `.claude/worktrees/agent-*` on branch `worktree-agent-*`. If a session restarts mid-flight, inspect each worktree's `git log yudhishthra..HEAD` and `git status`, then merge the finished work or re-spawn the task.
  - ENSv2 subnames (+ grantable stealthWriter role for a guard).
  - Uniswap swap-in-place + FEEDBACK.md + Base-fork E2E (spend/paymaster/permit-1271 verdict).
  - Recipient app.
  - Sender app.
  - World ID (backend verifier with enroll uniqueness + sessions, rp-context endpoint, `@soapay/worldid-react`, optional SoapayNameGuard).
  After all merge: wire World ID, swap and ENSv2 rotation into the apps (TODO hooks), then run E2E on a local fork.
- Checkpoint 3 (PAUSED for a session restart). WIP branches to resume from:
  - `worktree-agent-a6ec2e10ad25c446a` @ d97b043, ENSv2.
    - Done: the Sepolia fork test passes 3/3 against the real deployment (ensdomains/contracts-v2 @71a3b73, deployed 2026-09-15). It covers the full lifecycle, a guard as stealthWriter, and cross-name isolation.
    - Remaining: compile and test `packages/sdk/src/ensv2.ts`; add `test/ensv2.test.ts`, the setup scripts (setup-parent, issue-demo) and `contracts/ENSV2.md`; add `export * from "./ensv2.js"` to index.ts.
    - Facts:
      - soapay.eth is NOT registered on ENSv2 Sepolia yet (the team must register it, with no resolver on the parent).
      - The stealth-writer role is ROLE_SET_TEXT (1<<4) on resource uint256(keccak256("stealth")); roles are per text key, not per name, hence one resolver per employee.
      - viem's default Sepolia UR routes to UniversalResolverV2, so names.ts is unchanged.
      - Remaining issuer trust: it can register new names with arbitrary roles, but can't touch existing ones.
  - `worktree-agent-a3a64cc3c96a4e07e` @ 3873bfc, World ID.
    - Done: hooks (verifier gets label/meta/deadline; the approval's `commit()` runs only after the relay or issue succeeds), a DB migration, deps. Unbuilt; hooks.test needs updating.
    - Remaining: humanVerifier/worldid.ts, POST /worldid/rp-context and GET /worldid/config, env wiring, denied-path tests, `@soapay/worldid-react` <HumanCheck>, docs/worldid.md.
    - Facts:
      - IDKit 4.3.0 and @worldcoin/idkit-server 1.1.1 (JS signRequest).
      - 4.0 proofs are verifiable on-chain only on World Chain/Arc, so there's NO on-chain guard on Sepolia and the API is the gate.
      - Sessions support proof_of_human via `constraints` on IDKitSessionWidget.
      - Use text signals like `soapay:enroll:0x…` (0x-hex signals are hashed as raw bytes).
  - `worktree-agent-a9dcd3f946c93c07a` @ a427e16, Uniswap.
    - Done: executeFromStealth, swap.ts (Trading API or UR 2.1.2 V3 fallback; recipient must be the stealth address; slippage ≤ 500 bps), 110 SDK tests passing.
    - FORK E2E 3/3 on Base: 7702 delegation in the same tx, Circle fee 0.0056 USDC, the stealth address never held ETH, swaps to WETH and to native ETH land at the stealth address.
    - **The USDC permit via ERC-1271 from a Simple7702Account DOES validate**, so CLAUDE.md's "7702 permits fail" note is wrong for our delegate; update it with this evidence.
    - The Trading API supports Base AND Base Sepolia (header x-api-key).
    - Remaining: FEEDBACK.md, a final commit, `export * from "./swap.js"`.
  - `worktree-agent-adfea39557c51d51f` @ 92700d5, sender app.
    - Done: lib layer (amount, csv, vault, roster pin/block, paypath, run/retry, execute, safeExport) and tests; nothing has been run yet.
    - Remaining: the test script, the entire UI (wagmi, pages), build/test/screenshot.
    - SDK gap: no StealthDisperse address or predicted CREATE2 address in CHAINS.
- OPEN DESIGN QUESTION (for the owner): who holds the ENSv2 `stealth` writer role, given World ID can't be verified on-chain on Sepolia? See the chat on 2026-09-25; the recommendation is that the registrant keeps it and the sender app is the enforcement point, auto-accepting a changed pin only with an API World ID attestation.
  - `worktree-agent-a6e83ae904bb96dd0` @ 55f9635, recipient app: vault crypto, scanner worker pool, mock services, onboarding UI (see the commit body for remaining work).
  RESUME PLAN after restart: re-spawn one agent per WIP branch (with the new World/ENS/Uniswap MCPs and skills), each starting from its branch; merge them into `yudhishthra` as they finish; then wire the apps and run E2E.

**Checkpoint 4 (2026-09-25, after the session restart): resumed**
- Decided key rotation **option A** (docs/mvp-spec.md §2.1, with RotationClaim and MetaRotation attestation formats). CLAUDE.md permit note corrected with the fork evidence.
- MCPs after the restart: world-docs ✔, context7 ✔ (ENS docs route), Uniswap skills ✔; the **World Developer Portal MCP is not loaded** (needs `claude mcp add world-developer-portal https://developer.world.org/api/mcp --transport http --header "Authorization: Bearer api_…"`).
- Five resume agents started from the WIP branches: Uniswap (FEEDBACK.md, export, README), ENSv2 (SDK compile + tests, scripts, ENSV2.md, README), World ID (verifier, rotation + attestation + L1 gas sponsor, rp-context, worldid-react, docs), recipient UI, sender UI (with attestation-gated pin acceptance).
- Next: merge each as it finishes; wire World ID, swap and ENSv2 into the apps; E2E on a fork.

**Checkpoint 5 (2026-09-25): paused again for a restart (to load the World Developer Portal MCP)**
- MERGED: Uniswap (swap.ts exported, FEEDBACK.md, README section; 138 SDK tests; fork E2E 3/3). Uniswap's skill is outdated against the live Trading API spec (`{quote}` body, numeric chainIds, UR 2.1.2), noted in FEEDBACK.md. The recipient app should call the Trading API through an apps/api proxy injecting `UNISWAP_API_KEY` (no key in the bundle; CORS).
- Spec fix: rotation also relays the ERC-6538 re-registration of the new meta-address (§2.1 step 3).
- Note: `git reset --hard` is denied by permissions; agents fast-forward and merge instead.
- WIP branches to resume:
  - ENSv2 `worktree-agent-af95021c36de07bb4` @ a178c67.
    - Done: SDK ensv2.ts (28 tests, exported, also as subpath `@soapay/sdk/ensv2`); fork test 5/5 including double rotation.
    - Remaining: debug the `ETHRegistrar.register` revert in `ensv2:register-parent` on an anvil fork; run setup-parent and issue-demo; ENSV2.md; README section.
    - Issuer: `createEnsV2NameIssuer({walletClient, publicClient, parent?, registry?, resolverAdmin?, defaultStealthWriter?, deployment?}).issue({label, registrant, metaAddress, stealthWriter?})`; env ISSUER_PRIVATE_KEY, L1_RPC_URL, PARENT_NAME, ENS_SUBNAME_REGISTRY, ENS_RESOLVER_ADMIN.
  - World ID `worktree-agent-ad60c701ad1c331c1` @ 3fe1192.
    - Written but untested: SDK `rotation.ts` (typed data + signals), API world-id config/tables/verify/enroll gating/rotation/attestations/top-up, routes.
    - Remaining: build, tests, worldid-react `<HumanCheck>`, docs, README. Add the ERC-6538 re-registration relay to rotation.
    - IDKit 4.3's IDKitSessionWidget takes `constraints`, not `preset` (a docs gap; could be reported via world-docs submit_feedback).
  - Recipient `worktree-agent-ac9402777395ffc8f` @ 72203f1.
    - Done: rotation keys via BIP-39 passphrase `soapay:rotation:<n>` (TODO(sdk) account index), seams for HumanCheck/ENS/swap, spend pipeline.
    - Remaining: mocks, providers, hooks, App/routing, screens, README plug-in-UI section, tests, screenshot.
  - Sender `worktree-agent-abad332b499ba25d6` @ 0086b04.
    - Done: attestation.ts (option A enforcement) with tests; 99 tests.
    - Remaining: typecheck the wallet/wagmi/services/store files; hooks, pages, 5792-only banner, README seam, build, screenshot.
    - SDK gaps: CREATE2 predictor, and MetaRotation helpers (now in SDK rotation.ts on the World ID branch).

**Checkpoint 6 (2026-09-25): resumed after restart #2**
- The World Developer Portal MCP is loaded (`mcp__worldcoin-developer-portal__*`). App `app_0cc7167efe114ac2e0ef7d9827098353` ("Soapay", production, cloud) has **World ID 4.0 NOT configured** (no RP, no actions). The owner must approve `configure_world_id` first (on-chain RP registration; the signing key is returned ONCE and goes straight into apps/api/.env, never chat or git). After that: create action `soapay-enroll` in staging and production.
- Resume agents (round 2): ENSv2 (fix the register-parent revert, ENSV2.md, README), World ID (build/tests, ERC-6538 re-registration relay in rotation, `@soapay/worldid-react`, docs, plus the `/uniswap/:endpoint` Trading API proxy with UNISWAP_API_KEY), recipient app (wire the real swap.ts via the API proxy), sender app (UI).
- Checkpoint 6b: ENSv2 MERGED.
  - SDK ensv2.ts: 166 SDK tests passing.
  - Fork test 5/5.
  - The scripts register-parent, setup-parent and issue-demo run end to end on an anvil Sepolia fork (output in contracts/ENSV2.md §6).
  - Gotcha: an owner address with code, such as a 7702-delegated EOA like anvil key 0 on Sepolia, reverts the ERC-1155 mint in `register`; the script now checks for this. Use a plain EOA to own soapay.eth.
  - Remaining: the API still uses NoopNameIssuer. Wiring createEnsV2NameIssuer plus the ISSUER_PRIVATE_KEY / ENS_SUBNAME_REGISTRY / ENS_RESOLVER_ADMIN env is assigned to the World ID agent.
- Checkpoint 6c: sender app MERGED.
  - 103 tests, build and typecheck pass.
  - Hooks and props-only pages (Roster, Pay run, Run detail, History, Safe export, Settings) and a README "plug in another UI" section.
  - Verified in mock mode: an attested rotation auto-accepts with a badge, an unattested one is blocked with re-approve, the preview excludes blocked lines, and the small-team warning shows.
  - Not yet exercised: a real payment (needs a wallet plus a deployed StealthDisperse or a 5792 wallet). WalletConnect is optional and not installed.
  - Headless browse on this host needs GSTACK_CHROMIUM_NO_SANDBOX=1.
- Checkpoint 6d: World ID MERGED (rotation-only Selfie Check design).
  - Totals: SDK 171 / API 95 / sender 103 / contracts 31 tests; the whole monorepo builds and typechecks.
  - API: optional session at POST /names or POST /names/:label/session (AttachSession signature). Rotation checks the session, rejects replayed nullifiers and nonces, signs the MetaRotation attestation, relays the ERC-6538 re-registration and tops up gas. The Uniswap proxy is at /uniswap/{quote,swap,check_approval}. The real ENSv2 issuer is used when ISSUER_PRIVATE_KEY + L1_RPC_URL are set (it never writes `stealth`).
  - `@soapay/worldid-react` provides `<HumanCheck mode="create-session"|"rotate">`.
  - Security decisions by the agent (accepted): a 72 h cooldown before a late-attached session can back a rotation (WORLD_ATTACH_COOLDOWN_SECONDS), and a name's session is never replaceable. Both stop a stolen registrant key from attaching its own session and rotating.
  - WORLD_ENV accepts `sandbox`, since the World docs test Selfie Check there.
  - Not yet run against a real simulator or World App.
- Checkpoint 7 (2026-09-25): **full payroll E2E passes on a Base mainnet fork** (`packages/sdk/test/payroll.e2e.test.ts`, FORK_E2E=1, 5/5). It uses real canonical contracts plus a freshly deployed StealthDisperse:
  1. gasless ERC-6538 registration (the registrant never holds ETH);
  2. the employer pins meta-addresses from the registry;
  3. one StealthDisperse pay run, 7 lines with bob denominated: fresh EOAs, ascending order, one announcement per line, the contract holds 0;
  4. each employee's scan finds exactly their own lines and the ledger totals equal salaries from real balances;
  5. the guard allows a fresh destination and blocks a coworker-known one, then a 7702 + Circle paymaster spend succeeds and no stealth address ever held ETH.
  The fork harness is extracted to test/helpers/fork.ts. Not covered by this E2E: ENSv2 name resolution (Sepolia; covered by the contracts fork test) and the API services (unit-tested).
- Checkpoint 7b: **invite links** added (owner decision; spec §7). The employer signs an EIP-712 Invite reserving a label (codeHash = keccak(random code)). The link `#/join?code&label&org` lets only the link holder claim the name. The sender roster auto-enrolls when the invite is claimed. The SDK/API/sender part is with a new agent; the recipient join route was added to the recipient agent's scope.
- Checkpoint 7c: recipient app MERGED.
  - 61 tests, build and typecheck pass.
  - Screens (Payments, Send, Convert, Labels, Name, Settings) with all logic in hooks, plus a README seam for CK.
  - Onboarding: register → name → optional Selfie Check session → share. The invite `#/join` route is done.
  - Rotation: with a session, the attested path; without one, a manual path relayed through /register (UNTESTED against the real API's "superseded" handling).
  - Convert goes through the /uniswap proxy.
  - Worker scan: 3,139 announcements in about 2.1 s on 4 workers (mock).
  - Follow-ups:
    1. Auto-add the inviting employer to knownPayers when an invite is claimed (currently every row shows "Unknown payer").
    2. Verify viem getEnsResolver against ENSv2 on Sepolia.
    3. Verify /register accepts re-registration for manual rotation.
- Checkpoint 7d: the invite agent was cut off by an account rate limit mid-task. Its uncommitted sender work was saved as WIP commit 5213483 on `worktree-agent-aeda4302f49ccea41` (the SDK invites.ts and API invite routes were already committed there). A finisher agent is resuming from that branch; it also adds the inviting employer as a recipient known payer.

**Checkpoint 8 (2026-09-25): feature-complete on `yudhishthra`, all green**
- Invite links MERGED: the sender's "Invite employee" (sign, link and QR, pending row, auto-enroll through resolve-and-pin on claim, re-invite on expiry), and recipient `#/join` adds the employer as a known payer.
- Test totals: SDK 183 (+11 fork/live skipped) · API 112 · sender 117 · recipient 62 · contracts 31 (+2 fork skipped). The fork E2Es (payroll 5/5, spend/swap 3/3) pass with FORK_E2E=1.
- NEXT: the testnet deploy (the owner runs the broadcasts), a live demo run, then compare with CK's UI and open the PR yudhishthra → main.
- Checkpoint 9 (2026-09-25): **TESTNET LIVE**; see docs/testnet-deployment.md.
  - StealthDisperse is on Base Sepolia at 0x6B7a…39CA; soapay.eth is registered and set up on ENSv2 Sepolia.
  - Wallets were generated locally with cast (keys only in the gitignored .env files) and funded via the Chainstack faucet (one drip per network per 24 h), then redistributed.
  - The API runs with `node --env-file=.env dist/index.js`.
  - Verified live: issue, resolve and rotate on ENSv2; register → names → resolve through the API 3/3; manual re-registration.
  - Fixed: /names read-after-write lag (re-read at the relay block).
  - Pending live: pay/scan/spend (needs faucet USDC) and a World ID session (simulator/World App).
- Checkpoint 10 (2026-09-25): **live payroll loop passed on testnet**.
  - Two employees onboarded through the API (ENSv2 names pay392111/pay730021.soapay.eth), resolved and pinned, then a StealthDisperse pay run of 3 + 2.5 USDC. Each scan found exactly its own line with payerKnown, then a gasless 7702 spend through the Pimlico public bundler and Circle paymaster: 1.0 USDC to a fresh address, net fee about 0.0057 USDC, and the stealth address never held ETH.
  - Fixed: the sender app now waits for the approval to be visible before `pay` (the same load-balanced RPC lag).
  - **Tailscale demo:** `scripts/build-demo.sh <origin>` + `node scripts/serve-demo.mjs` (:4300) + `tailscale serve --bg --https=9443 http://127.0.0.1:4300`, giving https://yudhishthra-eth.taila3275f.ts.net:9443/ (recipient), /sender/, /api. Ports 443, 8443 and 8445 belong to other services; don't touch them.
  - The API must run as `node --env-file=.env dist/index.js` in apps/api; local .env rate limits are relaxed for the demo.
- Checkpoint 11 (2026-09-26): `main` has CK's frontend (#2, #3, #5): his own apps, `packages/ui`, duplicate SDK modules, wallet-signature keys, the old StealthDisperse ABI. A trial merge conflicts in about 20 files. The owner said to push and leave a divergence note (docs/DIVERGENCE.md) and a PR for CK instead of force-merging. Merge direction proposed: our SDK/API as the base plus CK's visual layer.
- Checkpoint 12 (2026-09-26): MCP server (spec §8) started in parallel to the CK merge (no file overlap). Agents get *.soapay.eth names with ENSIP-25/26 records; guardrails include caps, dry-run then confirm, and guard enforcement.
- Checkpoint 13 (2026-09-26): MCP server MERGED (`apps/mcp`, 54 tests).
  - Live: an agent created `mcp-agent-7c1e.soapay.eth` with ENSIP-26 `agent-context` / `agent-endpoint[web]`, received 0.3 USDC, scanned it and spent 0.1 USDC by name; a guard `block` was confirmed.
  - The SDK issue() and POST /names accept an optional `agent` object; the records are written once at issuance.
  - ENSIP-25 needs a live registry such as ERC-8004, so it isn't set by default.
  - The :8787 API was restarted on the merged code. Totals: SDK 202 · API 122 · sender 118 · recipient 62 · mcp 54 · contracts 31.
- Checkpoint 14 (2026-09-26): the owner put the **compliant exit back IN scope** (the coworker knows the main wallet, so the guard blocks cash-out without an exit), and gateway mode is DEFERRED to the roadmap. CLAUDE.md threat model updated. A research spike on exit feasibility on testnet (Privacy Pools / Railgun / CCTP V2 / paymaster on L1) is running and will write docs/exit-research.md.
- Checkpoint 15 (2026-09-26): exit research DONE (docs/exit-research.md).
  - **0xbow Privacy Pools USDC pool on Ethereum Sepolia**: Entrypoint 0x34A2…21cB, pool 0x0b06…4C0f. Minimum 10 USDC, 1% fee. The testnet ASP approves in about 10–12 minutes, and the testnet relayer charges 0.1%. SDK @0xbow/privacy-pools-core-sdk 1.5.0.
  - No USDC pool on Base. Railgun has no usable testnet.
  - Route: CCTP V2 Base Sepolia→Sepolia (same addresses), minting back to the SAME stealth address through Circle's Forwarding Service (about 1.5–2.2 USDC fee, no ETH); then approve + deposit through a 7702 userOp with the Circle paymaster on Sepolia (the Pimlico public bundler works); then withdraw through the relayer to the destination.
  - Risks: the paymaster's 1271 path is unproven on Sepolia (fork test it first); testnet service uptime; about 15 USDC per line (the faucet gives 20 per 2 h).
  - Production chain decision pending: Optimism (cheap) vs Ethereum (large anonymity set).
- Checkpoint 16 (2026-09-26): building the compliant exit (spec §9) with 2 parallel agents:
  1. SDK exit.ts: CCTP V2 with forwarding back to the same stealth address, a 0xbow deposit through a 7702 userOp with the Circle paymaster on Sepolia, the ASP, the relayer withdraw, ragequit, derivePoolSecrets from the seed, a Sepolia fork test, and a live run if funds allow (it stops and asks for a faucet top-up otherwise).
  2. Recipient exit UI against the §9 types through an adapter at apps/recipient/src/features/exit/sdk.ts.
  The production chain is undecided (the SDK is chain-agnostic).
- Checkpoint 16b: recipient exit UI MERGED (branch `exit-ui`; 74 recipient tests).
  - Blocked send → "Exit through Privacy Pools", a planner with fees and minimums, and a resumable per-leg timeline; mock mode works.
  - Seam: apps/recipient/src/features/exit/sdk.ts switches automatically once the SDK exports planExit/advanceExitLeg/derivePoolSecrets. `buildCtx` must be rewritten to the SDK's real per-chain context.
- Checkpoint 17 (2026-09-26): exit SDK MERGED (`packages/sdk/src/exit.ts`: planExit/advanceExitLeg/derivePoolSecrets/withdrawToDestination/checkAspStatus), with the recipient exit UI wired to it.
  - Sepolia fork: a 7702 stealth address deposited into the real 0xbow pool with the Circle paymaster (permit via 1271 OK, about 2.12 USDC gas), and ragequit works; the Base Sepolia CCTP burn encoding was verified.
  - A live run needs about 18 USDC per leg (the deployer has 14.2): `EXIT_LIVE=1 EMPLOYER_KEY=… vitest run test/exit.live.test.ts`.
  - Known gaps: recipient runner.ts doesn't pass `persist` (crash mid-send could double-send); the planner's destination gas estimate is too low (the real minimum leg is about 16.5 USDC).
  - Totals: SDK 216 · API 122 · sender 118 · recipient 76 · mcp 54 · contracts 31.
