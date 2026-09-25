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
