# Drift audit: PRD vs what we built (2026-09-26)

The question: has the product drifted from the PRD's goal? The goal is **"one name, infinite addresses: get paid on-chain without publishing your bank statement,"** with a compliant exit.

**Verdict:** the core goal holds, and every PRD P0 is met. Most differences are deliberate and recorded. Three need watching: (1) the threat model was narrowed, (2) bounty-driven additions add surface area, and (3) CK's frontend made choices that contradict the PRD and are being reverted in the integration.

## A. Aligned with the PRD

| PRD | Status |
| --- | --- |
| Goal 1: one static name, shared once | ✅ `label.soapay.eth` (ENSv2) |
| Goal 2: a fresh unlinkable address per payment | ✅ ERC-5564 scheme 1 with a fresh ephemeral key per line (tests plus a live testnet run) |
| Goal 3: spend without funding from a known wallet | ✅ 7702 + USDC paymaster, live; no ETH ever reaches a stealth address |
| Goal 5: warn before linking, plus a compliant exit | ✅ The guard (clusters, labels, warn/block) and the **Privacy Pools exit** (SDK + UI; Sepolia fork proven, live run blocked on funds) |
| Goal 6: group payments in one transaction | ✅ Up to 350 lines per transaction, globally sorted |
| Goal 7: everything through an SDK | ✅ `@soapay/sdk`, which the apps, API and MCP use exclusively |
| Flow 1: throwaway registrant, gasless `registerKeysOnBehalf`, "send one string" | ✅ |
| Flow 2: client-side derivation, re-resolve each run, atomic pay + announce | ✅ |
| Denominated payouts (v1) | ✅ |
| Seed recovers everything | ✅ BIP-39 phrase, with keys, ledger and pool secrets derived from it |
| Canonical 5564/6538 contracts, an audited existing 7702 account, an existing paymaster | ✅ |
| M5 agents (MCP), pulled forward | ✅ |

## B. Deliberate deviations (recorded, with reasons)

| Deviation | Why | Where it's recorded |
| --- | --- | --- |
| **The threat model narrowed to the "coworker only" adversary; the employer is trusted** | Team decision; the PRD also protects against chain analysts | CLAUDE.md |
| One custom contract, `StealthDisperse` (the PRD says "an existing multisend") | Disperse behind a multicall can't pull from an EOA. It holds no funds and keeps no state | CLAUDE.md, `contracts/PLAN.md` |
| ENS `addr` is left **unset** (the PRD says "set addr to the registrant") | Otherwise plain wallets would pay one static, linkable address | `decision-naming` |
| Names are **ENSv2 on-chain subnames with per-employee resolvers** (the PRD says "a name the employee owns or a platform subname") | A strict upgrade that also makes EAC salary-redirect protection possible (and matches the ENS prize) | `decision-naming` |
| Denominated remainder is **paid exactly**, not carried over | Carrying over under- or over-pays wages | `denominations.ts` |
| The exit mints back to the **same** stealth address (the PRD says "a fresh mainnet address") | The CCTP message names the recipient publicly anyway, so a fresh address gains nothing; the same address never needs ETH | `docs/exit-research.md` |
| The exit runs on **Ethereum Sepolia** in the demo; the production chain is undecided (Ethereum vs Optimism) | The Base chain has no USDC pool | memory checkpoint 15 |
| Gateway derivation mode (M3, and its 4 P1s) is **deferred** | The PRD itself makes it tier 2; it conflicts with the ENSv2 design | `decision-gateway-announce` |

## C. Additions beyond the PRD (bounty-driven, and each sits on an existing PRD step)

| Addition | Anchored on | Drift risk |
| --- | --- | --- |
| World ID Selfie Check for key rotation, plus EIP-712 attestations the sender app enforces | Name ownership / Flow 1 | Low: optional, and it protects the PRD's "ENS controls where salary goes" risk |
| Invite links | Flow 1 onboarding | Low: pure UX |
| ENSIP-26 agent names | M5 | Low |
| Address-level rate limits, a relayer and an indexer (`apps/api`) | Implicit in the PRD (a relayer and scanning) | Low |

Watch the combined surface area: every addition is more to demo and maintain. The pitch should still lead with the PRD goal, not the bounties.

## D. PRD items not done

| Item | Status |
| --- | --- |
| **Shielded rail (v2)** | Not built. The PRD names **Railgun or Privacy Pools v2**, *after M5*. Railgun isn't on Base; the **PP v2 SDK is early-access**, so request it from 0xbow. **Don't** substitute Fhenix: it would break "Nothing custom holds funds" and the screened-pool compliance model |
| Gateway audit mode, hosted gateway, migration, compatibility check | Deferred with the gateway (tier 2) |
| Scheduled pay runs (P2) | Not built (can't be demoed) |
| ERC-8004 binding (P2) | Hook only (ENSIP-25 needs a live registry) |
| Success-metric telemetry | Deliberately not built (it would need opt-in) |
| **Third-party SDK audit before a hosted gateway** | Not done; still required before mainnet |
| **Scan in under 10 s per year** | Not proven at scale (about 1.5 ms per announcement; parallel workers help, but 100k ≈ 150 s on one core) |
| Timing correlation | Not in the PRD's text, but it undermines Goal 2. A client-side randomized spend queue is queued |

## E. Where drift is actually happening (act on these)

1. **CK's frontend contradicts the PRD in three places.** The integration reverts all three (decisions recorded in `decision-ck-integration`):
   - **"reveal private key" spending** breaks Goal 3 (the wallet needs ETH, which links addresses) → our gasless spend;
   - **the non-atomic "sequential" pay mode** breaks invariant 3 → dropped;
   - **wallet-signature-only keys** differ from the PRD's "single seed the employee backs up" → phrase by default, signature as an option.
2. **Unlinkability in the UI:** the PRD's promise is unlinkability, but the demo doesn't yet *show* it (pending: the "coworker view vs my view" visual).
4. **The threat model is narrower than the PRD** (chain analysts are out of scope). That's fine for v1, but the PRD's positioning table still claims chain-analyst protection, so either update the PRD or don't claim it in the pitch.

## Recommended PRD edits (v1.1 changelog)

- Threat model: coworker-first; chain analysts are partial (guard + exit), with no RPC/bundler protection.
- Architecture: add `StealthDisperse` (no funds, no state) and the ENSv2 per-employee resolver; `addr` unset.
- Gateway: tier 2 / roadmap.
- Add the World ID rotation, invites and agent names as v1 features.
- Exit: minted to the same address; production chain TBD.
- Shielded rail: Privacy Pools v2 (Railgun unavailable on Base).
