# Shielded rail and timing-correlation research

Research date: 2026-09-26. The same format as `docs/exit-research.md`. Every address marked "verified" was checked with `eth_getCode` (non-empty) on that date against `https://sepolia.base.org`, `https://mainnet.base.org` or `https://ethereum-sepolia-rpc.publicnode.com`, and live config values were read with `cast call`.

Threat model (CLAUDE.md): the adversary is a coworker who sees the batch on-chain and knows colleagues' main wallets. The employer is trusted. Third-party infra (RPC, bundler, paymaster, FHE or ASP operators) is accepted as-is.

**Verdict:**
- **Part A.** No production-grade shielded pool runs on Base or Base Sepolia today. Two options are demoable on a testnet:
  1. **Fhenix CoFHE confidential USDC on Base Sepolia.** It stays on Base, uses a public SDK and fits our stealth addresses. It needs one wrapper contract that we would deploy, and that contract holds the funds.
  2. **Privacy Pools v2 on Ethereum Sepolia.** This is a real shielded pool with private transfers, and it has an official payroll recipe. Its SDK is **not public yet** (early access only).

  Recommendation: build (1) for the demo, and request (2)'s SDK access today as the production track.
- **Part B.** Pre-signed userOps don't work with our stack: neither Simple7702Account nor the Circle paymaster returns a time window. The default should be a **client-side rate-limited spend queue** that spends at most one stealth address per randomized window across app sessions, with shuffle and round amounts. Route through the exit pool when the destination is identifying.

---

## Part A: shielded rail (hide per-person amounts)

### A1. Option matrix

| Option | Testnet status (verified) | USDC | SDK | Recipient format | Batch N payments | Demo risk |
| --- | --- | --- | --- | --- | --- | --- |
| Railgun | Ethereum Sepolia only, flagged `isDevOnlyNetwork`. **No Base or Base Sepolia** in the official config | Any ERC-20 via shield (0.25% fee) | `@railgun-community/wallet` (heavy). Kohaku's Railgun package is a **stub** | `0zk…` address (not ERC-5564) | One private transfer can carry several outputs | **High**: no public Sepolia broadcaster or POI node (see exit research) |
| Kohaku SDK | Wraps Privacy Pools **v1** and Tornado. The Railgun adapter is "under maintenance" and currently a stub | via PP v1 | `@kohaku-eth/*`, unaudited | — | — | Not a shielded-transfer rail today |
| **Privacy Pools v2** | **Live on Ethereum Sepolia (V9)**. Mainnet on Ethereum, BNB and Citrea. **Not on Base** | **Yes**: Circle Sepolia USDC enabled, min 1 unit, 1% vetting fee, ~1,597 USDC in the pool | `@privacy-pools-v2/sdk`: **not on npm, early access via @0xbowio** | EVM address with a viewing key registered in the Keystore, or out-of-band note, or payment request | ≤5×5 transact circuit. The official recipe does ~1 recipient per relayed transact, chaining change | **Medium-high**: SDK gated; staging relayer/ASP |
| Zama fhEVM + ERC-7984 | **Ethereum Sepolia only**. No code on Base Sepolia (checked ACL, Executor, registry) | Only `cUSDCMock` wrapping a **USDC mock**, not Circle USDC | `@zama-fhe/sdk` 3.6.0, `@openzeppelin/confidential-contracts` 0.5.3. Mature | Plain address (**works with stealth addresses**) | Batch via 7702/5792 from the employer | Medium; wrong chain |
| **Fhenix CoFHE + FHERC20** | **Live on Base Sepolia**: TaskManager verified. **Not on Base mainnet** | No official Circle-USDC wrapper found. **We would deploy `FHERC20ERC20Wrapper`** | `@cofhe/sdk` 0.7.1 (ships `baseSepolia` config), `fhenix-confidential-contracts` 0.4.0. Both **unaudited** | Plain address (**works with stealth addresses**) | `[confidentialTransfer, announce] × N` in one 7702/5792 batch | **Medium**: testnet FHE latency, WASM bundling, gas to be measured |
| Aztec (+ bridge) | Testnet on an Ethereum Sepolia L1. No Base. A critical proving-system vulnerability was disclosed on 2026-07-27 for alpha V5 | No canonical USDC; we would deploy a token plus a portal | aztec.js with a PXE | Aztec address | Private calls | **High**: new wallet stack, bridge, more than 3 days |
| Base-native shielded pools | None found live on Base Sepolia. Privacy Cash and Hinkal claim Base **mainnet** support; we found no testnet | — | — | — | — | Not demoable |

### A2. Verified addresses

**Privacy Pools v2, Ethereum Sepolia V9.** Source: [docs/deployments/sepolia](https://docs.privacypools.com/deployments/sepolia), mirrored at `privacy-pools-v2-docs.vercel.app`, updated 2026-09-22.

| Contract | Address | Check |
| --- | --- | --- |
| PoolVault | `0x09b94d3127019298757A6ceeB7911922085f7C01` | verified; no code on Base / Base Sepolia |
| Entrypoint | `0xEB3e3961008952348445513e418ad6F43C23ca9a` | verified. `assets(USDC)` = enabled, min 1, vetting **100 bps**, maxRelayFee uncapped |
| Keystore | `0x6d264aCb9C3A7A3105c29470AfE2F5F1EC203C73` | verified |
| ASPRegistry | `0x35D29EFDCf067599ab4A53cf40229477f0b1cA9c` | verified |
| PrivacyPoolRelay (docs) | `0x762665Dc7aAeeA25DC1759AEBef1F61730497f6e` | verified. `relay()` only, no `relayAndAnnounce`/`relayBatch` |
| Relay (staging relayer `/v1/details`) | `0x7430cc030d7eb8C83E76cD983996982C8C054204` | verified. **Differs from the docs**, so the relay was probably redeployed; confirm before use |
| ASP / relayer | `https://api-dev.0xbow.io`, `https://relayer-v2-staging-149184580131.us-east1.run.app` | both answered. The relayer lists ETH, USDC and USDT, `swapsSupported:false` |

- App: [v2.privacypools.com](https://v2.privacypools.com). A payroll PoC is referenced (`0xbow-io/PoC-Payroll`), but the repo is not public.
- What a coworker sees: the employer's deposit (the total, public); transact events with counts in/out and **no values or recipients**; each withdrawal's destination and amount ([threat model](https://docs.privacypools.com/introduction/threat-model)).
- The v2 SDK ships an ERC-5564 `stealth` module and supports `relayAndAnnounce` to the canonical announcer `0x55649E01…5564` (verified on Ethereum Sepolia). An employee could therefore withdraw to a fresh stealth address from our **existing meta-address**, once the relay that supports it is deployed.

**Fhenix CoFHE, Base Sepolia.** Sources: [cofhe-contracts FHE.sol](https://github.com/FhenixProtocol/cofhe-contracts/blob/main/contracts/FHE.sol), [fhenix-confidential-contracts](https://github.com/FhenixProtocol/fhenix-confidential-contracts), `@cofhe/sdk` `chains/baseSepolia.ts`.

| Item | Value | Check |
| --- | --- | --- |
| TaskManager | `0xeA30c4B8b44078Bbf8a6ef5b9f1eC1626C7848D9` | verified on Base Sepolia and Ethereum Sepolia. **No code on Base mainnet** |
| CoFHE endpoints | `testnet-cofhe.fhenix.zone`, `-vrf`, `-tn` | from the SDK config |
| USDC | Circle Base Sepolia `0x036CbD53842c5426634e7929541eC2318f3dCF7e` | the wrapper's underlying (from exit research) |
| Wrapper | **To deploy**: `FHERC20ERC20Wrapper(USDC)` linked to `ERC20ConfidentialLib` | Fhenix Pay mentions a "cUSDC" wrapper, but we found no published address |

Unwrap has three steps: burn, making the burned amount **publicly decryptable** → `decryptForTx` off-chain → `claimUnshielded(plaintext, proof)` ([wrapper docs](https://github.com/FhenixProtocol/fhenix-developer-docs/blob/main/fhe-library/confidential-contracts/fherc20/fherc20-wrapper.mdx)). **The unwrapped amount is public.**

**Zama, Ethereum Sepolia** ([addresses](https://docs.zama.org/protocol/solidity-guides/smart-contract/configure/contract_addresses)):

| Contract | Address | Check |
| --- | --- | --- |
| ACL | `0xf0Ffdc93b7E186bC2f8CB3dAA75D86d1930A433D` | verified on Ethereum Sepolia; absent on Base Sepolia |
| FHEVMExecutor | `0x92C920834Ec8941d2C77D188936E1f7A6f49c127` | verified on Ethereum Sepolia; absent on Base Sepolia |
| Wrapper registry | `0x2f0750Bbb0A246059d80e94c454586a7F27a128e` | verified on Ethereum Sepolia; absent on Base Sepolia |
| `cUSDCMock` | `0x7c5BF43B…3639` | wraps `USDCMock` `0x9b5Cd13b…DFfF`. `getConfidentialTokenAddress(Circle USDC)` returns none |

The changelog lists no Base deployment (v0.13, 2026-06-29, "improved multichain").

**Railgun.** In [shared-models network-config](https://github.com/Railgun-Community/shared-models/blob/main/src/models/network-config.ts) (last commit 2026-05-12), the networks are Ethereum, BNB, Polygon and Arbitrum, and the testnets are Ethereum Sepolia and Amoy (dev-only). There is **no Base**. [Kohaku README](https://github.com/ethereum/kohaku): the `@kohaku-eth/railgun` package is a placeholder. The `privacy-pools` package targets v1 Entrypoints only.

### A3. Recommended demo design: confidential USDC to stealth addresses (Fhenix CoFHE, Base Sepolia)

Why this one: it is the only option that is live on **Base Sepolia**, uses a **public** SDK, and **reuses the whole v1 stack** (ERC-6538 meta-address, ENS pinning, ERC-5564 scanning, 7702 + Circle paymaster spend). Stealth addresses keep hiding *who*, and FHE hides *how much*.

**Custom contract, unavoidable.** We would deploy one unmodified `FHERC20ERC20Wrapper` around Circle USDC, and it holds all shielded USDC. That is an exception to the "no custom contract holds funds" rule. It is an unaudited library contract, it has no Base mainnet path (CoFHE isn't on Base mainnet), and so it is **demo-only**. `StealthDisperse` stays unchanged.

**Flow:**
1. **Enrollment and name resolution: unchanged.** The sender resolves `<label>.soapay.eth` → pins the ERC-6538 meta-address → derives a stealth address `S_i` per line, as today. **No new ENS record is needed**, because decryption rights follow ownership of `S_i`, whose key only the employee can derive.
2. **Pay run** (employer, one atomic 7702 / EIP-5792 batch per ≤K lines, globally sorted as today):
   - `USDC.approve(wrapper, T)`, then `wrapper.wrap(employer, T)`. The public amount is the **total** payroll, which coworkers may know anyway.
   - Per line: `cUSDC.confidentialTransfer(S_i, encAmount_i)` + `USDC.transfer(S_i, stipend)` + `Announcer.announce(1, S_i, ephPub, metadata)`. The metadata amount field is set to 0, and scanners already ignore it.
   - `encAmount_i` comes from `@cofhe/sdk` `encryptInputs` with `account = employer`. CoFHE binds the input to the token's `msg.sender` (`batchVerifyInputs(inputs, msg.sender, sig)`). A 7702 batch keeps `msg.sender = employer`. Routing through `StealthDisperse` would make the contract the sender. It might still work if inputs are encrypted for that contract, but that is untested.
   - `stipend`: a **fixed, identical** plain-USDC amount per line (for example 0.5 USDC), so the stealth address can pay the Circle paymaster. It reveals nothing because it is uniform.
3. **Scan and balance** (recipient app): the existing scanner finds each `S_i`. For each one, read the encrypted balance handle. Sign a CoFHE permit (EIP-712) with the `S_i` key **in the client**. Call `decryptForView`. Fhenix's threshold network sees the permits (infra, accepted), and coworkers see nothing.
4. **Spend and exit:**
   - **Confidential spend**: `confidentialTransfer` from `S_i` to any address via `executeFromStealth` (7702 + Circle paymaster, paid from the stipend). The amount stays hidden.
   - **Unwrap to plain USDC**: burn → `decryptForTx` → `claimUnshielded`. **This reveals the unwrapped amount.** The app should unwrap only **fixed denominations** (for example 100 USDC) at randomized times and leave the remainder encrypted. That moves the PRD's "denominated payouts" from pay time to exit time.
   - Unwrapped USDC can then take the existing Privacy Pools exit.
5. **What a coworker learns:** total payroll, headcount (N stealth addresses), identical stipends, and later only denomination-sized unwraps. **No per-person amount.**

**Code placement.** A new `packages/sdk/src/shielded/` (`wrap`, `payConfidential` batch builder, `readEncryptedBalance`, `unwrapDenomination`) wraps `@cofhe/sdk`. A `contracts/script/DeployConfidentialUSDC.s.sol` deploys the wrapper. The sender app gets a "Shielded (beta)" toggle, and the recipient app gets balance decryption. Amount-hiding becomes a CI test: announcement metadata and calldata must carry no plaintext line amounts.

**Effort (~3 dev-days):**
- Day 1: deploy the wrapper, then write SDK wrap/encrypt/transfer and a scripted run on Base Sepolia.
- Day 2: recipient decrypt and unwrap/claim through `executeFromStealth`, plus bundling `@cofhe/sdk` (WASM) into the Vite SPA.
- Day 3: sender toggle, e2e script, recorded run.

**Risks:**
- CoFHE testnet latency and downtime (decryption is async).
- FHE gas per line is unknown. Measure it and **re-derive the 350-line cap**, which assumed ~42k gas per line.
- The unaudited wrapper.
- 4337 simulation limits on FHE calls in the spend path. Test unwrap via userOp early.
- The demo shows mechanics on a small testnet set.

**Production track: Privacy Pools v2.** It is the only candidate with a real shielded pool, private transfers, an official payroll recipe, selective-disclosure receipts, and the same ASP compliance as our exit. It needs no custom contract. The blockers are:
- **SDK access** (ask @0xbowio now).
- **No Base deployment.** The employer would bridge the total over CCTP to Ethereum (reusing `exit.ts`), or 0xbow deploys on Base.
- **A recipient identity.** Derive a dedicated "shielded account" key from the recovery phrase and register its viewing key in the Keystore. Publish that account's address as an ENSv2 text record `pp2` next to `stealth`, or hand it over at enrollment. Publishing reveals only that the person uses the pool, since in-pool recipients and values are hidden. Pinning rules match the meta-address.

  Employees exit through the v2 stealth withdrawal to their existing ERC-5564 meta-address.

If the SDK arrives within a day, v2 on Ethereum Sepolia is also ~3 days of work: bridge + deposit, a transfer loop, and discovery + stealth withdraw.

---

## Part B: timing correlation between a user's stealth addresses

Today `spendMany` sends one userOp per address with a 4 s floor + up to 20 s jitter (`apps/recipient/src/services/spend.ts`), so a user's spends land within ~minutes of each other. A coworker who sees three stealth addresses drain in one minute links them.

### B1. Verified facts for (b)

- **EntryPoint v0.8 supports time windows only if the account or paymaster returns them.** It reverts with `AA22 expired or not due` / `AA32 paymaster expired or not due` ([EntryPoint.sol v0.8.0](https://github.com/eth-infinitism/account-abstraction/blob/v0.8.0/contracts/core/EntryPoint.sol) L702/L714). Bundlers therefore reject not-yet-valid ops and do **not** hold them.
- **Simple7702Account returns only `SIG_VALIDATION_SUCCESS` or `SIG_VALIDATION_FAILED`**, with no `validAfter`/`validUntil` ([Simple7702Account.sol](https://github.com/eth-infinitism/account-abstraction/blob/v0.8.0/contracts/accounts/Simple7702Account.sol)).
- **The Circle paymaster returns `validationData = 0`** (verified source of implementation `0x6c13185b…2258` behind `0x3BA9…8966` on Sourcify, `TokenPaymasterV08.sol`). The permit it uses has `deadline = uint256.max`.
- So a pre-signed op is **valid immediately and forever**, until its nonce is used or its gas price or fee prefund drifts. It can't be time-locked without a custom account, and a custom account breaks "reuse an audited account".

### B2. Options

| Option | Protects against | Residual risk | UX cost |
| --- | --- | --- | --- |
| **(a) Client-side delayed queue.** Spends execute on later sessions, **at most one stealth address per randomized window** (for example exponential with mean 12 h and a 2 h floor), in random order. Keys unlock per session and are never persisted unlocked | Burst clustering: addresses no longer drain together | Session timing: every spend happens while the app is open, and a user who opens it rarely forms a pattern. Mitigated by the one-per-window cap and by skipping some sessions at random. The destination can still link (the guard covers this) | Money arrives hours to days later. The app must be reopened. Show "queued, ~next 3 days" |
| **(b) Pre-signed userOps held by a bundler or relayer** | Nothing in our stack: ops can't carry a valid-after time (B1) | A holder can submit any time. If a Soapay relayer holds N ops from one client, **the platform learns the linkage**, which violates the constraint. Stale `maxFeePerGas` and paymaster price make ops fail | Would be best-in-class UX if the account supported windows. **Rejected** |
| **(c) Route through the exit pool.** Each address deposits separately, and withdrawals are merged or spread | Destination linkage: deposit→withdraw is unlinkable, so withdrawals can even go to one wallet | **Deposit timing is still public**: N deposits from one user in a burst link the stealth addresses exactly as spends do, so it needs (a) on the deposit leg. Tiny anonymity set on testnet. Costs about 1% vetting + 0.1% relay + ~2 USDC CCTP forward, min 10 USDC, 10–12 min ASP wait | High; already built as the opt-in exit |
| **(d) Shuffle order + round amounts.** Spend addresses in random order (not derivation or ascending order). Spend round amounts rather than "max" | Order fingerprints and **sum matching** (a coworker summing spends to a known salary or chunk) | Leftover dust (fee remainder) needs a later sweep, which is itself a spend to schedule. Weak alone | Low: small leftovers per address |

### B3. Recommended default

1. **(a) + (d) on by default.** Replace `spendMany`'s seconds-level jitter with a persisted client queue in the recipient app, stored locally and encrypted with the session key (not with platform storage):
   - one address per window, windows randomized across sessions;
   - random address order;
   - round amounts, with a dust sweep that is scheduled like any other spend.

   Keep an explicit **"send now (links these addresses)"** override that goes through the guard's warning.
2. **(c) when the destination is identifying** (a coworker-known wallet, an exchange deposit address). The guard already routes these to the exit, and each deposit leg uses the same queue.
3. **Don't build (b).** Revisit only if a vetted 7702 delegate with time-bounded validation ships. Even then, submit through a public 4337 mempool, never through a Soapay-held relayer.
4. Add a CI privacy test: no two queued spends from one user fall in the same window, and the order is not monotonic.

Out of scope here (accepted in `decision-privacy-roadmap`): bundler, paymaster and RPC visibility, and the shared 7702 delegate fingerprint.

## Part C: Privacy Pools v2, context for the shielded rail

Source: https://privacy-pools-v2-docs.vercel.app/llms-full.txt (read 2026-09-26). The PRD names **Railgun or Privacy Pools v2** for the v2 shielded rail. Railgun isn't on Base, so PP v2 is the PRD-aligned path. Parts A and B above cover the rail and the timing question.

### What it is

A note-based shielded pool (UTXO model) with association-set (ASP) screening. That's the same compliance model as the v1 pool we already use for the exit.
- **Private transfers inside the pool:** notes are encrypted to the recipient's viewing key, so **amounts and parties are hidden**.
- **Withdrawals** to public addresses, including **stealth withdrawals**.
- **Payment requests, batch withdraw, yield, swaps, and selective-disclosure receipts** (useful for payroll compliance: an employee can prove one payment to a third party).

### Why it fits Soapay well

- **Stealth withdrawals use our exact scheme.** ERC-5564 **scheme 1 (canonical, `0x0001`)**, announced on **the same canonical Announcer** `0x5564…5564`, atomically with the withdrawal via `PrivacyPoolRelay.relayAndAnnounce` (the contract enforces that the announced address is the paid one). **Our existing scanner finds these payments unchanged.**
- **"Privacy-preserving group payouts"** is a documented capability: one sender pays many recipients, each by viewing pubkey. 0xbow has also built a **Payroll PoC** (Next.js), mentioned in their debugging docs.
- **USDC is supported on Sepolia:** `0x1c7D4B19…7238`, the same Circle USDC our exit already uses.
- **Selective disclosure:** a recipient can prove a single payment to an auditor without revealing others. It answers the "compliant" half of our pitch.

### Candidate design (for when we have SDK access)

1. **Employer:** deposits the total payroll into PP v2 once (one public deposit of the total), then after ASP approval sends **one private transfer per employee** to the employee's viewing key. Per-person amounts are never public.
2. **Employee:**
   - holds notes in the pool, and sees a balance via `discoverNotes()`;
   - cashes out with a **stealth withdrawal** to their Soapay meta-address, which our scanner picks up; or does a normal withdrawal through the relayer to any destination (the same property as our exit).
3. **Keys:** PP v2 derives its three keys from one EIP-712 signature (`deriveKeysFromSignature`, revocable index). We could sign that payload **with a key derived from the Soapay recovery phrase**, which gives deterministic ECDSA and keeps "the phrase recovers everything". That needs checking against their revocable-key design.
4. **Chain:** the pool is on **Ethereum (Sepolia for testing; Ethereum mainnet deployed; also BNB and Citrea)**, not Base. The employer bridges the total once (CCTP), or the employer pays from Ethereum.

### Constraints to plan around

- **The SDK isn't public:** early-access partners get the `v2-monorepo`. Request it via X: **@0xbowio**.
- **The Sepolia V9 relay exposes only `relay()`.** `relayAndAnnounce` (stealth withdraw), `relayBatch` and `registerAndRelay` need the newer relay, which is on **mainnet** (`PrivacyPoolRelay 0x01a8Fa4d…A461`, `MAX_BATCH()` = 10) and awaits a Sepolia redeploy.
- **Keystore registration is two transactions paid in ETH**, unless `registerAndRelay` is available.
- **The circuit caps transactions at 5 inputs × 5 outputs.** Paying N employees takes about N/4 transfers (or payment requests). Proving runs client-side, so artifacts must be served.
- **ASP approval of deposits** takes "often within an hour, up to 7 days".
- **Batch withdraw** requires the same recipient and token for every item.

### Sepolia V9 addresses (from the docs)

| | Address |
| --- | --- |
| PoolVault | `0x09b94d3127019298757A6ceeB7911922085f7C01` |
| Entrypoint | `0xEB3e3961008952348445513e418ad6F43C23ca9a` |
| Keystore | `0x6d264aCb9C3A7A3105c29470AfE2F5F1EC203C73` |
| ASPRegistry | `0x35D29EFDCf067599ab4A53cf40229477f0b1cA9c` |
| Relay (processor, V9) | `0x762665Dc7aAeeA25DC1759AEBef1F61730497f6e` |
| ASP | `https://api-dev.0xbow.io` |
| Relayer | `https://relayer-v2-staging-149184580131.us-east1.run.app` |

### Next step

Request SDK access from 0xbow, mentioning that our payroll use case needs group payouts plus stealth withdrawals to ERC-5564 scheme 1, and ask when `relayAndAnnounce` reaches Sepolia.
