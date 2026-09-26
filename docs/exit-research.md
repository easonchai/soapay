# Compliant exit research (PRD Flow 4)

Research date: 2026-09-25. Every address below was checked with `eth_getCode` (non-empty) against public RPCs on that date, unless marked otherwise. Live pool parameters were read with `cast call Entrypoint.assetConfig(asset)`.

**Verdict:** an end-to-end exit is demoable on testnet this week. 0xbow Privacy Pools runs a **USDC pool on Ethereum Sepolia** with a working testnet ASP that approves deposits in about 10 to 12 minutes, and a public relayer charges 0.1%. Circle CCTP V2 and the Circle Paymaster v0.8 both run on Base Sepolia and Ethereum Sepolia. With these, a stealth address can bridge, deposit and exit while only ever holding USDC.

> **Correction (2026-09-26, D-48):** the testnet relayer is not 0.1%. `/relayer/details` reports `feeBPS 10`, but `/relayer/quote` adds a fixed ≈ 21.5 USDC for its gas (650k gas), e.g. 21,517 bps on 9.95 USDC and 2,150 on 100; the pool caps relayer fees at 30% (`maxRelayFeeBPS` 3000). The Sepolia deposit's paymaster fee is ≈ 5.1–5.8 USDC. Below ≈ 81 USDC per leg the SDK withdraws directly from the destination wallet instead (it pays Sepolia ETH gas).

## 1. 0xbow Privacy Pools

Sources:
- [privacy-pools-core](https://github.com/0xbow-io/privacy-pools-core) (contracts, SDK, relayer)
- [privacy-pools-website `src/config/chainData.ts`](https://github.com/0xbow-io/privacy-pools-website/blob/main/src/config/chainData.ts). This is the live pool registry. The docs [deployments page](https://docs.privacypools.com/deployments) is stale and lists only the mainnet ETH pool.

### Testnet (usable now)

| Item | Value |
| --- | --- |
| Chain | Ethereum Sepolia (11155111) |
| Entrypoint (proxy) | `0x34A2068192b1297f2a7f85D7D8CdE66F8F0921cB` |
| USDC pool | `0x0b062Fe33c4f1592D8EA63f9a0177FcA44374C0f` (asset is Circle Sepolia USDC `0x1c7d4b196cb0c7b01d743fbc6116a902379c7238`) |
| USDC pool on-chain config | min deposit **10 USDC**, vetting fee **1%** (100 bps), max relay fee 30% |
| USDC pool UI cap | maxDeposit 100 USDC (a UI setting, not read on-chain) |
| USDC pool scope | `18021368285297593722986850677939473668942851500120722179451099768921996600282` |
| USDC pool state | 290 leaves, ~2,706 USDC held. ASP stats: 177 deposits, 158 accepted |
| ETH pool | `0x644d5A2554d36e27509254F32ccfeBe8cd58861f`, min 0.001 ETH, UI cap 1 ETH |
| USDT pool | `0x6709277E170DEe3E54101cDb73a450E392ADfF54` (test token `0xaA8E…33D0`) |
| Optimism Sepolia | WETH pool only (`0x6d79e606…dA6`, Entrypoint `0x54aCA0D2…1ba1`). Not verified on-chain. |
| Testnet ASP API | `https://dw.0xbow.io/{chainId}/public/...`. Send the pool scope in the `X-Pool-Scope` header. Endpoints: `events`, `mt-roots`, `mt-leaves`, `pool-info`, `pools-stats`. Each event carries `reviewStatus` (`approved` etc.). Verified live. |
| Testnet relayers | `https://testnet-relayer.privacypools.com` (Sepolia USDC: `feeBPS 10`, min withdraw 100 units) and `https://fastrelay.xyz` (`feeBPS 10`). API: `GET /relayer/details?chainId&assetAddress`, `POST /relayer/quote`, `POST /relayer/request`. Verified live. |
| Testnet UI | `testnet.privacypools.com` returned Cloudflare **522** on 2026-09-25. We don't need it, because the SDK, ASP API and relayer all respond. |

**ASP approval time (testnet), observed:** each `Deposited` event on the Sepolia Entrypoint was followed by a `RootUpdated` 49 to 60 blocks later, which is **about 10 to 12 minutes** (six samples, blocks 11738660 to 11769931). On testnet the ASP approves ordinary deposits. The 19 unaccepted deposits are either pending or declined.

**Mainnet approval time:** 0xbow does not document it anywhere we could find ([getting started](https://0xbow.io/blog/getting-started-with-privacy-pools), [ASP layer](https://docs.privacypools.com/layers/asp)). We did not measure it.

### Mainnet (for reference and v1 production)

| Chain | Entrypoint | USDC pool | Min / vetting fee | Leaves |
| --- | --- | --- | --- | --- |
| Ethereum | `0x6818809EefCe719E480a7526D76bD3e561526b46` | `0xb419c2867aB3CBc78921660cB95150d95A94ce86` | 25 USDC / 0.5% | 2636 |
| Optimism | `0x44192215FEd782896BE2CE24E0Bfbf0BF825d15E` | `0xe4410f6827FA04cE096975D07A9924ABb65316e3` | 5 USDC / 0.5% | 199 |
| Arbitrum | `0x44192215…d15E` | `0x3706e38a…093f` (not verified on-chain) | — | — |
| Base | `0x44192215…d15E` | **none**. An ETH pool `0x4626A182…18ff` is deployed (5 leaves), but the UI hides it and `assetConfig(USDC)` returns zero. | — | — |

Ethereum mainnet also has ETH, USDS, sUSDS, DAI, USDT, wstETH, wBTC, USDe, USD1, frxUSD, WOETH, fxUSD and BOLD pools. Mainnet relayer `fastrelay.xyz` charges 10 bps on Ethereum and Optimism USDC.

### SDK and contract API

- npm: [`@0xbow/privacy-pools-core-sdk`](https://www.npmjs.com/package/@0xbow/privacy-pools-core-sdk) v1.5.0 (2026-08-31, ~22 MB unpacked because it bundles the circuit artifacts). The API: `PrivacyPoolSDK(new Circuits({browser}))`, `generateMasterKeys(mnemonic)`, `generateDepositSecrets(keys, scope, index)`, `proveWithdrawal(commitment, input)`, `AccountService.initializeWithEvents(dataService, {mnemonic}, pools)` for recovery, and `createContractInstance(...)`. See the [SDK README](https://github.com/0xbow-io/privacy-pools-core/blob/main/packages/sdk/README.md).
- Deposit: `Entrypoint.deposit(IERC20 asset, uint256 value, uint256 precommitment)` calls `safeTransferFrom(msg.sender)` and records `msg.sender` as the depositor. There is no EOA or `code.length` check, so a 7702-delegated stealth address can batch `approve` and `deposit` in one userOp.
- Withdraw: `Entrypoint.relay(withdrawal, proof, scope)`. The relayer submits the tx and pays gas, then takes its fee from the withdrawn amount, so the destination needs no gas.
- Ragequit: `PrivacyPool.ragequit(proof)` works only when `msg.sender == depositors[label]`. The stealth address can ragequit through the same 7702 and paymaster path. A ragequit returns the funds publicly to the depositor.
- A withdrawal must prove that the deposit label is in the ASP root. The ASP leaves come from `mt-leaves`.

## 2. Alternatives

- **Railgun**: deployed on Ethereum Sepolia (proxy `0xeCFCf3b4eC647c4Ca6D49108b311b7a7C9543fea`, verified). Private POI has been live since block 5944700 ([shared-models network-config](https://github.com/Railgun-Community/shared-models/blob/main/src/models/network-config.ts), [PPOI wiki](https://docs.railgun.org/wiki/assurance/private-proofs-of-innocence)). The same config flags Sepolia `isDevOnlyNetwork: true`. We found no public Sepolia broadcaster or POI node, and the Railgun wallet SDK is much heavier than 0xbow's. Not the pick for this week.
- **Privacy Pools on other chains**: covered in §1. Optimism mainnet USDC is the cheapest production venue, and Circle Paymaster v0.8 plus CCTP both support Optimism.
- **Nothing else** with association-set screening is live on a testnet as far as we found.

**Demoable this week:** Privacy Pools on Ethereum Sepolia, USDC pool.

## 3. Bridging with CCTP V2

Source: [Circle contract addresses](https://developers.circle.com/cctp/references/contract-addresses). All three contracts below have the same address on both chains, verified on both.

| | Base Sepolia (domain **6**) | Ethereum Sepolia (domain **0**) |
| --- | --- | --- |
| TokenMessengerV2 | `0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA` | same |
| MessageTransmitterV2 | `0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275` | same |
| TokenMinterV2 | `0xb43db544E2c27092c107639Ad201b3dEfAbcF192` | same |
| USDC | `0x036CbD53842c5426634e7929541eC2318f3dCF7e` | `0x1c7d4b196cb0c7b01d743fbc6116a902379c7238` |
| Circle Paymaster v0.8 | `0x3BA9A96eE3eFf3A69E2B18886AcF52027EFF8966` | same ([Circle paymaster addresses](https://developers.circle.com/paymaster/addresses-and-events)) |
| EntryPoint v0.8 / Simple7702Account | `0x4337084D…F108` / `0xe6Cae83B…555B` | same, both verified |
| Bundler | `public.pimlico.io/v2/84532/rpc` | `public.pimlico.io/v2/11155111/rpc` (supports EP v0.8, verified) |

- **Fees:** the sandbox endpoint `GET /v2/burn/USDC/fees/6/0` returns fast (`minFinalityThreshold 1000`) = 1.3 bps and standard (2000) = 0. Fast transfers attest in seconds. Standard transfers wait for Base finality, which is tens of minutes.
- **Attestation:** `GET https://iris-api-sandbox.circle.com/v2/messages/6?transactionHash=…`.
- **Source side:** yes, the stealth address can burn. `depositForBurn` is an ordinary call made by `msg.sender`, so the existing `executeFromStealth` (`packages/sdk/src/spend.ts`) can run `[USDC.approve(TokenMessengerV2), TokenMessengerV2.depositForBurnWithHook(...)]` in one 7702 userOp, with the Circle paymaster taking gas in USDC. Pass `feeTokenSpend = amount`.
- **Destination mint without ETH:** use the **Circle Forwarding Service** ([docs](https://developers.circle.com/cctp/concepts/forwarding-service)):
  - Pass hookData `0x636374702d666f72776172640000000000000000000000000000000000000000` (`cctp-forward`, v0) and a `maxFee` that covers the protocol fee plus the forward fee.
  - Circle then submits the mint on the destination chain itself.
  - Live quote `GET /v2/burn/USDC/fees/6/0?forward=true`: forwardFee 1.54 / 1.87 / 2.21 USDC (low / med / high), charged in USDC out of the minted amount.
  - Alternative: our `apps/api` relayer calls `receiveMessage` with its own Sepolia ETH. This costs nothing, but it adds a party that knows the message.
- **Mint recipient:** `mintRecipient` should be the **same stealth address**. It is the same key and the same EOA on Ethereum Sepolia. On arrival it delegates via 7702 and deposits with the Circle paymaster (v0.8 is live on Ethereum Sepolia), and never holds ETH.
- **Hooks can't deposit directly:** CCTP hooks carry data only. Calling `Entrypoint.deposit` automatically would need a custom receiver contract. That breaks the "no custom contract holds funds" rule, and it would make the contract the pool depositor, so ASP screening would apply to it and only the contract could ragequit. Rejected.
- **A fresh address adds nothing:** the burn message publicly names `mintRecipient`, so a fresh address is linked to the stealth address on-chain anyway. It only adds key management.

## 4. Linkability

What the exit hides: the link from the pool deposit (depositor = stealth address) to the withdrawal (recipient = destination). A coworker already knows the stealth addresses are payroll recipients. Bridging each address separately to itself keeps addresses unlinked to each other, provided each address follows its own path and nothing combines them before the pool.

Residual correlations:
- **Amounts:** Privacy Pools v1 does not merge notes, so every deposit is withdrawn separately.
  - A withdrawal of `deposit − 1% vetting − 0.1% relay` matches its deposit exactly.
  - N withdrawals to the same destination link to each other (though not to their deposits).
  - Salary-sized amounts in a small pool point to the depositor.
  - Mitigations:
    - Use the PRD's denominated chunks, so all deposits look alike.
    - Make partial withdrawals of round amounts that differ from any deposit.
    - Leave some change in the pool.
- **Timing:** payday produces a burst of deposits. A deposit and withdrawal close together, or withdrawals right after the ASP root update, correlate. Mitigation: randomized delays of hours to days after approval, and withdrawals spread over time.
- **Anonymity set:** the testnet USDC pool holds ~158 approved deposits and ~3.4k USDC, and the Optimism mainnet pool has 199 leaves. Both are tiny. Ethereum mainnet (2,636 leaves) is the only meaningful set.
- **Relayer:** it sees the withdrawal but not the deposit. The 0xbow guide only recommends "a fresh address" for withdrawals. We found no official timing or amount guidance.
- **Out of scope** (per the threat model): Circle (CCTP, forwarder, paymaster), the bundler, and RPC providers all see both chains.

## 5. Recommendation

**Testnet demo design** (Base Sepolia to Ethereum Sepolia; no ETH ever reaches a stealth address):

1. **Bridge (Base Sepolia).** Per stealth address `S`, run one 7702 userOp with the Circle paymaster: `USDC.approve(TokenMessengerV2, a)` then `depositForBurnWithHook(a, 0, bytes32(S), USDC, 0, maxFee, 1000, cctp-forward)`. Only `S` is involved, so the consolidation guard is satisfied.
2. **Mint.** Poll iris for the attestation. The Forwarding Service mints on Ethereum Sepolia to `S` (seconds to minutes).
3. **Deposit (Ethereum Sepolia).** On `S`, run one 7702 userOp with Circle paymaster v0.8: `USDC.approve(Entrypoint, d)` then `Entrypoint.deposit(USDC, d, precommitment)`. Take the precommitment from `generateDepositSecrets` with a Privacy Pools mnemonic held client-side.
4. **Wait for approval.** Poll `dw.0xbow.io/11155111/public/mt-leaves` for the label, or `events` for `reviewStatus`. Expect about 10 to 12 minutes.
5. **Withdraw.** Build the withdrawal proof in the browser (SDK `proveWithdrawal`), then request a quote and relay through `testnet-relayer.privacypools.com`. The recipient is the destination, and the relayer pays gas.
6. **Fallback.** If the ASP declines, ragequit from `S` through the same 7702 path. The funds come back publicly.

**Required changes:**
- Add Ethereum Sepolia to `packages/sdk/src/constants.ts` and `paymasters/circle.ts` (`11155111: 0x3BA9…8966`).
- Add a `packages/sdk/src/exit/` module wrapping CCTP and `@0xbow/privacy-pools-core-sdk`.
- Build the recipient UI for the guard's "exit via Privacy Pools" branch.

**Effort:** roughly 3 to 5 dev-days.
- SDK plumbing and CCTP: 1 day.
- Privacy Pools deposit, account recovery and withdraw proof: 2 days. Port the flow from the website repo's `utils/sdk.ts`, `proof.ts` and `relayerClient.ts`.
- UI and a scripted end-to-end run: 1 to 2 days.

**Funding:** each stealth address needs at least ~13.5 USDC (10 USDC min deposit + ~2.2 forward fee + ~0.1 CCTP + paymaster gas + 1% vetting). The Circle faucet gives 20 USDC per 2 h per address per chain ([faucet](https://faucet.circle.com/)), so fund the employer and pay lines of about 15 USDC.

**Demo risks:**
- **Circle paymaster permit on Ethereum Sepolia.** The 7702/ERC-1271 permit path is proven only on a Base fork. Run a Sepolia fork test first.
- **Testnet ASP or relayer downtime.** The UI was returning 522 today. Have a recorded run ready.
- **Forwarding Service.** On testnet it is new and pricey (~2 USDC). If it fails, fall back to our API calling `receiveMessage`.
- **Browser proving.** Circuit artifact download and proving time need checking.
- **The demo shows mechanics, not privacy.** The testnet anonymity set is small.

**Production note:** consider the **Optimism** USDC pool: min 5 USDC, 0.5% vetting fee, cheap gas, and Circle paymaster and CCTP are both supported. The PRD assumes Ethereum mainnet, which has the far larger anonymity set but costs mainnet gas. That trade-off should go to the team. Privacy Pools has no USDC pool on Base.
