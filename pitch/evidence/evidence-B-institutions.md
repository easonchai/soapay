# Evidence B: Institutions see the privacy gap and are building private rails

Checked 25 September 2026. Every quote matches fetched page text. I used firecrawl first, then WebFetch after firecrawl credits ran out. Raw firecrawl files are in `scratchpad/.firecrawl/institutions/`.

## 1. Coinbase launches Base Ledgers for private business payments
- **Date:** Launched June 16, 2026 at Coinbase's "Take Control" showcase, which was June 17 in Japan. Still in early access.
- **Source:** https://www.base.org/ledgers and https://docs.base.org/ledger/overview. Coverage: https://genfinity.io/2026/06/17/coinbase-take-control-everything-exchange-tokenized-stocks-ai-agents-mortgages/ and, in Japanese, https://www.neweconomy.jp/posts/584457
- **Quote:** "Onchain payroll without publishing what every employee or contractor earns."
- **What it is:** An operator-run private ledger anchored to Base through a single `Portal` contract. Deposits hide the recipient and withdrawals hide the sender. The asset and amount stay public at both ends.
- **Access:** Coinbase Managed uses KYC through Coinbase Direct, sanctions screening, and Coinbase licensing. A self-managed Partner Ledger uses your own custody and KYC. Atarashii Keizai reports: 「同基盤は現在早期アクセスとして提供されており、利用には申請が必要となっている。」
- **Key number:** None published.
- **Pitch use:** Coinbase names payroll as a core use case, but access is by application and an operator runs the ledger.

## 2. Stripe and Paradigm's Tempo names payroll as the first privacy problem
- **Date:** April 16, 2026 ("Privacy on Tempo").
- **Source:** https://tempo.xyz/blog/privacy-on-tempo/
- **Quote:** "A company running payroll would publish every salary."
- **Detail:** Tempo Zones are private parallel chains linked to Tempo Mainnet. The post says "The zone operator has visibility into all transactions within the zone." Zones are "available with design partners today". The Tempo homepage lists "Opt-in privacy for balances and transfers", and its partner logos include Deel and Gusto.
- **Key number:** None.
- **Pitch use:** Stripe's own chain states our problem in one sentence, but its fix is visible to the operator and limited to design partners.

## 3. Visa calls missing privacy a "dealbreaker" for banks
- **Date:** March 25, 2026.
- **Source:** https://usa.visa.com/about-visa/newsroom/press-releases.releaseId.22231.html
- **Quote:** "Many banks see the lack of privacy as a dealbreaker for moving meaningful activity onchain," said Rubail Birwadker of Visa.
- **Also in the release:** "Banks can’t run payroll if salaries are public, and trading firms can’t transact if positions, collateral, or margin movements are visible."
- **Key number:** Visa is one of 40 Canton Super Validators. Its stablecoin settlement runs at $4.6 billion annualized.
- **Pitch use:** This is the best single headline. The largest card network says public transparency blocks bank adoption.

## 4. Canton Network and Digital Asset: privacy built for regulated finance
- **Date:** The protocol page is undated. The plan to bring JPMD to Canton was announced January 7, 2026.
- **Source:** https://www.canton.network/protocol and https://blog.digitalasset.com/news/digital-asset-and-kinexys-by-j.p.-morgan-bring-usd-jpm-coin-jpmd-natively-to-canton
- **Quote:** "The Canton protocol supports sub-transaction privacy, meaning that parties can only see the part of a transaction that specifically applies to them."
- **Named participants verified:** Visa is a Super Validator. Kinexys by J.P. Morgan will issue JPMD natively on Canton, phased through 2026. I could not verify other bank names.
- **Key number:** 40 Super Validators (from item 3).
- **Pitch use:** Privacy chains exist, but they serve banks and trading desks, not a five-person team paying contractors.

## 5. JPMorgan puts JPMD on Base, but only for its own clients
- **Date:** Pilot announced June 2025. Live for institutional clients per an April 28, 2026 update.
- **Source:** https://www.jpmorgan.com/payments/newsroom/kinexys-usd-digital-deposit-tokens, https://www.jpmorgan.com/payments/newsroom/kinexys-milestones-2026 and https://www.jpmorgan.com/insights/podcast-hub/making-sense/kinexys-blockchain-shift
- **Quote:** "JPMD is a first-of-its-kind permissioned deposit token, to exclusively enable J.P. Morgan’s institutional clients to securely send and receive money onchain, enhancing the digital payments ecosystem."
- **Confidentiality:** On a June 2, 2026 J.P. Morgan podcast, Kinexys head Oliver Harris said public blockchains "were radically transparent by design". He added: "And until recently, there were some trade-offs between compliance, privacy, and finality." In January 2026, Kinexys also agreed to issue JPMD on Canton.
- **Key number:** Kinexys has processed "more than $3 trillion in transactions since inception". It averages "more than $5 billion daily".
- **Pitch use:** The largest US bank calls public chains radically transparent, limits JPMD to vetted clients, and is adding a privacy chain.

## 6. Circle's Arc mainnet launches with privacy still "in development"
- **Date:** Mainnet launched September 16, 2026. The August 2025 announcement was not fetched.
- **Source:** https://www.circle.com/pressroom/circle-launches-arc-mainnet-an-economic-operating-system-for-the-internet and https://docs.arc.io/arc/concepts/opt-in-privacy
- **Quote:** "Arc's opt-in privacy design, currently in development for network-wide release, provides enterprises with the confidentiality their businesses require and the auditability compliance teams look for, together on one network."
- **Detail:** The docs say "Privacy features are on the roadmap and not yet available on Arc." The planned Arc Privacy Sector runs on validators inside hardware enclaves.
- **Key number:** More than 100 institutional and ecosystem builders were live at launch. Founding validators include BlackRock, DTCC, Visa, Mastercard, SBI Group and Sumitomo Corporation.
- **Pitch use:** Circle calls confidentiality a business requirement but has not shipped it yet. SBI and Sumitomo make this point land in Tokyo.

## 7. FIS survey: privacy ties for the top stablecoin barrier
- **Date:** November 11, 2025. The survey ran in October 2025.
- **Source:** https://www.fisglobal.com/about-us/media-room/press-release/2025/fis-research-banks-hold-the-key-to-stablecoin-adoption
- **Quote:** "Security and privacy concerns emerged as the top barriers to adoption (42.4% each), while nearly half (42%) of respondents expressed concern about value volatility."
- **Key number:** 42.4%, from 1,000 U.S. consumers employed full-time.
- **Pitch use:** The people who receive payouts rank privacy as a top barrier. The caveat is that these are consumers, not institutions.

## 8. a16z State of Crypto 2025: privacy "could be a prerequisite"
- **Date:** October 2025.
- **Source:** https://a16zcrypto.com/posts/article/state-of-crypto-report-2025/
- **Quote:** "Privacy is returning to the foreground and could be a prerequisite for wider adoption."
- **Key numbers:** Stablecoins did $46 trillion in transaction volume in the past year, up 106%. Adjusted volume was $9 trillion, up 87%. Railgun flows passed $200 million a month.
- **Pitch use:** This puts market size and privacy as the missing piece on one slide.

## 9. EDPB final guidelines: wallet addresses may be personal data
- **Date:** Version 2.0 was adopted July 7, 2026. The draft, version 1.1, was adopted April 8, 2025.
- **Source:** https://www.edpb.europa.eu/documents/guideline/guidelines-on-processing-of-personal-data-through-blockchain-technologies_en
- **Quote:** "On-chain metadata, including transaction identifiers, wallet addresses, event logs, receipts, state transitions and smart contract storage and related traces, may constitute personal data when they enable direct or indirect identification of a natural person"
- **Also:** Storing personal data on-chain as plain text "is strongly discouraged".
- **Salary:** The fetched text does not mention salary. Treating a linked payout amount as personal data is our reading of GDPR, not a quoted ruling.
- **Key number:** None.
- **Pitch use:** Under EU law, a public payroll transfer can become permanent personal data that cannot be erased.

## 10. Japan's APPI: identifiable wage data is personal information
- **Date:** Current official English translation.
- **Source:** https://www.japaneselawtranslation.go.jp/en/laws/view/4241/en
- **Quote (Article 2(1)):** "Personal information" in this Act means information relating to a living individual which falls under any of the following items:
- **Detail:** Item (i) covers information that "can be easily collated with other information and thereby used to identify that specific individual". Article 74(2)(iii) names employee files on "personnel, wages, welfare benefits". That clause sits in the public-sector chapter.
- **Salary:** Applying the Act to on-chain payouts is our reading, not regulator guidance.
- **Pitch use:** For the Tokyo audience: once a wallet can be matched to a worker, every public payout becomes personal information.

## 11. Vitalik Buterin's April 2025 privacy roadmap
- **Date:** April 10, 2025 for the roadmap. April 14, 2025 for "Why I support privacy".
- **Source:** https://ethereum-magicians.org/t/a-maximally-simple-l1-privacy-roadmap/23459 and https://vitalik.eth.limo/general/2025/04/14/privacy.html
- **Quote:** "Wallets should have a notion of a shielded balance, and when you send to someone else, there should be a “send from shielded balance” option, ideally turned on by default."
- **Also:** "Privacy is an important guarantor of decentralization: whoever has the information has the power, ergo we need to avoid centralized control over information."
- **Key number:** Privacy of onchain payments is the first of four areas in the roadmap.
- **Pitch use:** Our product does the first thing Ethereum's cofounder asked wallets to do.

## 12. Ethereum Foundation: privacy becomes the default
- **Date:** The Privacy Cluster launched in October 2025. The ethereum.org roadmap page is undated.
- **Source:** https://ethereum.org/roadmap/privacy/ and https://decrypt.co/343614/ethereum-foundation-launches-new-cluster-focused-on-privacy
- **Quote:** "Privacy on Ethereum is moving from an optional add-on to a network-level default."
- **Detail:** The roadmap page says "Anyone can see who sent how much to whom" and "The Kohaku wallet SDK is under development". EIP-8182 proposes a native shielded pool for ETH and ERC-20 transfers in the Hegotá upgrade. Decrypt quotes the Foundation: "Privacy is normal. Privacy is for everyone."
- **Key number:** The Privacy Cluster has 47 researchers, engineers, coordinators, and cryptographers.
- **Pitch use:** Ethereum is moving toward private payments, but protocol-level privacy has not shipped. We fill that gap now.

## Strongest five for a slide
1. **Visa:** "Many banks see the lack of privacy as a dealbreaker for moving meaningful activity onchain" (item 3).
2. **Tempo:** "A company running payroll would publish every salary." (item 2)
3. **Base Ledgers:** Coinbase lists private payroll as a use case, but only by application in early access (item 1).
4. **FIS:** Privacy ties for the top stablecoin barrier at 42.4% (item 7).
5. **EDPB, July 2026:** Wallet addresses may be personal data (item 9). Swap in a16z's $46 trillion figure if the slide needs market size.

## Where I found nothing
- **EY-Parthenon:** The 2026 EY-Parthenon and Coinbase survey of 351 institutional decision-makers has no privacy figure. CoinDesk reports "66% also called regulatory uncertainty a primary concern when investing in digital assets." Source: https://www.coindesk.com/business/2026/03/18/large-investors-are-doubling-down-on-crypto-but-getting-a-lot-pickier-about-risk
- **Fireblocks State of Stablecoins 2025:** The search result text has no privacy barrier figure. It lists "greater transparency" as a benefit, cited by 36%.
- **Coinbase:** The Coinbase Developer Platform launch post on X blocked fetching, so its text is unquoted: https://x.com/CoinbaseDev/status/2066992742094483718. I found no executive quote. The word "sovereign" does not appear in the fetched Base pages.
- **Circle, August 2025:** I did not fetch the original Arc announcement.
- **Plasma:** Its docs list "privacy" among payment product needs, but no primary page confirms live confidential payments.
- **Stable and Chainalysis:** I did not research either.
- **Kohaku SDK:** Its release, reported for May 25, 2026, appears only in search summaries.
- **GDPR salary precedent:** The likely case is the CJEU's Österreichischer Rundfunk ruling (C-465/00, May 20, 2003) on disclosing public employees' salaries. Every copy I tried was blocked or blank, so verify before quoting.
- **Japan regulator guidance:** A definition covering "property, occupation and title" surfaced only in a search snippet of an industry PDF.
- **Canton:** I verified no bank participants beyond Visa and J.P. Morgan.
