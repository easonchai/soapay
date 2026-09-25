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
