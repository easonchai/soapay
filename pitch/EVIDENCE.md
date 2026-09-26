# Pitch evidence

The six research digests behind the Problem slides, in one file: A incidents, B institutions, C scale, D alternatives, E companies and vendors, F companies and DAOs. Every quote marked "verified" was matched word for word against the fetched page on Sep 25, 2026.

## A. Evidence A: on-chain payment exposure incidents

Method: 13 cases. Every quote below was checked word for word against a page fetched with firecrawl on September 25, 2026. Raw pages are saved in `.firecrawl/incidents/` in the scratchpad. Items 9 to 13 involve leaked databases or known wealth, not chain reads. Use them to show the harm, not to prove that a block explorer caused an attack.

### Income and relationships made readable

**1. ZachXBT publishes an influencer price sheet with on-chain payment receipts**
- Date: September 1, 2025
- Source: https://www.theblock.co/news/business/2025-09-01-zachxbt-says-over-100-crypto-influencers-accepted-promo-deals-without-disclosing-paid-ads-368956
- Quote: "On Monday, the web3 investigator published a spreadsheet that lists pricing and wallet addresses for more than 200 crypto influencers contacted to promote a token campaign."
- Numbers: 200+ influencers priced. About 160 accepted, and fewer than five labeled their posts as ads. Per-post prices ran from hundreds of dollars to five figures. Payments were on Solana, not Ethereum.
- Pitch use: A payment is a receipt anyone can publish, so a payer's wallet reveals everyone it paid and how much.

**2. One old post let sleuths map MrBeast's whole wallet network**
- Date: October 30, 2024
- Source: https://beincrypto.com/mrbeast-crypto-insider-trading-allegations/
- Quote: "MrBeast doxxed his own primary wallet address via a 2021 social media post."
- Numbers: Loock Advising alleges at least $23 million in profits across three years of tracked activity. These are allegations, not findings.
- Pitch use: This is the cleanest proof of the thesis. One address tied to one name let investigators rebuild a three-year financial history from chain data.

**3. Arkham matches Donald Trump's disclosed crypto balance to an NFT royalty wallet**
- Date: August 16, 2023
- Source: https://info.arkm.com/announcements/donald-trumps-crypto-holdings-are-now-on-arkham
- Quote: "This is almost identical to the present balance of the largest royalty fee wallet associated with the Collect Trump NFT Project."
- Numbers: Trump's financial statement listed a crypto balance of $2,806,341. Arkham then published a public profile for wallet 0x94845333028B1204Fbe14E1278Fd4Adde46B22ce.
- Pitch use: One matching number turned a public figure's royalty income into a live public feed.

**4. Arkham launches Intel Exchange, the "dox-to-earn" marketplace**
- Date: went live Monday, July 17, 2023. Decrypt reported it on July 18, 2023.
- Source: https://finance.yahoo.com/news/arkham-dox-earn-platform-offers-181403790.html
- Quote: "Critics derided Arkham's initiative as effectively a 'dox-to-earn program,' while others called it 'absolutely brilliant.'"
- Numbers: Arkham's own headline bounty offered 100,000 ARKM tokens for identifying whoever took $415 million from FTX.
- Pitch use: Unmasking wallet owners is now a paid job with posted prices. A pseudonymous address stays private only until someone funds a bounty.

### Payroll, DAO pay and grants

**5. Payroll vendor Toku says public-chain payroll exposes every salary**
- Date: private payroll launched January 2026. Page fetched September 2026.
- Source: https://www.toku.com/resources/how-toku-runs-fully-private-stablecoin-payroll-on-aleo-and-usad
- Quote, from CEO Ken O'Friel: "Every public company CFO we talk to gets excited about stablecoins until they realize their payroll would be public."
- Numbers: Toku says it has processed more than $1 billion in token payroll volume. Its comparison table marks salary amounts on public-chain payroll as "Visible to anyone".
- Pitch use: A vendor with real volume names salary exposure as the adoption blocker. Toku on Aleo is also a direct competitor.

**6. ENS DAO pays its service providers through public per-second streams**
- Date: Season 2 streams began May 26, 2025. The tracker was last updated July 9, 2025.
- Source: https://github.com/5ajaki/SPP2-Streams/blob/main/README.md
- Quote: "This document outlines the technical requirements for the executable proposal to implement Service Provider Program Season 2, transitioning from the current 3.6M USDC annual budget to the approved 4.5M USDC annual budget."
- Numbers: One table lists each provider's annual pay side by side. Examples: Namehash Labs 1,100,000 USDC, ETH.LIMO 700,000 USDC, Blockful 700,000 USDC, ZK Email 400,000 USDC. The combined flow is 0.1426 USDCx per second.
- Pitch use: This is the group-payout slide. One payer, every recipient and rate readable in one view, updated every second. These amounts were approved by public vote, so this shows legibility, not a leak.

**7. Sushi's head chef salary becomes a public fight**
- Date: October 3, 2022
- Source: https://www.theblock.co/news/defi/2022-10-03-sushi-dao-votes-jared-grey-as-new-head-chef-174392
- Quote: "This package would have seen Howard earn $800,000 per year plus an additional $600,000 worth of vested SUSHI tokens."
- Numbers: $800,000 a year plus $600,000 in SUSHI. Members railed against the package, and Jonathan Howard withdrew in August 2022.
- Pitch use: When pay runs through a public treasury, a hire's salary becomes a public referendum before it becomes a payment.

**8. Optimism forum thread tracks where every grant's OP went**
- Date: November 16, 2022 to December 2023
- Source: https://gov.optimism.io/t/op-grants-through-season-2-where-has-the-op-gone/4025
- Quote: "My goal is to cover all of the grants, tracking how OP flowed to likely user or team wallets, and to what ends."
- Numbers: 7.7k views. It covers grants such as Celer's 1M OP. In Kromatika's section it notes "a deposit to a fresh Coinbase wallet" early in the program.
- Pitch use: Volunteers audit grantee wallets in public, so every sale or exchange deposit by a grant recipient is on the record.

### Harm from knowing who holds what

**9. Coinbase insiders leak customer balances to scammers**
- Date: disclosed May 15, 2025. The affected count was reported May 21, 2025.
- Sources: https://www.coinbase.com/blog/protecting-our-customers-standing-up-to-extortionists and https://www.theblock.co/news/markets/2025-05-21-coinbase-reveals-69461-users-affected-in-december-2024-data-heist-filing-355216
- Quote: "Coinbase, Inc. disclosed that personal data from 69,461 individuals was compromised in a December 2024 breach, according to a filing with the Maine Attorney General's Office."
- Numbers: 69,461 people. Coinbase estimated $180 million to $400 million in costs and refused a $20 million extortion demand. Coinbase says the stolen data included "balance snapshots and transaction history".
- Pitch use: Criminals bribed insiders to learn who holds what, and a public chain gives that list away free. This leak was off-chain, so frame it as proof that balance data is worth stealing.

**10. 2025 was the worst year on record for wrench attacks**
- Date: DL News, 2026. The exact publish date was not captured.
- Source: https://www.dlnews.com/articles/regulation/crypto-wrench-attacks-to-surge-following-a-violent-2025/
- Quote: "Another tracker created by Bitcoin developer Jameson Lopp counted more than 70 attacks during 2025."
- Numbers: More than 70 attacks per Lopp's list at https://github.com/jlopp/physical-bitcoin-attacks. TRM Labs counts about 55, while Forbes cites about 60 from TRM via Decrypt.
- Pitch use: Known holdings get people hurt. No source here says attackers picked victims by reading a chain, so claim the risk, not the cause.

**11. Ledger co-founder David Balland kidnapped and mutilated**
- Date: January 21, 2025. The Guardian reported it on May 4, 2025.
- Source: https://www.theguardian.com/world/2025/may/04/french-police-investigate-spate-of-cryptocurrency-millionaire-kidnappings
- Quote: "Police were contacted by Balland's business partner who received a video of the finger alongside a demand for a large ransom in cryptocurrency, of around €10m."
- Numbers: about €10m demanded in crypto. Nine suspects are under criminal investigation.
- Pitch use: This is the headline harm case: a crypto founder mutilated for a crypto ransom.

**12. Paris: a crypto entrepreneur's father abducted and his finger severed**
- Date: abducted May 1, 2025, and freed May 3, 2025.
- Source: same Guardian article as item 11.
- Quote: "French police are investigating a series of kidnappings of investors linked to cryptocurrency after a 60-year-old man had a finger chopped off by attackers who demanded his crypto-millionaire son pay a ransom."
- Numbers: a €5m to €7m ransom was demanded and not paid, per Le Parisien as cited by the Guardian.
- Pitch use: Families get targeted too. Wealth that is visible anywhere turns relatives into leverage.

**13. A French tax official sold crypto holders' addresses and assets to gangs**
- Date: charged in 2025. Forbes reported it on February 14, 2026.
- Source: https://www.forbes.com/sites/digital-assets/2026/02/14/france-crypto-kidnappings-leaks-and-zero-convictions-fuel-the-crisis/
- Quote: "In 2025, a French tax official named Ghalia C. was charged for using government tax software to look up the addresses and assets of cryptocurrency investors and selling the information to organized crime networks."
- Numbers: The same article reports a breach of Waltio, a French crypto tax platform, exposing about 50,000 users' year-end balances. Hackers claimed that data was linked to at least three kidnappings netting $17.1 million. That claim is unverified.
- Pitch use: Criminals pay for lists of who holds crypto and where they live. A public ledger hands over the holdings half of that list for free.

### Strongest five for a slide

1. **MrBeast, item 2.** One linked address exposed an alleged $23 million, three-year history. It is the best proof of the mechanism.
2. **Arkham on Trump, item 3.** A $2,806,341 disclosed balance was matched to a royalty wallet. It pairs a huge name with income made public.
3. **ENS streams, item 6.** Every provider's pay sits in one table, 4.5M USDC a year, flowing per second. It matches the group-payout claim exactly.
4. **Toku's CEO, item 5.** CFOs back away once they see payroll would be public, from a vendor with over $1 billion in volume.
5. **Balland plus the 2025 count, items 10 and 11.** A €10m ransom, a severed finger, and more than 70 attacks in 2025. Present it as risk, not cause.

Caution: items 1 to 3 show transparency catching bad actors, and judges may say that is good. Frame it as "the same tools that expose scammers also read your salary."

### Areas where I found nothing verifiable

- No article or thread says Sablier or Superfluid salary streams are publicly readable. Only the ENS tracker shows it in practice.
- No verified material on contributor pay at MakerDAO core units, Bankless DAO, Gitcoin, Lido, Aave, Optimism or Arbitrum.
- No verified source on Arbitrum STIP grantees being shamed for selling. Searches surfaced OpenBlock Labs, Chaos Labs and ARDC analyses that I did not read.
- No payroll quotes from Request Finance, Deel, Rise or Utopia Labs. Toku was the only vendor found.
- No Arkham bounty sizes or controversies after the July 2023 launch.
- No source ties a specific kidnapping to someone reading a blockchain. Every harm source points to leaked databases or known wealth.
- Several gaps stem from the shared Firecrawl credit pool running low. It had 22 of 1,000 credits left when this digest was written.

## B. Evidence B: Institutions see the privacy gap and are building private rails

Checked 25 September 2026. Every quote matches fetched page text. I used firecrawl first, then WebFetch after firecrawl credits ran out. Raw firecrawl files are in `scratchpad/.firecrawl/institutions/`.

### 1. Coinbase launches Base Ledgers for private business payments
- **Date:** Launched June 16, 2026 at Coinbase's "Take Control" showcase, which was June 17 in Japan. Still in early access.
- **Source:** https://www.base.org/ledgers and https://docs.base.org/ledger/overview. Coverage: https://genfinity.io/2026/06/17/coinbase-take-control-everything-exchange-tokenized-stocks-ai-agents-mortgages/ and, in Japanese, https://www.neweconomy.jp/posts/584457
- **Quote:** "Onchain payroll without publishing what every employee or contractor earns."
- **What it is:** An operator-run private ledger anchored to Base through a single `Portal` contract. Deposits hide the recipient and withdrawals hide the sender. The asset and amount stay public at both ends.
- **Access:** Coinbase Managed uses KYC through Coinbase Direct, sanctions screening, and Coinbase licensing. A self-managed Partner Ledger uses your own custody and KYC. Atarashii Keizai reports: 「同基盤は現在早期アクセスとして提供されており、利用には申請が必要となっている。」
- **Key number:** None published.
- **Pitch use:** Coinbase names payroll as a core use case, but access is by application and an operator runs the ledger.

### 2. Stripe and Paradigm's Tempo names payroll as the first privacy problem
- **Date:** April 16, 2026 ("Privacy on Tempo").
- **Source:** https://tempo.xyz/blog/privacy-on-tempo/
- **Quote:** "A company running payroll would publish every salary."
- **Detail:** Tempo Zones are private parallel chains linked to Tempo Mainnet. The post says "The zone operator has visibility into all transactions within the zone." Zones are "available with design partners today". The Tempo homepage lists "Opt-in privacy for balances and transfers", and its partner logos include Deel and Gusto.
- **Key number:** None.
- **Pitch use:** Stripe's own chain states our problem in one sentence, but its fix is visible to the operator and limited to design partners.

### 3. Visa calls missing privacy a "dealbreaker" for banks
- **Date:** March 25, 2026.
- **Source:** https://usa.visa.com/about-visa/newsroom/press-releases.releaseId.22231.html
- **Quote:** "Many banks see the lack of privacy as a dealbreaker for moving meaningful activity onchain," said Rubail Birwadker of Visa.
- **Also in the release:** "Banks can’t run payroll if salaries are public, and trading firms can’t transact if positions, collateral, or margin movements are visible."
- **Key number:** Visa is one of 40 Canton Super Validators. Its stablecoin settlement runs at $4.6 billion annualized.
- **Pitch use:** This is the best single headline. The largest card network says public transparency blocks bank adoption.

### 4. Canton Network and Digital Asset: privacy built for regulated finance
- **Date:** The protocol page is undated. The plan to bring JPMD to Canton was announced January 7, 2026.
- **Source:** https://www.canton.network/protocol and https://blog.digitalasset.com/news/digital-asset-and-kinexys-by-j.p.-morgan-bring-usd-jpm-coin-jpmd-natively-to-canton
- **Quote:** "The Canton protocol supports sub-transaction privacy, meaning that parties can only see the part of a transaction that specifically applies to them."
- **Named participants verified:** Visa is a Super Validator. Kinexys by J.P. Morgan will issue JPMD natively on Canton, phased through 2026. I could not verify other bank names.
- **Key number:** 40 Super Validators (from item 3).
- **Pitch use:** Privacy chains exist, but they serve banks and trading desks, not a five-person team paying contractors.

### 5. JPMorgan puts JPMD on Base, but only for its own clients
- **Date:** Pilot announced June 2025. Live for institutional clients per an April 28, 2026 update.
- **Source:** https://www.jpmorgan.com/payments/newsroom/kinexys-usd-digital-deposit-tokens, https://www.jpmorgan.com/payments/newsroom/kinexys-milestones-2026 and https://www.jpmorgan.com/insights/podcast-hub/making-sense/kinexys-blockchain-shift
- **Quote:** "JPMD is a first-of-its-kind permissioned deposit token, to exclusively enable J.P. Morgan’s institutional clients to securely send and receive money onchain, enhancing the digital payments ecosystem."
- **Confidentiality:** On a June 2, 2026 J.P. Morgan podcast, Kinexys head Oliver Harris said public blockchains "were radically transparent by design". He added: "And until recently, there were some trade-offs between compliance, privacy, and finality." In January 2026, Kinexys also agreed to issue JPMD on Canton.
- **Key number:** Kinexys has processed "more than $3 trillion in transactions since inception". It averages "more than $5 billion daily".
- **Pitch use:** The largest US bank calls public chains radically transparent, limits JPMD to vetted clients, and is adding a privacy chain.

### 6. Circle's Arc mainnet launches with privacy still "in development"
- **Date:** Mainnet launched September 16, 2026. The August 2025 announcement was not fetched.
- **Source:** https://www.circle.com/pressroom/circle-launches-arc-mainnet-an-economic-operating-system-for-the-internet and https://docs.arc.io/arc/concepts/opt-in-privacy
- **Quote:** "Arc's opt-in privacy design, currently in development for network-wide release, provides enterprises with the confidentiality their businesses require and the auditability compliance teams look for, together on one network."
- **Detail:** The docs say "Privacy features are on the roadmap and not yet available on Arc." The planned Arc Privacy Sector runs on validators inside hardware enclaves.
- **Key number:** More than 100 institutional and ecosystem builders were live at launch. Founding validators include BlackRock, DTCC, Visa, Mastercard, SBI Group and Sumitomo Corporation.
- **Pitch use:** Circle calls confidentiality a business requirement but has not shipped it yet. SBI and Sumitomo make this point land in Tokyo.

### 7. FIS survey: privacy ties for the top stablecoin barrier
- **Date:** November 11, 2025. The survey ran in October 2025.
- **Source:** https://www.fisglobal.com/about-us/media-room/press-release/2025/fis-research-banks-hold-the-key-to-stablecoin-adoption
- **Quote:** "Security and privacy concerns emerged as the top barriers to adoption (42.4% each), while nearly half (42%) of respondents expressed concern about value volatility."
- **Key number:** 42.4%, from 1,000 U.S. consumers employed full-time.
- **Pitch use:** The people who receive payouts rank privacy as a top barrier. The caveat is that these are consumers, not institutions.

### 8. a16z State of Crypto 2025: privacy "could be a prerequisite"
- **Date:** October 2025.
- **Source:** https://a16zcrypto.com/posts/article/state-of-crypto-report-2025/
- **Quote:** "Privacy is returning to the foreground and could be a prerequisite for wider adoption."
- **Key numbers:** Stablecoins did $46 trillion in transaction volume in the past year, up 106%. Adjusted volume was $9 trillion, up 87%. Railgun flows passed $200 million a month.
- **Pitch use:** This puts market size and privacy as the missing piece on one slide.

### 9. EDPB final guidelines: wallet addresses may be personal data
- **Date:** Version 2.0 was adopted July 7, 2026. The draft, version 1.1, was adopted April 8, 2025.
- **Source:** https://www.edpb.europa.eu/documents/guideline/guidelines-on-processing-of-personal-data-through-blockchain-technologies_en
- **Quote:** "On-chain metadata, including transaction identifiers, wallet addresses, event logs, receipts, state transitions and smart contract storage and related traces, may constitute personal data when they enable direct or indirect identification of a natural person"
- **Also:** Storing personal data on-chain as plain text "is strongly discouraged".
- **Salary:** The fetched text does not mention salary. Treating a linked payout amount as personal data is our reading of GDPR, not a quoted ruling.
- **Key number:** None.
- **Pitch use:** Under EU law, a public payroll transfer can become permanent personal data that cannot be erased.

### 10. Japan's APPI: identifiable wage data is personal information
- **Date:** Current official English translation.
- **Source:** https://www.japaneselawtranslation.go.jp/en/laws/view/4241/en
- **Quote (Article 2(1)):** "Personal information" in this Act means information relating to a living individual which falls under any of the following items:
- **Detail:** Item (i) covers information that "can be easily collated with other information and thereby used to identify that specific individual". Article 74(2)(iii) names employee files on "personnel, wages, welfare benefits". That clause sits in the public-sector chapter.
- **Salary:** Applying the Act to on-chain payouts is our reading, not regulator guidance.
- **Pitch use:** For the Tokyo audience: once a wallet can be matched to a worker, every public payout becomes personal information.

### 11. Vitalik Buterin's April 2025 privacy roadmap
- **Date:** April 10, 2025 for the roadmap. April 14, 2025 for "Why I support privacy".
- **Source:** https://ethereum-magicians.org/t/a-maximally-simple-l1-privacy-roadmap/23459 and https://vitalik.eth.limo/general/2025/04/14/privacy.html
- **Quote:** "Wallets should have a notion of a shielded balance, and when you send to someone else, there should be a “send from shielded balance” option, ideally turned on by default."
- **Also:** "Privacy is an important guarantor of decentralization: whoever has the information has the power, ergo we need to avoid centralized control over information."
- **Key number:** Privacy of onchain payments is the first of four areas in the roadmap.
- **Pitch use:** Our product does the first thing Ethereum's cofounder asked wallets to do.

### 12. Ethereum Foundation: privacy becomes the default
- **Date:** The Privacy Cluster launched in October 2025. The ethereum.org roadmap page is undated.
- **Source:** https://ethereum.org/roadmap/privacy/ and https://decrypt.co/343614/ethereum-foundation-launches-new-cluster-focused-on-privacy
- **Quote:** "Privacy on Ethereum is moving from an optional add-on to a network-level default."
- **Detail:** The roadmap page says "Anyone can see who sent how much to whom" and "The Kohaku wallet SDK is under development". EIP-8182 proposes a native shielded pool for ETH and ERC-20 transfers in the Hegotá upgrade. Decrypt quotes the Foundation: "Privacy is normal. Privacy is for everyone."
- **Key number:** The Privacy Cluster has 47 researchers, engineers, coordinators, and cryptographers.
- **Pitch use:** Ethereum is moving toward private payments, but protocol-level privacy has not shipped. We fill that gap now.

### Strongest five for a slide
1. **Visa:** "Many banks see the lack of privacy as a dealbreaker for moving meaningful activity onchain" (item 3).
2. **Tempo:** "A company running payroll would publish every salary." (item 2)
3. **Base Ledgers:** Coinbase lists private payroll as a use case, but only by application in early access (item 1).
4. **FIS:** Privacy ties for the top stablecoin barrier at 42.4% (item 7).
5. **EDPB, July 2026:** Wallet addresses may be personal data (item 9). Swap in a16z's $46 trillion figure if the slide needs market size.

### Where I found nothing
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

## C. Evidence C: Payout Scale and Address Linkability

Compiled 25 Sep 2026. Raw results are in `.firecrawl/scale/`. "Full scrape" means a full-page firecrawl scrape. "Search extract" means page text returned by firecrawl search. "WebFetch extract" means the WebFetch fallback, used after firecrawl credits ran out. WebFetch passes pages through a small model, so spot-check those quotes before a slide.

**1. Deel: $250 million in crypto payouts in 2025, and 10,000+ contractors on stablecoin pay**
- Number: $250M in crypto payouts in 2025, growing every year, across 40,000+ business customers. 10,000+ contractors in 100+ countries opted for stablecoins, and employees could opt in from May 2026.
- Date: 20 May 2026 press release. The contractor count is from BVNK's 2026 case study.
- Source: https://www.finextra.com/pressarticle/109900/deel-launches-stablecoin-salary-payouts-and-appoints-head-of-crypto and https://www.bvnk.com/blog/deel-teams-up-with-bvnk
- Quote: "Deel processed $250 million in crypto payouts in 2025, demand that has grown consistently year on year as workers increasingly choose stablecoin pay over local currency alternatives."
- Pitch use: The largest mainstream payroll platform already sends a quarter billion dollars a year to worker wallets.
- Check: full scrape. The BVNK line is a search extract: "Since launch, 10,000+ contractors in 100+ countries have opted to be paid in stablecoins."

**2. Rise: $1.5 billion+ in payroll, over half withdrawn in stablecoins**
- Number: $1.5B+ lifetime payroll volume, 190+ countries, and over 50% of worker withdrawals in stablecoins. Its Q1 2026 report showed stablecoin withdrawals exceeding stablecoin deposits by $154.5M.
- Date: current Rise page, Sep 2026. Q1 2026 figures reported 7 Apr 2026.
- Source: https://www.riseworks.io/blog/stablecoin-payroll-for-daos-and-web3 and https://stablecoininsider.org/rise-q1-2026-stablecoin-payroll-report/
- Quote: "With $1.5B+ in lifetime payroll volume, 190+ country coverage, and over 50% of worker withdrawals occurring in stablecoins"
- Pitch use: Given the choice, most workers take stablecoins, even when the employer funds payroll in fiat.
- Check: WebFetch extract, a sentence fragment.

**3. 9.6% of crypto-industry workers are paid in crypto**
- Number: 9.6% in 2024, up from 3% in 2023. USDC is 63% and USDT 28.6% of crypto salaries. Survey of 1,600+ workers in 77 countries.
- Date: 2024 survey, circulating by 6 Aug 2025.
- Source: https://panteracapital.com/blockchain-compensation-survey-2024/
- Quote: "This year we’ve seen a 3x jump to 9.6%"
- Pitch use: Crypto salary tripled in a year, and over 90% is USDC or USDT.
- Check: search extract. The 1,600 and 77 figures come from a LinkedIn post about the survey.

**4. Optimism Retro Funding: 30M OP to 501 recipients in one round**
- Number: Round 3 paid 30M OP to 501 recipients. Round 7 paid 15.8M OP to 306. Round 5 funded 79 projects.
- Date: forum analysis of Rounds 1 to 7.
- Source: https://gov.optimism.io/t/retropgf-rf-rounds-1-7-uncovering-the-trends-in-participation-categories-op-allocation/10208
- Quote: "Round 3 recorded the highest OP allocation with 30M OP, followed by Round 2 with 10M OP and Round 7 with 15.8M OP."
- Pitch use: Hundreds of named teams get six-figure grants to public addresses, so anyone can trace them.
- Check: search extract. The post's Round 3 mean reward conflicts with its totals, so quote totals and counts only.

**5. Arbitrum STIP: 71.4M ARB to 56 projects**
- Number: 71.4M ARB granted to 56 projects over two voting rounds, from an original budget of up to 50M ARB.
- Date: the program funded incentives through 31 Jan 2024.
- Source: https://www.arbitrumhub.io/incentive-programs/short-term-incentive-program/
- Quote: "over 71.4M ARB granted to 56 projects"
- Pitch use: DAO grants move tens of millions to named teams, and every recipient address is public.
- Check: WebFetch extract, a phrase.

**6. Gitcoin: $60 million+ to 3,700+ projects**
- Number: over $60M to more than 3,700 projects.
- Date: current page, Sep 2026.
- Source: https://gitcoin.co/mechanisms/quadratic-funding
- Quote: "Gitcoin Grants Program is the largest and longest-running deployment of quadratic funding, having distributed over $60 million to more than 3,700 projects across open-source software, DeFi infrastructure, climate solutions, and community initiatives."
- Pitch use: Grants are open-source payroll, and each payout links a funder to a builder's wallet in public.
- Check: search extract.

**7. ENS DAO streams $4.5 million a year, by the second, to 8 named providers**
- Number: $4.5M per year to 8 providers, up from $3.6M to 9. It streams through Superfluid at about 0.1426 USDCx per second. Named allocations range from $300K for Justaname to $1.1M for Namehash Labs.
- Date: executed 5 Jul 2025, proposal EP 6.13.
- Source: https://agora.ensdao.org/proposals/20404686300257550242704646761273386459664655640264490428281621095220078268383
- Quote: "This proposal transitions our existing streaming infrastructure from the $3.6M annual budget supporting 9 providers to the new $4.5M annual budget supporting 8 providers, including 6 continuing providers and 2 new additions."
- Pitch use: A live public salary table: anyone can read each provider's pay and watch it stream.
- Check: full scrape.

**8. Superfluid: $750 million+ streamed to 350,000+ wallets**
- Number: over $750M cumulative value streamed across 350,000+ wallets as of early 2025. Sablier has processed 552,000+ streams for 297,000+ users.
- Date: early 2025 figures on a 29 Jul 2026 research page.
- Source: https://www.spark.money/research/recurring-stablecoin-payment-infrastructure
- Quote: "As of early 2025, Superfluid reported over $750 million in cumulative value streamed across more than 350,000 wallets, deployed on 10+ EVM chains including Ethereum, Polygon, Arbitrum, and Base."
- Pitch use: Streamed pay already reaches hundreds of thousands of wallets, and every stream's rate is public.
- Check: WebFetch extract from a third-party page.

**9. $33 trillion in stablecoin transactions in 2025**
- Number: $33T in 2025, up 72%. USDC carried $18.3T and USDT $13.3T, per Artemis.
- Date: 8 Jan 2026.
- Source: https://www.bloomberg.com/news/articles/2026-01-08/stablecoin-transactions-rose-to-record-33-trillion-led-by-usdc
- Quote: "Total stablecoin transaction volumes soared 72% to $33 trillion in 2025, according to data compiled by Artemis Analytics Inc."
- Pitch use: The headline size of public dollar rails. Pair it with item 10 for skeptical judges.
- Check: full scrape.

**10. About $390 billion of that is real payments**
- Number: about $390B of true stablecoin payments in 2025, more than double 2024.
- Date: covers 2025.
- Source: https://www.mckinsey.com/industries/financial-services/our-insights/stablecoins-in-payments-what-the-raw-transaction-numbers-miss
- Quote: "The true volume of stablecoin payments identified in our analysis, about $390 billion in 2025, has more than doubled from 2024 levels."
- Pitch use: The honest payments figure: hundreds of billions, doubling yearly, on public chains.
- Check: search extract.

**11. USDC on Base: about $4.1 billion in supply**
- Number: about $4.1B USDC supply on Base, and $5.3T of volume in January 2026.
- Date: January 2026 data, Talos "State of the Network".
- Source: https://www.talos.com/insights/state-of-the-network-351
- Quote: "With ~$4.1B in supply, USDC on Base saw $5.3T in January 2026 transaction volume, generating unusually high velocity relative to other chains."
- Pitch use: Base suits USDC payroll. Cite the supply, not the volume the source calls unusual.
- Check: search extract.

**12. 17.9% of active Ethereum accounts clustered with simple heuristics**
- Number: 17.9% of active externally owned accounts clustered, and more than 340,000 entities control multiple addresses. Exchange deposit-address reuse is the strongest heuristic.
- Date: 2020, Financial Cryptography 2020. Data covers Ethereum's first 4 years.
- Source: https://link.springer.com/chapter/10.1007/978-3-030-51280-4_33
- Quote: "Our results show that we can cluster 17.9% of all active externally owned account addresses, indicating that there are more than 340,000 entities that are likely in control of multiple addresses."
- Pitch use: Almost 1 in 5 active accounts was linkable in 2020. The strongest heuristic fires when a worker forwards salary to an exchange deposit address.
- Check: full scrape. The abstract adds: "we conclude that the deposit address heuristic is currently the most effective approach."

**13. Behavior alone links 17.65% of Railgun withdrawals**
- Number: 17.65% of Railgun withdrawals uniquely linked to their deposits through timing, address reuse, graph proximity and amount patterns. Median anonymity loss is 3.42 bits.
- Date: 24 Jun 2026, arXiv preprint.
- Source: https://arxiv.org/abs/2606.25926
- Quote: "Our five heuristics are able to uniquely link 17.65% of Railgun withdraw transactions to deposit transactions."
- Pitch use: Encryption alone is not enough. Private payouts must also hide amounts and timing.
- Check: WebFetch extract of the abstract.

**14. Arkham: 5.4 billion address tags**
- Number: 5.4B address tags.
- Date: 26 Mar 2026, decoded from the LinkedIn post ID.
- Source: https://www.linkedin.com/posts/arkhamintelligence_blockchain-analysis-is-not-straight-forward-activity-7442942127388409856-UlwY
- Quote: "Here at Arkham, we've built an extensive tagging and labelling system with 5.4 billion address tags that explain what the people and companies ..." The search result cut the sentence off here.
- Pitch use: Linking addresses to people is a billion-label industry, not a research curiosity.
- Check: search extract, truncated.

**15. ENS: over 35 million registered names**
- Number: 35M+ registered ENS names. Basenames reached 200,000 registrations in about a week in Aug 2024. A 2020 study used ENS names as ground truth to deanonymize Ethereum users.
- Date: ENS homepage, Sep 2026.
- Source: https://ens.domains/
- Quote: "ENS is the open naming layer with over 35 million registered names, made for every chain, app, and wallet."
- Pitch use: A name turns a salary wallet into a searchable bank statement.
- Check: search extract. The homepage does not say whether subnames count. Other lines: https://beincrypto.com/base-million-daily-active-addresses/ and https://arxiv.org/abs/2005.14051

### Strongest five for a slide

1. $33 trillion of stablecoin transactions in 2025 (item 9), footnoted with McKinsey's $390 billion of real payments (item 10).
2. Payroll is moving on-chain: Deel paid $250 million in crypto in 2025, and over half of Rise worker withdrawals are stablecoins (items 1 and 2).
3. ENS DAO's public salary stream: $4.5 million a year, by the second, to 8 named providers (item 7).
4. 17.9% of active Ethereum accounts clustered with simple heuristics (item 12), and 17.65% of Railgun withdrawals linked inside a privacy pool (item 13).
5. 9.6% of crypto workers paid in crypto, tripled in a year, over 90% in USDC or USDT (item 3).

### Found nothing or not reached

- Deel's crypto share, growth rates and regional breakdowns. Rise's over-50% stablecoin withdrawal share is the closest substitute.
- Request Finance: only an undated X profile extract: "Over $1.2+ billion in crypto payments have been paid through the Request Finance platform." No USDC share was found.
- Toku, Bitwage, Franklin, Utopia Labs, Coinshift, Parcel: no payroll volume or customer counts found.
- Nouns DAO payouts, and Optimism recipient counts for Rounds 1, 2, 4 and 6: not reached.
- Chainalysis or Elliptic clustering coverage: nothing first-party. A third-party blog's "over 5 billion address clusters" claim has no citation, so it is not used.
- Studies on payroll recipients forwarding to exchange deposit addresses: nothing beyond Victor 2020.
- A current Basenames total, and any Coinbase or Circle statement on payroll use of USDC.
- Disperse, Safe multisend and Coinshift totals: none published.
- Tooling: firecrawl ran out of shared credits, so items 2, 5, 8 and 13 used WebSearch and WebFetch.

## D. Evidence D: private payment alternatives and build checks

Compiled 2026-09-25. Raw pages are in `scratchpad/.firecrawl/alternatives/`. Toku pages were read with WebFetch after firecrawl credits ran out (excerpts in `toku-webfetch-excerpts.md`). Quotes are verbatim, minus link markup. "Not found" means no fetched page said it.

### 1. Base Ledgers (Coinbase)

Launched June 16, 2026, "with Coinbase Developer Platform running the first Base Ledger." The product page says: "Base Ledgers combine instant onchain settlement with the confidentiality and built-in compliance your business requires."

**Architecture.** An operator runs an offchain ledger that settles on Base through one Portal contract. "The operator runs the services that process each step and decides how to authorize withdrawals." In Coinbase Managed mode, "Coinbase runs the Ledger and the compliance, so you get confidentiality without standing up any infrastructure." In self-managed mode: "Self-custody. Hold funds in a dedicated contract for your business." Base's docs never use the word sovereign.

**What is hidden, and from whom.** "Confidential by default. Senders and recipients stay hidden on the public chain; balances and transfers stay in your ledger." On Base, a deposit shows "The asset, amount, and sender", and a withdrawal shows the recipient and "the asset and amount". The operator, Coinbase in Managed mode, sees every balance and amount. Private receipt only works when the payee holds an account in the same ledger.

**Eligibility and custody.** "Base Ledgers is in early access." Managed mode sits in the custodial stack of a Coinbase Developer Platform business account: "The custodial stack also supports private onchain transactions via smart-contract based deposits and withdrawals from Base, using Base Ledgers." On compliance: "Compliance handled. KYC by Coinbase Direct, sanctions screening built in, and Coinbase handles licensing." Deposits "can also require an attestation or permission".

**Withdrawal to public Base.** The Portal validates withdrawals "from a signature check to full state-transition proofs". At the weakest setting, an operator signature releases funds.

**Not found:** pricing, regions, KYB criteria, or any individual or self-serve tier.

Sources: https://www.base.org/ledgers, https://docs.base.org/get-started/private-transactions (redirect target of docs.base.org/ledgers/overview), https://docs.base.org/build-on-base/ledgers/deposit, https://docs.base.org/build-on-base/ledgers/transfer, https://docs.base.org/build-on-base/ledgers/withdraw, https://docs.cdp.coinbase.com/payments/overview, https://x.com/CoinbaseDev/status/2066992742094483718

### 1a. Toku private payroll on Aleo (added)

"In January 2026, Toku launched a fully private stablecoin payroll system built on the Aleo blockchain and settled in USAD, a US dollar stablecoin issued by Paxos Labs."

- **Who can use it.** Enterprise clients. "Private stablecoin payroll will roll out to select Toku enterprise clients in Q1 2026, with full availability expected by mid-2026." Companies join a waitlist or "Book a demo". No self-serve signup was found.
- **Custody.** Not stated. Aleo's case study says: "Payroll funds flow into Toku's platform, compliance is handled in the existing HR stack, and settlement happens privately on Aleo."
- **Recipients.** No page says they need a Toku account. Pay settles "to each recipient in USAD on Aleo", so each needs an Aleo wallet.
- **What is hidden.** "Confidentiality applies to the public ledger, not to the employer's records."
- **Small teams.** Not without a sales process. Aleo's payroll page points them to wallet providers such as Dynamic and Utila: "Smaller teams paying a handful of contractors may want to start there."

Sources: https://www.toku.com/resources/how-toku-runs-fully-private-stablecoin-payroll-on-aleo-and-usad, https://www.toku.com/resources/aleo-toku-and-paxos-labs-launch-first-private-stablecoin-payroll-solution-removing-the-final-barrier-to-enterprise-stablecoin-adoption, https://aleo.org/post/toku-case-study/, https://aleo.org/payroll/

### 2. Fluidkey

A static ENS name (username.fkey.id) returns a fresh stealth Safe on each lookup, through an offchain resolver that Fluidkey runs.

**Trust model.** Users share "a BIP-32 derived node of their private viewing key with Fluidkey". So "only you and Fluidkey can see all transactions and assets." It cannot spend: "Fluidkey never asks for this key and can't access Alice's money."

**Own resolver.** Not offered. "Fluidkey's roadmap includes transitioning to a fully decentralized ENS Offchain Resolver."

**Batch payouts.** Not found in the full docs.

**Gas.** "There are no gas fees for 20 transactions per user per day, available on all chains except Ethereum mainnet."

**Consolidation.** Fluidkey picks source accounts automatically, which links them. Its FAQ example: "This means that the senders of the $100 & $1,000 and the recipients of the $800 & $250 would be able to tie these four transactions to you." It admits: "However, stealth addresses do not break traceability." Its "Hide Trail" exit routes through Houdini Swap exchanges, not a screened pool.

Sources: https://docs.fluidkey.com/technical-documentation/technical-walkthrough, https://docs.fluidkey.com/technical-documentation/ens-offchain-resolver, https://docs.fluidkey.com/readme/frequently-asked-questions, https://docs.fluidkey.com/readme/sending-funds, https://docs.fluidkey.com/readme/advanced-privacy, https://docs.fluidkey.com/llms-full.txt

### 3. Umbra (ScopeLift)

Umbra v1 is live, with a repo commit on Sep 23, 2026. Its FAQ lists its own StealthKeyRegistry, separate from ERC-6538. The FAQ lists mainnet, Sepolia, Optimism, Polygon and Arbitrum, and ScopeLift later "added support for Base".

**Umbra v2** appears only as a May 2024 proposal: "Prototyping Umbra v2 remains the last large task on our plate." No v2 launch appeared in any fetched page.

**Batch send.** The repo ships a periphery contract, UmbraBatchSend.sol. The app interface was not checked.

**Relayer trust model.** "By default, the Umbra app uses a relayer from the Umbra team." With a relayer, "fees can be paid with the received tokens". Users may pick "the relayer of your choice". The relayer is a liveness and censorship dependency.

**Prior art for Soapay's warning.** "To help mitigate this, the Umbra app will try to warn you if you enter a withdrawal address that might reduce your privacy."

Sources: https://app.umbra.cash/faq, https://scopelift.co/blog/introducing-umbra-v2-architecture, https://github.com/ScopeLift/umbra-protocol, https://github.com/ScopeLift/umbra-protocol/tree/master/contracts-periphery/src

### 4. Railgun

**Payroll flow.** The employer shields tokens, then sends privately to each worker's 0zk address. Workers need a Railgun wallet. "There are mandatory onchain protocol fees of 0.25% for shields and 0.25% for unshields." Entry and exit are public: "Shields and unshields show address, token and amount."

**Proof of Innocence.** After a shield, "this Unshield-Only Standby Period will be 1 hour". Broadcasters, who pay gas, require "a completed Private Proofs of Innocence check". The proof is optional: "Railgun protocol does not enforce any compliance measures."

**Chains.** Ethereum, Polygon, BSC, Arbitrum and the Sepolia testnet. Base is not listed.

**Compliance issues.** The FBI said North Korean actors "used RAILGUN, a privacy protocol, to launder over $60 million worth of ethereum (ETH)" in January 2023. L2BEAT: "The DAO can upgrade the contracts after a seven-day delay." No exchange delisting was found.

Sources: https://docs.railgun.org/wiki/assurance/private-proofs-of-innocence, https://docs.railgun.org/wiki/learn/helpful-links.md, https://l2beat.com/privacy/projects/railgun, https://www.fbi.gov/news/press-releases/fbi-confirms-lazarus-group-cyber-actors-responsible-for-harmonys-horizon-bridge-currency-theft

### 5. Privacy Pools (0xbow)

**Chains and assets.** The docs' deployments page lists only Ethereum Mainnet, with an ETH pool. An older 0xbow guide says: "Privacy Pools typically operates on Gnosis, and Ethereum Mainnet." L2BEAT tracks 14 assets on Ethereum, including ETH, USDC, USDT and DAI. **Base: not listed anywhere fetched.**

**Gating.** "The Association Set Provider is a crucial compliance layer that controls which deposits can be privately withdrawn from Privacy Pools." L2BEAT: "This set is managed in real time by the provider, which is currently a single entity." A 2/4 multisig controls the system, but users can always "publicly withdraw deposited tokens".

**Fees.** "0.5% vetting fee, 10% maximum relayer fee: BOLD, ETH, USDC."

**Deposit limits and mainnet gas cost:** unverified.

Sources: https://docs.privacypools.com/deployments, https://docs.privacypools.com/layers/asp, https://l2beat.com/privacy/projects/privacy-pools, https://0xbow.io/blog/getting-started-with-privacy-pools

### 6. Aztec

The Ignition Chain went live in November 2025 as a consensus layer, ahead of any execution environment. Execution now runs on V5, launched as "Alpha software, with V6 planned for later in 2026." On 27 July 2026, contributors found "a critical vulnerability affecting the V5 Alpha proving system". Aztec's guidance: "We expect teams planning a V5 deployment to pause that work until contributors publish further guidance."

**Small-team payroll today:** no. It is alpha software under an open incident, on a separate L2 from Base. Wallets were not verified.

Source: https://aztec.network/blog/aztec-ignition-chain-update, which carries the excerpt of https://aztec.network/blog/alpha-v5-proving-system-vulnerability

### 7. Tornado Cash

In August 2022, OFAC "sanctioned virtual currency mixer Tornado Cash, which has been used to launder more than $7 billion worth of virtual currency since its creation in 2019." Treasury cited mixing "with no attempt to determine their origin." On March 21, 2025, Treasury said it had "exercised our discretion to remove the economic sanctions against Tornado Cash". It still warned that "U.S. persons should exercise caution before engaging in transactions that present such risks." Unscreened pools carry sanction risk, even after a delisting.

Sources: https://home.treasury.gov/news/press-releases/jy0916, https://home.treasury.gov/news/press-releases/sb0057

### 8. Kohaku SDK (Ethereum Foundation)

Kohaku is an active wallet privacy monorepo, last committed Sep 25, 2026. The README warns: "Some parts of this project are work in progress and NOT READY FOR PRODUCTION USE. Packages contain UNAUDITED CODE." Five packages are marked done: privacy-pools, tornado-cash, plugins, provider and pq-account. The railgun package is still in progress. There is no stealth-address package.

Source: https://github.com/ethereum/kohaku

### 9. ScopeLift ERC-5564 and ERC-6538 contracts

**Verdict: yes.** Sepolia: yes. Base: yes. Base Sepolia: yes.

Every chain uses the same addresses. ERC5564Announcer is 0x55649E01B5Df198D18D95b5cc5051630cfD45564. ERC6538Registry is 0x6538E6bf4B0eBd30A8Ea093027Ac2422ce5d6538.

- **Mainnets:** Ethereum, Arbitrum, Base, Gnosis Chain, Optimism, Polygon, Scroll.
- **Testnets:** Sepolia, Holešky, Arbitrum Sepolia, Base Sepolia, Optimism Sepolia.

ScopeLift lists "ERC contracts audited by Trail of Bits" as complete.

Sources: https://github.com/ScopeLift/stealth-address-erc-contracts, https://scopelift.co/blog/introducing-umbra-v2-architecture

### 10. ENSv2

**Verdict: yes.** The deployments page has a "Sepolia (ENSv2 Beta)" section: "Sepolia runs the ENSv2 contracts: the Universal Resolver and the ENS apps for Sepolia resolve through this deployment."

- **Hierarchical registries.** "Name owners can deploy their own subname registry on demand."
- **Enhanced Access Control.** It replaces Name Wrapper fuses with "a new role-based permission system".
- **Permissioned Registry and Permissioned Resolver.** Each account gets its own resolver with per-record roles.
- **Wildcard-style resolution.** The overview never says "wildcard". Universal Resolver V2 picks the deepest resolver: "The resolver that covers the longest matching suffix of the name wins." A resolver found at a parent must support IExtendedResolver, the ENSIP-10 interface.

Sources: https://docs.ens.domains/ensv2/overview, https://docs.ens.domains/learn/deployments, https://docs.ens.domains/ensv2/registry-hierarchy, https://docs.ens.domains/ensv2/universal-resolver-v2

### 11. Account abstraction

**Verdict: yes** to both questions.

**EntryPoint v0.8.** The release notes list "Native support for EIP-7702 authorizations in the EntryPoint contract". The release also ships a Simple7702Account.

**USDC paymasters:**
- **Circle Paymaster v0.8** is on Base Sepolia and Ethereum Sepolia at 0x3BA9A96eE3eFf3A69E2B18886AcF52027EFF8966. Its quickstart covers "Setting up a 7702 smart account and checking its USDC balance". No signup: "You don’t need to sign up for a Circle Developer account". On cost: "The 10% surcharge only applies to Arbitrum and Base (and their testnets)."
- **Pimlico ERC-20 Paymaster** lists USDC on Sepolia and Base Sepolia for all users.
- **Alchemy** was not checked.

Sources: https://github.com/eth-infinitism/account-abstraction/releases/tag/v0.8.0, https://developers.circle.com/paymaster, https://developers.circle.com/paymaster/addresses-and-events, https://developers.circle.com/paymaster/pay-gas-fees-usdc, https://docs.pimlico.io/references/paymaster/erc20-paymaster/supported-tokens

### Gaps the pitch should state honestly

- **The screened exit is not on Base.** Privacy Pools runs on Ethereum mainnet. An exit from Base needs a bridge hop and mainnet gas.
- **Fluidkey already ships** a static ENS name, fresh stealth addresses and sponsored gas. Soapay's edge is batch payouts, the exit, and no server-held viewing key.
- **Umbra already warns** about risky withdrawal addresses.
- **Toku proves the enterprise demand** but sells through demos to enterprise clients, on Aleo rather than Base.
- **Resolver visibility.** An offchain ENS gateway would learn each payee's fresh addresses. This is inferred from the design, not documented.

### Comparison table

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

## E. Evidence E: companies and vendors blocked by public payroll

Researched September 25, 2026. "Verified" means I string-matched the quote in the raw page text I downloaded. "Spot-check" means it came only through a summarizing fetch or a search snippet.

Read this first. Almost every strong quote comes from a company that sells a privacy fix. No named employer is on record complaining. Toku's CEO speaks for CFOs he does not name. The EY survey in item 12 cuts against "privacy is the top blocker", so keep it off the slide.

### Items

**1. Toku (stablecoin payroll vendor, CEO Ken O'Friel)**
- What: He says enterprise deals die once CFOs see that payroll would be public. Toku partnered with Aleo and Paxos Labs to run payroll on a private chain.
- Date: July 21, 2026 (Aleo USAD case study) and July 29, 2026 (Aleo Toku case study).
- Sources: https://aleo.org/post/usad-case-study/ and https://aleo.org/post/toku-case-study/
- Quote (verified): "Every public company CFO we talk to gets excited about stablecoins until they realize their payroll would be public. That's where the conversation ends."
- Second quote (verified): "Compliance was never the blocker, we solved that in 100-plus countries. The blocker was every salary sitting on a public ledger. Aleo now handles that."
- Numbers (verified, USAD page): stablecoins processed over $33 trillion in 2025. Less than 1% of businesses use crypto for payroll. Toku has processed more than $1 billion in token payroll volume.
- Slide use: Make this the lead quote. The new ending, "That's where the conversation ends", shows the deal dying. The second quote rules out compliance as the cause.
- Toku's own pages (verified): "Enterprises generally can't run payroll on glass rails." (April 30, 2026, https://www.toku.com/resources/why-enterprise-companies-have-been-slow-to-adopt-stablecoin-payroll). "Anyone who maps one employee wallet to one person can see that person's pay, every cycle, forever." (July 24, 2026, https://www.toku.com/resources/how-toku-runs-fully-private-stablecoin-payroll-on-aleo-and-usad)
- Where the data lives, same Toku page (verified): "Payroll funds flow into Toku's platform, compliance is handled in the existing HR stack, and settlement happens privately on Aleo." "The employer keeps the authoritative record." "The confidentiality applies to the public ledger." "Auditor and tax-authority access: through employer records." Private from the public and from coworkers; visible to Toku and the employer. Nothing says Toku sees a wallet after payout.

**2. Visa (Rubail Birwadker, Global Head of Growth Products and Strategic Partnerships)**
- What: Visa joined the Canton Network as a super validator. It said banks will not move activity onto transparent chains.
- Date: March 25, 2026.
- Source: https://usa.visa.com/about-visa/newsroom/press-releases.releaseId.22231.html
- Quote (verified): "Many banks see the lack of privacy as a dealbreaker for moving meaningful activity onchain,"
- Same release, FAQ section (verified): "Banks can't run payroll if salaries are public, and trading firms can't transact if positions, collateral, or margin movements are visible."
- Slide use: This is the strongest voice that does not sell a privacy fix. A card network speaks for its bank clients, uses the word dealbreaker and names payroll.

**3. Deel (global payroll and EOR platform)**
- What: Deel built its contractor stablecoin wallet on Tempo. It plans to use Tempo Privacy Zones so balances and payout history stay private. Tempo wrote the text, describing Deel.
- Date: June 2, 2026.
- Source: https://tempo.xyz/blog/deel-stablecoin-wallet-global-contractors-tempo/
- Quote (verified): "Deel plans to use Tempo's Privacy Zones to keep contractor wallet balances and payout history confidential from public view, while preserving auditable access for Deel."
- Numbers: 84.6% of Argentine contractors on Deel chose USD over pesos (verified). Deel's May 2026 salary payouts let employees take 10% to 25% of net pay in stablecoins (spot-check). No source links that cap to privacy.
- Slide use: This is a buyer's decision. The biggest payroll platform in the space would not put contractor balances on a public ledger.

**4. Coinbase (Base Ledgers)**
- What: Coinbase launched Base Ledgers in early access. It is a private ledger for enterprise payments that settles on Base. I found no named customers.
- Date: Early access was reported June 17, 2026 (spot-check, https://cryptoadventure.com/base-launches-private-settlement-rails-for-institutional-transactions/). Coinbase announced its privacy push on October 22, 2025.
- Sources: https://base-a060aa97.mintlify.app/ledgers/overview and https://www.base.org/ledgers
- Quote (verified, docs): "Pay vendors without broadcasting your supplier list to the public chain."
- Also verified (product page): "Onchain payroll without publishing what every employee or contractor earns."
- Docs, fetched live Sep 26 (docs.base.org/get-started/private-transactions and the ledger guides): "An operator gates the ledger with its own KYC and compliance controls." "The operator runs the services that process each step and decides how to authorize withdrawals." "The ledger stays agnostic to the offchain system behind it, so you run your own bookkeeping and custom transaction logic." Product page: "Coinbase runs the Ledger and the compliance" and "balances and transfers stay in your ledger." Transfers inside a ledger are entries in the operator's off-chain books; the chain sees deposits and withdrawals only.
- October 2025 (verified): CoinDesk quotes Coinbase's announcement, not Armstrong himself: "Privacy is critical for unlocking the full potential of an onchain future," (https://www.coindesk.com/business/2025/10/22/coinbase-is-building-private-transactions-for-base-ceo-brian-armstrong-says)
- Slide use: Coinbase had to build a private ledger beside its own public chain. Its product page names suppliers and payroll directly.

**5. Tempo (Stripe and Paradigm)**
- What: Tempo shipped Zones, which are private parallel chains. It built them with a small group of design partners it did not name, covering payroll, treasury and settlement.
- Date: April 16, 2026.
- Source: https://tempo.xyz/blog/privacy-on-tempo/
- Quote (verified): "A company running payroll would publish every salary."
- Also verified: "Several enterprises and financial institutions are exploring using Zones"
- Also verified, same page: body "The zone operator has visibility into all transactions within the zone. This is by design." FAQ "The zone operator can see all transactions. Users can only see their own balances and activity. The public does not see what happens inside the zone." And "Zone operators never have custody." Say sees, never holds.
- Slide use: Pair this with Deel. Stripe's chain built a private layer because of payroll. Deel is the only named Zones user I found.

**6. Circle (Arc)**
- What: Circle designed opt-in privacy for Arc. It then launched Arc Privacy for confidential transfers and contracts. I found no named enterprise saying it is waiting for privacy.
- Date: June 10, 2026 (Arc blog). The Arc Privacy launch was reported June 17, 2026 (spot-check, crypto.news).
- Source: https://www.arc.io/blog/privacy-with-control-how-arc-can-unlock-onchain-finance
- Quote (verified): "A company's payroll should not be market data."
- Slide use: A clean one-liner from the USDC issuer. It works as a pull quote.

**7. Request Finance (crypto invoicing and payroll, Max Franke, Head of Product)**
- What: Request Finance integrated Aleo's private payments. Customers can now run payroll and pay vendor bills privately.
- Date: September 4, 2025.
- Source: https://aleo.org/post/aleo-request-finance-private-payments-partnership/
- Quote (verified): "Aleo tackles one of the biggest challenges for businesses adopting stablecoins in their finance stack: maintaining privacy on-chain"
- Also verified: on-chain payments reveal "how much and how often each employee is paid, potentially creating dissatisfaction among coworkers"
- Number (verified): Request Finance has processed over $1 billion in payments.
- Slide use: A finance-team tool had to build a workaround. The coworker line shows the human cost.

**8. Rise (riseworks.io, crypto payroll)**
- What: Rise answers a question customers keep asking. It describes the workaround it built: a burn-and-mint bridge, so payouts are not linked wallet to wallet.
- Date: The page timestamp is January 11, 2026 (spot-check).
- Source: https://www.riseworks.io/blog/are-crypto-payroll-payments-on-rise-public
- Quote (verified, the customer question as Rise frames it): "If we pay our team in crypto, can anyone on the internet see how much they're getting paid?"
- Also verified: "Rise uses a burn-and-mint bridge model to process crypto payroll payouts."
- Slide use: This proves vendors hide payouts with obfuscation instead of real privacy.

**9. Fireblocks (blog by Ran Goldi)**
- What: Fireblocks provides custody for banks and payment providers. It calls privacy a barrier to institutional stablecoin use.
- Date: April 20, 2026.
- Source: https://www.fireblocks.com/blog/blockchain-privacy-problem
- Quote (verified): "A B2B payment company can't operate on a public chain where competitors see their transaction volumes and spreads."
- Also verified: "Payroll is a really good example here, considering most employees don't want their wages exposed."
- Slide use: This covers the vendor-payment half of the problem.

**10. Paxos Labs (Bhau Kotecha, co-founder)**
- What: Paxos Labs issued USAD, a private stablecoin on Aleo, for Toku's payroll use case.
- Date: July 21, 2026.
- Source: https://aleo.org/post/usad-case-study/
- Quote (verified): "Privacy is becoming table stakes for enterprise adoption"
- Slide use: A regulated issuer built a new stablecoin to make payroll private.

**11. J.P. Morgan (Kinexys, Project EPIC)**
- What: J.P. Morgan published research concluding that tokenized finance depends on privacy for institutions. It later moved JPM Coin to the privacy-focused Canton Network (January 7, 2026, per a CoinDesk headline, spot-check).
- Date: November 6, 2024 (page date).
- Source: https://www.jpmorgan.com/kinexys/content-hub/project-epic-enterprise-privacy-identity-composability
- Quote (verified): "realizing this transformative potential hinges critically on addressing institutional-grade privacy and developing composable, privacy-preserving identity solutions."
- Slide use: This shows bank-level backing. It is old and generic, so use the logo, not the quote.

**12. EY-Parthenon (survey, caution)**
- What: The 2025 EY-Parthenon Stablecoin Survey of Corporates and Financial Institutions ran in June 2025 with 350 respondents. Each picked their top three barriers.
- Source: https://www.ey.com/content/dam/ey-unified-site/ey-com/en-us/insights/financial-services/documents/cs-eyp-stablecoin-survey.pdf (page 11)
- Label (verified): "On-chain transaction visibility and privacy"
- Number: 9% picked it, 10th of 13 barriers. Regulatory uncertainty led at 73%. I matched 9% to the label by chart layout, not by a sentence, so spot-check page 11.
- Slide use: Do not cite it. Be ready if a judge raises it. Only 45 respondents used stablecoins at all, so few had hit the exposure problem. The survey also ran before the GENIUS Act passed.

### Strongest ten for a company-struggles slide, ranked

1. **Toku:** its CEO says deals end once CFOs learn payroll would be public: "That's where the conversation ends."
2. **Visa:** banks call the lack of privacy a "dealbreaker". Its release adds that banks "can't run payroll if salaries are public".
3. **Deel:** it chose Tempo Privacy Zones to hide contractor balances and payout history.
4. **Coinbase:** it built Base Ledgers so firms can pay vendors "without broadcasting your supplier list".
5. **Tempo:** "A company running payroll would publish every salary."
6. **Request Finance:** its head of product calls on-chain privacy "one of the biggest challenges".
7. **Rise:** a customer question plus a burn-and-mint workaround.
8. **Circle:** "A company's payroll should not be market data."
9. **Paxos Labs:** privacy is "table stakes for enterprise adoption".
10. **Fireblocks:** a B2B payment company "can't operate on a public chain".

J.P. Morgan comes eleventh. Keep EY off the slide.

### Searched, nothing usable

- **Rippling and Payoneer:** no statement on the privacy of on-chain payouts.
- **Gusto:** it appears only as a Toku integration.
- **Remote:** it offers USDC payouts through Stripe (spot-check). It says nothing about privacy.
- **Papaya Global:** it launched a stablecoin wallet with Fireblocks in February 2026 (spot-check). It says nothing about privacy.
- **Deel's head of crypto, Thierry Edde:** his quotes are about currency loss, not privacy. I found no stated reason for the 10% to 25% cap.
- **Crypto payroll and treasury tools:** Bitwage, Franklin, Utopia Labs, Coinshift, Parcel, Safe, Sablier and Superfluid. I found no privacy complaint or privacy feature.
- **Toku customers:** the Figure and Credit Coop case studies do not mention privacy.
- **Base Ledgers:** no named customers or design partners. I found no verbatim privacy quote from Jesse Pollak, and Brian Armstrong's words appear only as paraphrase.
- **Tempo Zones:** Deel is the only named partner.
- **Circle:** no named enterprise waiting for privacy.
- **Canton adopters:** Goldman Sachs, BNY, DTCC and Digital Asset have adoption headlines only, with no verbatim privacy quote.
- **Consultancy surveys:** a combined search covering Deloitte, PwC and Fireblocks found no privacy percentage.
- **HR bodies:** SHRM, ADP and Gartner have nothing on crypto payroll privacy.
- **Not searched within the time budget:** KPMG, McKinsey, BCG, Chainalysis and Forrester.

## F. Evidence F: Organizations hurt by public on-chain pay (DAOs and companies)

Quotes were checked against raw page text unless marked "spot-check." The raw page text is cached in `scratchpad/pages/`.

### Items

**1. Gitcoin DAO: a contributor found coworkers' salaries on Etherscan**
- What happened: During a pay-policy debate, a contributor (forum user loietaylor) started from their own pay address and traced colleagues' salaries on Etherscan. This included a workstream that said it did not share salaries. Founder Kevin Owocki (forum user owocki) objected. Eight months later the DAO published an aggregate audit instead of individual salaries, and it cited privacy as the reason.
- Dates: June 11, 2022 (the Etherscan post). February 2, 2023 (the audit).
- Sources: https://gov.gitcoin.co/t/a-compensation-commitment/10830/24 and https://gov.gitcoin.co/t/contributor-compensation-audit/12750
- Quote: "Starting only with the knowledge of my own address that I receive my pay at, I was able to find out the salary amounts of several contributors in multiple workstreams."
- Backup quotes: Founder: "Stating that there is already an implicit policy of salary transparency just because people are careless about not doxing their addresses (or not using ZK tools to achieve privacy) is not a good argument for salary transparency IMO." Audit: "As the next best thing to fully transparent compensation - which has been met with resistance due to contributor privacy concerns - we’ve completed an objective, facts-based audit of DAO-wide compensation."
- Numbers: The exact salaries of 15 contributors in one workstream were matched to names. "Approximately 95% of the DAO’s spending comes from contributor compensation."
- Slide use: Lead with this item. A named DAO, a first-person account, and a policy change caused by privacy make it the cleanest proof.

**2. MakerDAO, Lido and SushiSwap: outsiders published their average salaries**
- What happened: Token Terminal used MakerDAO's public expense dashboard and the budgets Lido and SushiSwap had posted to publish per-person salary averages. It also noted criticism of MakerDAO's "generous Core Unit budgets."
- Date: January 27, 2023.
- Source: https://tokenterminal.com/crypto-research/how-much-does-it-really-cost-to-run-a-dao
- Quote: "running a DAO can be quite expensive, with average annual salaries at MakerDAO, Lido, and SushiSwap landing at $205k, $132k, and $256k, respectively."
- Numbers: MakerDAO had $23.50m in annual salaries across 104.41 FTEs. The article's own table gives $225.1k per FTE, which conflicts with the $205k in its summary. Pick one figure and cite it.
- Caveat: The figures come from dashboards and budget posts, not from tracing transactions. The article also says: "the expense side of DAOs is often not public by default, as core contributors' salaries and other costs are managed via traditional offchain entities."
- Slide use: "Your average salary is a public statistic," shown with three named DAOs.

**3. SushiSwap: the earlier 0xMaki pay fight**
- What happened: About two weeks after launch, the community argued in public over core contributor 0xMaki's pay. The first proposal drew backlash, so a second proposal replaced it.
- Date: September 2020 (The Daily Gwei, September 14, 2020).
- Source: https://thedailygwei.substack.com/p/the-end-of-the-sushi-saga-the-daily
- Quote: "Obviously this proposal didn’t go over too well with the community since $1.1 million (worth more at the time) is a lot of money to be paying someone upfront for 2 weeks worth of work."
- Numbers: The first proposal offered 500k SUSHI ($1.1 million) up front, 500k more locked and 500k more vested. The community then voted on 1.5 million SUSHI ($3.3 million) over 3 years, plus $10,000 a month.
- Slide use: Pair it with the 2022 head chef fight you already have. SushiSwap fought publicly over pay twice in about two years.

**4. Optimism RetroPGF: grantees traced to exchanges and judged by name**
- What happened: Castle Capital tracked where Round 2 grant tokens went. It then published which named recipients sold, and whether they had earned the grant.
- Date: November 24, 2023 (Part 2).
- Source: https://chronicle.castlecapital.vc/p/puzzling-reality-optimism-grants-pt2-good-neutral-questionable
- Quote: "Zach received 188k OP tokens and sold for $227k". On Beaconcha.in: "We believe this sum is not justified by any meaningful contribution to Optimism".
- Numbers: 35% of recipients sold, 25% held and 40% could not be traced. Polynya sold 98k OP for $200k. Beaconcha.in sold 100k OP for $200k. One recipient's 65k OP were "quickly transferred to Coinbase".
- Part 1, spot-check: "ZachXBT (~$340k), Lighthouse (~$270k), and wagmi (~$170k) have sold their entire grants." https://www.gate.com/learn/articles/introduction-and-movements/924
- Slide use: "Take a grant, get audited by strangers," with real names and dollar amounts.

**5. Ethereum Foundation: every treasury sale is tracked and called dumping**
- What happened: SpotOnChain reported the EF's sales from on-chain data. Critics pushed back, Vitalik Buterin responded publicly, and SpotOnChain urged the EF to sell over the counter to reduce public scrutiny.
- Date: January 20, 2025.
- Source: https://cryptoslate.com/vitalik-buterin-addresses-controversy-as-ethereum-foundation-sells-another-100-eth/
- Quote: "Nobody wants to see the EF continuously dumping ETH on them." (SpotOnChain, as quoted by CryptoSlate)
- Numbers: The EF sold 100 ETH for $336,475, bringing its 2025 total at that point to 200 ETH ($672,000).
- Slide use: Even the best-known crypto nonprofit cannot pay its bills without a public reaction, and the proposed fix was OTC deals that draw less public scrutiny.

**6. Jump Trading: its remaining inventory was published during a sell-off**
- What happened: Lookonchain tracked Jump's Lido withdrawals and exchange deposits, then posted how much ETH the firm still held.
- Date: August 14, 2024.
- Source: https://cointelegraph.com/news/jump-trading-transfers-46-44-m-in-eth-amid-sell-off-manipulation-fears
- Quote: "The analyst also stated that Jump Trading currently holds a remaining 21,394 ETH worth approximately $68.58 million as the new wave of ETH sales reportedly begins."
- Numbers: Jump moved 17,049 ETH ($46.44 million). The Block reported about $300 million flowing into Jump wallets that Arkham had tagged, as of August 4, 2024 (spot-check): https://www.theblock.co/news/business/2024-08-04-jump-crypto-moves-hundreds-of-millions-in-crypto-as-prices-slide-309266
- Slide use: Labeled wallets turn a firm's position into public information that anyone can trade against.

**7. Polkadot: every vendor and influencer payment became a headline**
- What happened: A public treasury report laid out Polkadot's spending on influencers, sponsorships and logos on private jets, and the community attacked it.
- Date: July 3, 2024.
- Source: https://www.dlnews.com/articles/defi/polkadot-defends-millions-spent-on-marketing-as-budget-booms/
- Quote: "Polkadot spent $180,000 to slap its logo on “an entire fleet of Europe-based private jets” for six months."
- Numbers: Polkadot spent almost $87 million in H1 2024, including $37 million (42%) on marketing. The treasury held about $245 million.
- Caveat: The figures come from a report by Polkadot's head ambassador, Tommi Enenkel. Treasury spending is decided by public token-holder votes.
- Slide use: Public payouts expose vendor lists and rates, not only salaries.

**8. Celsius, with Three Arrows Capital: distress visible on-chain before the freeze**
- What happened: Nansen traced Celsius and 3AC moving stETH from Aave to FTX days before Celsius paused withdrawals.
- Date: June 29, 2022.
- Source: https://decrypt.co/104102/nansen-analysis-examines-how-terra-collapse-affected-celsius-and-three-arrows-capital
- Quote: "Each firm withdrew 50,000 stETH from Aave from June 8 to June 9, with the funds transferred to FTX in short order, where they likely were sold through OTC deals."
- Numbers: Each firm withdrew 50,000 stETH. Celsius paused withdrawals on June 11.
- Slide use: Treasury moves show a firm's stress to the whole market. Use with care, because this case also shows transparency helping creditors.

**9. Binance: its internal collateral transfers were rebuilt from chain data**
- What happened: Forbes used blockchain data to show that Binance moved stablecoin collateral to trading firms, and it named Cumberland/DRW and Alameda.
- Date: February 27, 2023.
- Source: https://www.coindesk.com/business/2023/02/27/binance-moved-18b-in-stablecoin-collateral-to-hedge-funds-last-year-forbes
- Quote: "According to the report, Binance transferred the collateral to hedge funds including Alameda Research and Cumberland/DRW and did so without informing its customers."
- Numbers: $1.8 billion was moved. For a period, more than $1 billion of B-peg USDC had no collateral behind it.
- Binance's reply: "Processes for managing our collateral wallets have been fixed on a longer-term basis and this is verifiable on-chain."
- Slide use: Counterparties and treasury operations can be read from the chain. The same caveat as Celsius applies.

**10. Arbitrum DAO grantees: traced for bounties and facing bans**
- What happened: Arbitrum's Watchdog Committee pays whistleblowers who trace how grants were used. It recommended permanent bans for Good Entry, Limitless and APX Finance.
- Date: September 9, 2026.
- Source: https://cryptobriefing.com/arbitrum-watchdog-permanent-bans-grant-misuse/
- Quote: "Good Entry allegedly distributed 142,839 ARB to 1,032 users the committee considers ineligible, with suspected team-linked incentive farming on top of that."
- Numbers: About 457,000 ARB in alleged misuse, about 90 reports, about 532,000 ARB recovered and about 268,000 ARB paid to whistleblowers.
- Slide use: This cuts both ways. Strangers trace grantees for money, but DAOs also rely on audits. Pitch selective disclosure, not full darkness.

**11. Uniswap Foundation: executive pay became a public fight (the data did not come from the chain)**
- What happened: A critic, @ImperiumPaper, used UF's financial statements to compare its executive pay with the Optimism Grants Council.
- Date: December 25, 2025.
- Source: https://phemex.com/news/article/uniswap-foundation-faces-criticism-over-high-executive-salaries-48634
- Quote: "In contrast, Uniswap Foundation's financial statements reveal that it distributed $9.9929 million in grants, while spending $4.7943 million on employee salaries, of which $3.8711 million was for executive pay."
- Numbers: Executive salaries were 22% of UF's 2024 spending.
- Slide use: Supporting only. Do not claim this data came from the chain.

### Strongest ten for a company-struggles slide

1. Gitcoin DAO
2. Optimism RetroPGF grantees (Castle Capital)
3. MakerDAO, Lido and SushiSwap salaries (Token Terminal)
4. Ethereum Foundation
5. Jump Trading
6. SushiSwap and 0xMaki
7. Polkadot
8. Arbitrum DAO grantees (double-edged)
9. Celsius and 3AC (double-edged)
10. Binance (double-edged)

### Searched, weak or nothing usable

- **Arbitrum Foundation, April 2023:** It lent and sold ARB before the AIP-1 vote (spot-check: 40M lent to Wintermute, 10M sold, over 77% voted against). The foundation disclosed this itself, so it was not an on-chain discovery.
- **Optimism, October 2023:** A doxxing dispute over a badge-holder nomination (DL News) was about governance, not pay.
- **Gitcoin GR15 fraud report:** It covers sybil donors, not grantee payouts.
- **Wintermute:** Only a DL News piece on accusations of pumping and dumping was found, and it is not tied to on-chain tracking.
- **ENS DAO:** Threads on steward pay exist, but no fight or exposure was found.
- **Aave:** No source was found for a Chaos Labs versus Gauntlet pricing fight.
- **Arbitrum STIP (OpenBlock):** The reports measure how well incentives worked, not whether grantees sold.
- **Coinbase:** A CoinDesk article on private transactions for Base (October 22, 2025) does not mention payroll.
- **Payroll moved off-chain because of exposure:** No named organization was found. The closest cases are Gitcoin's audit and Token Terminal's note about off-chain entities.
- **DeepDAO or Messari totals for contributor pay:** None were found.
- **Not searched for lack of time:** Bankless DAO, Yearn, Nouns, Compound, GSR, Circle, and Tesla wallets labeled by Arkham.
