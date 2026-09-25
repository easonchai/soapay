# Evidence D: private payment alternatives and build checks

Compiled 2026-09-25. Raw pages are in `scratchpad/.firecrawl/alternatives/`. Toku pages were read with WebFetch after firecrawl credits ran out (excerpts in `toku-webfetch-excerpts.md`). Quotes are verbatim, minus link markup. "Not found" means no fetched page said it.

## 1. Base Ledgers (Coinbase)

Launched June 16, 2026, "with Coinbase Developer Platform running the first Base Ledger." The product page says: "Base Ledgers combine instant onchain settlement with the confidentiality and built-in compliance your business requires."

**Architecture.** An operator runs an offchain ledger that settles on Base through one Portal contract. "The operator runs the services that process each step and decides how to authorize withdrawals." In Coinbase Managed mode, "Coinbase runs the Ledger and the compliance, so you get confidentiality without standing up any infrastructure." In self-managed mode: "Self-custody. Hold funds in a dedicated contract for your business." Base's docs never use the word sovereign.

**What is hidden, and from whom.** "Confidential by default. Senders and recipients stay hidden on the public chain; balances and transfers stay in your ledger." On Base, a deposit shows "The asset, amount, and sender", and a withdrawal shows the recipient and "the asset and amount". The operator, Coinbase in Managed mode, sees every balance and amount. Private receipt only works when the payee holds an account in the same ledger.

**Eligibility and custody.** "Base Ledgers is in early access." Managed mode sits in the custodial stack of a Coinbase Developer Platform business account: "The custodial stack also supports private onchain transactions via smart-contract based deposits and withdrawals from Base, using Base Ledgers." On compliance: "Compliance handled. KYC by Coinbase Direct, sanctions screening built in, and Coinbase handles licensing." Deposits "can also require an attestation or permission".

**Withdrawal to public Base.** The Portal validates withdrawals "from a signature check to full state-transition proofs". At the weakest setting, an operator signature releases funds.

**Not found:** pricing, regions, KYB criteria, or any individual or self-serve tier.

Sources: https://www.base.org/ledgers, https://docs.base.org/get-started/private-transactions (redirect target of docs.base.org/ledgers/overview), https://docs.base.org/build-on-base/ledgers/deposit, https://docs.base.org/build-on-base/ledgers/transfer, https://docs.base.org/build-on-base/ledgers/withdraw, https://docs.cdp.coinbase.com/payments/overview, https://x.com/CoinbaseDev/status/2066992742094483718

## 1a. Toku private payroll on Aleo (added)

"In January 2026, Toku launched a fully private stablecoin payroll system built on the Aleo blockchain and settled in USAD, a US dollar stablecoin issued by Paxos Labs."

- **Who can use it.** Enterprise clients. "Private stablecoin payroll will roll out to select Toku enterprise clients in Q1 2026, with full availability expected by mid-2026." Companies join a waitlist or "Book a demo". No self-serve signup was found.
- **Custody.** Not stated. Aleo's case study says: "Payroll funds flow into Toku's platform, compliance is handled in the existing HR stack, and settlement happens privately on Aleo."
- **Recipients.** No page says they need a Toku account. Pay settles "to each recipient in USAD on Aleo", so each needs an Aleo wallet.
- **What is hidden.** "Confidentiality applies to the public ledger, not to the employer's records."
- **Small teams.** Not without a sales process. Aleo's payroll page points them to wallet providers such as Dynamic and Utila: "Smaller teams paying a handful of contractors may want to start there."

Sources: https://www.toku.com/resources/how-toku-runs-fully-private-stablecoin-payroll-on-aleo-and-usad, https://www.toku.com/resources/aleo-toku-and-paxos-labs-launch-first-private-stablecoin-payroll-solution-removing-the-final-barrier-to-enterprise-stablecoin-adoption, https://aleo.org/post/toku-case-study/, https://aleo.org/payroll/

## 2. Fluidkey

A static ENS name (username.fkey.id) returns a fresh stealth Safe on each lookup, through an offchain resolver that Fluidkey runs.

**Trust model.** Users share "a BIP-32 derived node of their private viewing key with Fluidkey". So "only you and Fluidkey can see all transactions and assets." It cannot spend: "Fluidkey never asks for this key and can't access Alice's money."

**Own resolver.** Not offered. "Fluidkey's roadmap includes transitioning to a fully decentralized ENS Offchain Resolver."

**Batch payouts.** Not found in the full docs.

**Gas.** "There are no gas fees for 20 transactions per user per day, available on all chains except Ethereum mainnet."

**Consolidation.** Fluidkey picks source accounts automatically, which links them. Its FAQ example: "This means that the senders of the $100 & $1,000 and the recipients of the $800 & $250 would be able to tie these four transactions to you." It admits: "However, stealth addresses do not break traceability." Its "Hide Trail" exit routes through Houdini Swap exchanges, not a screened pool.

Sources: https://docs.fluidkey.com/technical-documentation/technical-walkthrough, https://docs.fluidkey.com/technical-documentation/ens-offchain-resolver, https://docs.fluidkey.com/readme/frequently-asked-questions, https://docs.fluidkey.com/readme/sending-funds, https://docs.fluidkey.com/readme/advanced-privacy, https://docs.fluidkey.com/llms-full.txt

## 3. Umbra (ScopeLift)

Umbra v1 is live, with a repo commit on Sep 23, 2026. Its FAQ lists its own StealthKeyRegistry, separate from ERC-6538. The FAQ lists mainnet, Sepolia, Optimism, Polygon and Arbitrum, and ScopeLift later "added support for Base".

**Umbra v2** appears only as a May 2024 proposal: "Prototyping Umbra v2 remains the last large task on our plate." No v2 launch appeared in any fetched page.

**Batch send.** The repo ships a periphery contract, UmbraBatchSend.sol. The app interface was not checked.

**Relayer trust model.** "By default, the Umbra app uses a relayer from the Umbra team." With a relayer, "fees can be paid with the received tokens". Users may pick "the relayer of your choice". The relayer is a liveness and censorship dependency.

**Prior art for Soapay's warning.** "To help mitigate this, the Umbra app will try to warn you if you enter a withdrawal address that might reduce your privacy."

Sources: https://app.umbra.cash/faq, https://scopelift.co/blog/introducing-umbra-v2-architecture, https://github.com/ScopeLift/umbra-protocol, https://github.com/ScopeLift/umbra-protocol/tree/master/contracts-periphery/src

## 4. Railgun

**Payroll flow.** The employer shields tokens, then sends privately to each worker's 0zk address. Workers need a Railgun wallet. "There are mandatory onchain protocol fees of 0.25% for shields and 0.25% for unshields." Entry and exit are public: "Shields and unshields show address, token and amount."

**Proof of Innocence.** After a shield, "this Unshield-Only Standby Period will be 1 hour". Broadcasters, who pay gas, require "a completed Private Proofs of Innocence check". The proof is optional: "Railgun protocol does not enforce any compliance measures."

**Chains.** Ethereum, Polygon, BSC, Arbitrum and the Sepolia testnet. Base is not listed.

**Compliance issues.** The FBI said North Korean actors "used RAILGUN, a privacy protocol, to launder over $60 million worth of ethereum (ETH)" in January 2023. L2BEAT: "The DAO can upgrade the contracts after a seven-day delay." No exchange delisting was found.

Sources: https://docs.railgun.org/wiki/assurance/private-proofs-of-innocence, https://docs.railgun.org/wiki/learn/helpful-links.md, https://l2beat.com/privacy/projects/railgun, https://www.fbi.gov/news/press-releases/fbi-confirms-lazarus-group-cyber-actors-responsible-for-harmonys-horizon-bridge-currency-theft

## 5. Privacy Pools (0xbow)

**Chains and assets.** The docs' deployments page lists only Ethereum Mainnet, with an ETH pool. An older 0xbow guide says: "Privacy Pools typically operates on Gnosis, and Ethereum Mainnet." L2BEAT tracks 14 assets on Ethereum, including ETH, USDC, USDT and DAI. **Base: not listed anywhere fetched.**

**Gating.** "The Association Set Provider is a crucial compliance layer that controls which deposits can be privately withdrawn from Privacy Pools." L2BEAT: "This set is managed in real time by the provider, which is currently a single entity." A 2/4 multisig controls the system, but users can always "publicly withdraw deposited tokens".

**Fees.** "0.5% vetting fee, 10% maximum relayer fee: BOLD, ETH, USDC."

**Deposit limits and mainnet gas cost:** unverified.

Sources: https://docs.privacypools.com/deployments, https://docs.privacypools.com/layers/asp, https://l2beat.com/privacy/projects/privacy-pools, https://0xbow.io/blog/getting-started-with-privacy-pools

## 6. Aztec

The Ignition Chain went live in November 2025 as a consensus layer, ahead of any execution environment. Execution now runs on V5, launched as "Alpha software, with V6 planned for later in 2026." On 27 July 2026, contributors found "a critical vulnerability affecting the V5 Alpha proving system". Aztec's guidance: "We expect teams planning a V5 deployment to pause that work until contributors publish further guidance."

**Small-team payroll today:** no. It is alpha software under an open incident, on a separate L2 from Base. Wallets were not verified.

Source: https://aztec.network/blog/aztec-ignition-chain-update, which carries the excerpt of https://aztec.network/blog/alpha-v5-proving-system-vulnerability

## 7. Tornado Cash

In August 2022, OFAC "sanctioned virtual currency mixer Tornado Cash, which has been used to launder more than $7 billion worth of virtual currency since its creation in 2019." Treasury cited mixing "with no attempt to determine their origin." On March 21, 2025, Treasury said it had "exercised our discretion to remove the economic sanctions against Tornado Cash". It still warned that "U.S. persons should exercise caution before engaging in transactions that present such risks." Unscreened pools carry sanction risk, even after a delisting.

Sources: https://home.treasury.gov/news/press-releases/jy0916, https://home.treasury.gov/news/press-releases/sb0057

## 8. Kohaku SDK (Ethereum Foundation)

Kohaku is an active wallet privacy monorepo, last committed Sep 25, 2026. The README warns: "Some parts of this project are work in progress and NOT READY FOR PRODUCTION USE. Packages contain UNAUDITED CODE." Five packages are marked done: privacy-pools, tornado-cash, plugins, provider and pq-account. The railgun package is still in progress. There is no stealth-address package.

Source: https://github.com/ethereum/kohaku

## 9. ScopeLift ERC-5564 and ERC-6538 contracts

**Verdict: yes.** Sepolia: yes. Base: yes. Base Sepolia: yes.

Every chain uses the same addresses. ERC5564Announcer is 0x55649E01B5Df198D18D95b5cc5051630cfD45564. ERC6538Registry is 0x6538E6bf4B0eBd30A8Ea093027Ac2422ce5d6538.

- **Mainnets:** Ethereum, Arbitrum, Base, Gnosis Chain, Optimism, Polygon, Scroll.
- **Testnets:** Sepolia, Holešky, Arbitrum Sepolia, Base Sepolia, Optimism Sepolia.

ScopeLift lists "ERC contracts audited by Trail of Bits" as complete.

Sources: https://github.com/ScopeLift/stealth-address-erc-contracts, https://scopelift.co/blog/introducing-umbra-v2-architecture

## 10. ENSv2

**Verdict: yes.** The deployments page has a "Sepolia (ENSv2 Beta)" section: "Sepolia runs the ENSv2 contracts: the Universal Resolver and the ENS apps for Sepolia resolve through this deployment."

- **Hierarchical registries.** "Name owners can deploy their own subname registry on demand."
- **Enhanced Access Control.** It replaces Name Wrapper fuses with "a new role-based permission system".
- **Permissioned Registry and Permissioned Resolver.** Each account gets its own resolver with per-record roles.
- **Wildcard-style resolution.** The overview never says "wildcard". Universal Resolver V2 picks the deepest resolver: "The resolver that covers the longest matching suffix of the name wins." A resolver found at a parent must support IExtendedResolver, the ENSIP-10 interface.

Sources: https://docs.ens.domains/ensv2/overview, https://docs.ens.domains/learn/deployments, https://docs.ens.domains/ensv2/registry-hierarchy, https://docs.ens.domains/ensv2/universal-resolver-v2

## 11. Account abstraction

**Verdict: yes** to both questions.

**EntryPoint v0.8.** The release notes list "Native support for EIP-7702 authorizations in the EntryPoint contract". The release also ships a Simple7702Account.

**USDC paymasters:**
- **Circle Paymaster v0.8** is on Base Sepolia and Ethereum Sepolia at 0x3BA9A96eE3eFf3A69E2B18886AcF52027EFF8966. Its quickstart covers "Setting up a 7702 smart account and checking its USDC balance". No signup: "You don’t need to sign up for a Circle Developer account". On cost: "The 10% surcharge only applies to Arbitrum and Base (and their testnets)."
- **Pimlico ERC-20 Paymaster** lists USDC on Sepolia and Base Sepolia for all users.
- **Alchemy** was not checked.

Sources: https://github.com/eth-infinitism/account-abstraction/releases/tag/v0.8.0, https://developers.circle.com/paymaster, https://developers.circle.com/paymaster/addresses-and-events, https://developers.circle.com/paymaster/pay-gas-fees-usdc, https://docs.pimlico.io/references/paymaster/erc20-paymaster/supported-tokens

## Gaps the pitch should state honestly

- **The screened exit is not on Base.** Privacy Pools runs on Ethereum mainnet. An exit from Base needs a bridge hop and mainnet gas.
- **Fluidkey already ships** a static ENS name, fresh stealth addresses and sponsored gas. Soapay's edge is batch payouts, the exit, and no server-held viewing key.
- **Umbra already warns** about risky withdrawal addresses.
- **Toku proves the enterprise demand** but sells through demos to enterprise clients, on Aleo rather than Base.
- **Resolver visibility.** An offchain ENS gateway would learn each payee's fresh addresses. This is inferred from the design, not documented.

## Comparison table

| Approach | Who can use it | What it hides | What it does not hide | Trust assumptions | Batch payouts | Gasless spend without linking | Screened exit |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Base Ledgers, Coinbase Managed | CDP business accounts, early access | In-ledger transfers; deposit recipient; withdrawal sender | Deposit sender, payout recipient, amounts; all data from Coinbase | Coinbase runs ledger, KYC, custody | Unverified | Unverified | Yes: KYC and sanctions screening |
| Base Ledgers, self-managed | Institutions in early access | Same | Same; all data from the operator | Operator; Portal checks vary | Unverified | Unverified | Operator-defined |
| Toku on Aleo | Enterprise clients, via waitlist or demo | Salary amounts and recipient identities | All data from the employer; funds pass through Toku | Toku platform; Paxos Labs issuer; Aleo | Yes: payroll runs | Unverified | Not described |
| Fluidkey | Individuals | Payee identity per payment | Sender, amount, history; all data from Fluidkey | Server holds a viewing key, runs resolver | No | Yes, 20 sponsored tx per day; consolidation links | No |
| Umbra v1 | Anyone | Payee identity per payment | Sender, amount, token | Team relayer by default | Yes: contract in repo | Yes, relayed tokens | No |
| Railgun | Railgun wallet users; not on Base | In-pool transfers | Shield and unshield details | DAO upgrades; broadcasters; list providers | Unverified | Yes, via broadcasters | Partial: optional proof |
| Privacy Pools | Ethereum mainnet users | Deposit-to-withdrawal link | Deposit and withdrawal details | One association set provider; 2/4 multisig | No | Yes, via relayers | Yes |
| Aztec | Alpha only | Private state | Unverified | Alpha V5 with a critical flaw | Unverified | Unverified | No |
| Tornado Cash | Anyone; sanctioned 2022 to 2025 | Deposit-to-withdrawal link | Deposits and withdrawals | No origin screening | No | Unverified | No |
| Soapay (as described) | Individuals and small teams on Base | Payee identity per payment; gas-funding link | Sender, amount, token, history | No custodian; bundler, USDC paymaster, ENS gateway | Yes | Yes: 7702 plus USDC paymaster | Yes, via Privacy Pools, not on Base |
