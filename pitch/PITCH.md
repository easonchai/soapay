# Soapay pitch, working document

ETHGlobal Tokyo 2026. Deck format: Team name and one-liner, Our Team, Problem, Solution, Architecture, Future Plan, Demo.

Deck structure as of Sep 26, 10:40 (twelve slides, source: soapay-deck.html, output: soapay-deck.pdf):
1. Title. 2. Team, five people. 3. "Who sees what you earn?" 4. Everyone with a browser (live batch). 5. Your colleagues (Gitcoin: text left, the Feb 2023 audit page right with the "contributor privacy concerns" sentence framed and the text above it faded; Marcus, Sep 26. Do not use SVG masks in the deck, macOS Preview misrenders them in the PDF). 6. So companies walk away (Visa only: the dealbreaker line and "banks can't run payroll if salaries are public", zoomed from the press release; the Toku CFO quote is spoken, not shown; strip of Stripe, Circle, J.P. Morgan, Fireblocks). 7. So they built private payrolls (Toku on Aleo, Tempo Zones with Deel, Base Ledgers), with the two flaws: not for everyone, not fully private; closing "Everyone else still pays in public." 8. Solution, with the callback "only you". 9. Architecture. 10. Use cases: "Built for payroll. Ready for any payout." six non-payroll tiles with Iconsax icons (Marcus, Sep 26: salaries, DAO contributor pay and invoices removed as payroll by another name). 11. Future plan: three additions, shielded amounts, any wallet (SDK), agents paying agents. 12. Demo, one word.
Decision (Marcus, Sep 26): the Deel slide and the Base Ledgers slide merged into one. The three private payrolls prove demand, and every one shares the same two flaws, so they belong on one slide.

Problem statement slide, rendered (Sep 26, 00:00, universal and third-person per Marcus, one line, nothing else): "WHO SEES WHAT YOU EARN?" Alternatives offered: "Who should see your salary?" / "Should everyone know what you're paid?" / "Why is every paycheck public?" / "What if your bank statement were public?" / statements: "Every address is a public bank statement." / "On-chain, every paycheck is public." / "Getting paid means being watched."
Talk track for this slide: "All of us get paid on-chain. And there is one universal problem every one of us is wary of: everyone can see everything."
Frame: recipient-first headline, batch mechanism as the spine of Solution, Architecture and Demo, Coinbase as the "why now" beat.
Status key: LOCKED = approved by Marcus. DRAFT = awaiting their edits. PENDING = waiting on research digests.
Deck theme (Sep 26, 03:30, per Marcus): the deck now uses the frontend's Direction A Ledger design system, the same tokens, fonts and components as apps/sender and packages/ui. Content and slide order are unchanged. Slide 1 is the lockup plus the one-liner, which is also the landing page eyebrow. Slide 3 is the one navy slide, the NavyPanel at full size.

## Slide 1: Soapay (LOCKED)

- One-liner, the only text under the wordmark (Marcus, Sep 26): "Privacy infrastructure for payments on chain."
- Retired from the slide: "One name, infinite addresses." and the sub-line "Get paid on-chain without publishing your bank statement." Both still work as spoken lines on the Solution slide.

## Slide 2: Our Team (DRAFT, needs Marcus's line)

Slide as built (Marcus, Sep 26): the heading "Team" and five people, each with a photo placeholder, name, current role and one background line. In order: Eason Chai (Founder and CEO, Foresight and ELVTD, a web3 solutions company; previously contracted for Virtuals Protocol), Yudhishthra (Co-Founder, Aqua0; ex-Nethermind, ex-Etherscan), Ee Sheng (Head of Engineering, Thetanuts; Founder, zBase, private payments for agents, Base Batches 003 finalist), Marcus Tan (Founding Engineer, Predictefy; ex-engineer, ELVTD), Cheong Kian (Founding Engineer, Predictefy). Photos still to come. Everything below is spoken, not shown.

- Headline: "We have been paid on-chain for years. All of it is public."
- Eason: six ETHGlobal projects, ten sponsor prizes, including ENS Best Use first place at ETHBogotá (GiveFire), Coinbase CDP creator economy second place at ETHGlobal Bangkok (Dott), Best app on Citrea at ETHGlobal Taipei (Zest).
- Marcus (DRAFT from memory, correct me): built TacitPay, private invoicing with eleven privacy invariants each pinned by a test, and prediction-market infrastructure; ran the analysis of every ETHGlobal project ever showcased that shaped this pitch.
- Lived experience line: "Prizes, grants, contractor invoices, salaries. We have received all four on-chain, to the wallet behind our ENS names. Every payer could see what every other payer paid us."
- Visual: the two ENS names over a blurred explorer history.

## Slide 3: Problem (DRAFT, company-first cut per Marcus, Sep 25 22:00)

Rule for this slide: every line names a company or organization and shows a concrete struggle. No general statements about privacy. Philosophy quotes (EF, Vitalik, a16z, FIS consumer survey, ethereum.org) stay in reserve or move to "why now".

Group 1: companies that will not move payroll on-chain because it would be public
- Deel, the largest payroll platform in the space, $250M in crypto payouts in 2025: chose a private zone over public balances. Tempo, Jun 2, 2026 (verified): "Deel plans to use Tempo's Privacy Zones to keep contractor wallet balances and payout history confidential from public view, while preserving auditable access for Deel." https://tempo.xyz/blog/deel-stablecoin-wallet-global-contractors-tempo/
- Toku, over $1B payroll processed (verified): "Every public company CFO we talk to gets excited about stablecoins until they realize their payroll would be public. That's where the conversation ends." And: "Compliance was never the blocker, we solved that in 100-plus countries. The blocker was every salary sitting on a public ledger." And: "Enterprises generally can't run payroll on glass rails." Same source: less than 1% of businesses use crypto for payroll. https://aleo.org/post/usad-case-study/ and https://aleo.org/post/toku-case-study/ and https://www.toku.com/resources/why-enterprise-companies-have-been-slow-to-adopt-stablecoin-payroll
- Visa (verified): "Many banks see the lack of privacy as a dealbreaker for moving meaningful activity onchain." "Banks can't run payroll if salaries are public, and trading firms can't transact if positions, collateral, or margin movements are visible."
- Fireblocks, custody for banks and payment providers, Apr 20, 2026 (verified): "A B2B payment company can't operate on a public chain where competitors see their transaction volumes and spreads." "Payroll is a really good example here, considering most employees don't want their wages exposed." https://www.fireblocks.com/blog/blockchain-privacy-problem
- Request Finance, over $1B processed, head of product, Sep 4, 2025 (verified): on-chain payments reveal "how much and how often each employee is paid, potentially creating dissatisfaction among coworkers." https://aleo.org/post/aleo-request-finance-private-payments-partnership/
- Rise, crypto payroll, Jan 2026 (verified): the question its customers keep asking, in its own FAQ: "If we pay our team in crypto, can anyone on the internet see how much they're getting paid?" https://www.riseworks.io/blog/are-crypto-payroll-payments-on-rise-public
- Stripe and Paradigm, Tempo (verified): "A company running payroll would publish every salary."
- Circle, Arc, Jun 10, 2026 (verified): "A company's payroll should not be market data." https://www.arc.io/blog/privacy-with-control-how-arc-can-unlock-onchain-finance
- J.P. Morgan, Kinexys: public chains "were radically transparent by design" (spot-check). JPMD is restricted "to exclusively enable J.P. Morgan's institutional clients."

Voice check for the slide: Visa, J.P. Morgan and Deel do not sell a privacy fix. Toku, Request Finance, Rise, Fireblocks, Circle, Tempo, Coinbase and Paxos do. Lead with Deel and Visa, use the vendors as the chorus, and never claim a named employer complained on the record, because none did.

Survey to keep off the slide: EY-Parthenon, June 2025, 350 corporates and financial institutions. Only 9% put "On-chain transaction visibility and privacy" in their top three barriers, 10th of 13; regulatory uncertainty led at 73%. Rebuttal if a judge raises it: only 45 respondents used stablecoins at all, so few had hit the exposure problem, and the survey predates the GENIUS Act, which removed the top barrier. Everyone who has actually run payroll on-chain (Toku, Request Finance, Rise, Deel) names exposure as the blocker. https://www.ey.com/content/dam/ey-unified-site/ey-com/en-us/insights/financial-services/documents/cs-eyp-stablecoin-survey.pdf page 11, spot-check.

Group 2: organizations paying in public today, and what it cost them
- Gitcoin DAO, June 2022 (lead item, verified): a contributor, starting from nothing but their own pay address, traced colleagues' salaries on Etherscan, including a workstream that said it did not share salaries. "Starting only with the knowledge of my own address that I receive my pay at, I was able to find out the salary amounts of several contributors in multiple workstreams." The exact salaries of 15 contributors in one workstream were matched to names. Founder Kevin Owocki objected that people being "careless about not doxing their addresses (or not using ZK tools to achieve privacy)" is no argument for salary transparency. Eight months later the DAO published an aggregate audit instead of individual pay, citing "contributor privacy concerns." About 95% of the DAO's spending is contributor compensation. https://gov.gitcoin.co/t/a-compensation-commitment/10830/24 and https://gov.gitcoin.co/t/contributor-compensation-audit/12750
- MakerDAO, Lido, SushiSwap, Jan 2023 (verified): Token Terminal published their average salaries from public dashboards and budget posts: "$205k, $132k, and $256k, respectively." MakerDAO: $23.5M a year across 104 FTEs. Caveat: from dashboards and budgets, not from tracing transactions. https://tokenterminal.com/crypto-research/how-much-does-it-really-cost-to-run-a-dao
- SushiSwap, twice: Sep 2020, a 500k SUSHI ($1.1M) upfront pay proposal for 0xMaki drew backlash and was replaced (https://thedailygwei.substack.com/p/the-end-of-the-sushi-saga-the-daily). Oct 2022, an $800,000 plus $600,000 head chef package became a public fight and the candidate withdrew.
- Optimism RetroPGF, Nov 2023 (verified): Castle Capital traced Round 2 grants and judged recipients by name. 35% sold, 25% held, 40% untraceable. "Zach received 188k OP tokens and sold for $227k." One recipient's 65k OP were "quickly transferred to Coinbase." Plus the governance thread that traces every grant wallet, 7,700 views. https://chronicle.castlecapital.vc/p/puzzling-reality-optimism-grants-pt2-good-neutral-questionable
- Arbitrum DAO, Sep 2026 (verified): the Watchdog Committee pays whistleblowers to trace how grants were used; about 268,000 ARB paid to whistleblowers, about 532,000 ARB recovered, permanent bans recommended for three projects. Double-edged: DAOs also need audits, so pitch selective disclosure, not darkness. https://cryptobriefing.com/arbitrum-watchdog-permanent-bans-grant-misuse/
- ENS DAO: eight service providers, $4.5M a year, every provider's rate in one public table, streamed by the second.
- Ethereum Foundation, Jan 2025 (verified): every treasury sale is tracked and called dumping. A 100 ETH ($336,475) sale drew a public response from Vitalik, and analysts urged OTC sales to reduce scrutiny. https://cryptoslate.com/vitalik-buterin-addresses-controversy-as-ethereum-foundation-sells-another-100-eth/
- Jump Trading, Aug 2024 (verified): Lookonchain published the firm's remaining inventory mid sell-off from labeled wallets: "a remaining 21,394 ETH worth approximately $68.58 million." https://cointelegraph.com/news/jump-trading-transfers-46-44-m-in-eth-amid-sell-off-manipulation-fears
- Polkadot, Jul 2024 (verified): vendor and influencer payments became headlines, including "$180,000 to slap its logo on 'an entire fleet of Europe-based private jets'." $37M on marketing in H1 2024. Caveat: from a public treasury report; spending is voted publicly. https://www.dlnews.com/articles/defi/polkadot-defends-millions-spent-on-marketing-as-budget-booms/
- Deel: $250M in crypto payouts in 2025, 10,000+ contractors paid to one wallet each cycle. Toku on what that means: "Anyone who maps one employee wallet to one person can see that person's pay, every cycle, forever. Add up the outgoing payments from the company wallet and you have total payroll spend, headcount, and the raw material to estimate runway."
- MrBeast's business: one 2021 post tied his name to one address, and investigators rebuilt an alleged $23M, three-year history from chain data alone.
- Reserve, double-edged, use with care: Celsius and 3AC stETH moves visible days before the freeze (Jun 2022, https://decrypt.co/104102/nansen-analysis-examines-how-terra-collapse-affected-celsius-and-three-arrows-capital); Binance's $1.8B collateral moves to Alameda and Cumberland rebuilt from chain data (Feb 2023, https://www.coindesk.com/business/2023/02/27/binance-moved-18b-in-stablecoin-collateral-to-hedge-funds-last-year-forbes); Uniswap Foundation executive pay fight, from financial statements rather than the chain (Dec 2025).

Proposed final composition, one slide or three:
- 3a "Companies will not pay on-chain in public": Deel's decision, Toku's CFO line, Visa's dealbreaker, then a strip of Fireblocks, Request Finance, Rise, Circle, Tempo quotes.
- 3b "The ones who did got burned": Gitcoin's coworker trace, Optimism grantees judged by name, SushiSwap's two pay fights, MakerDAO and Lido salary averages, the EF and Jump Trading as treasury cases.
- 3c "So the giants built private ledgers, for themselves": Coinbase Base Ledgers, Toku on Aleo, Tempo Zones, Arc, JPMD on Canton, each gated, each with an operator that sees everything.

Group 3: companies that had to build a private ledger to get around it, and every one is gated
- Coinbase, June 2026: Base Ledgers. Use cases in their words: "Onchain payroll without publishing what every employee or contractor earns" and "Pay vendors without broadcasting your supplier list to the public chain." Oct 22, 2025 announcement via CoinDesk: "Privacy is critical for unlocking the full potential of an onchain future." Enterprise early access by application. "The operator runs the services that process each step and decides how to authorize withdrawals."
- Toku, January 2026: moved private payroll to Aleo with a Paxos stablecoin, for select enterprise clients. Paxos Labs co-founder (verified): "Privacy is becoming table stakes for enterprise adoption."
- Request Finance, September 2025: integrated Aleo private payments so customers can run payroll and pay vendor bills off the public chain.
- Rise: a burn-and-mint bridge so payouts are not linked wallet to wallet. Obfuscation, not privacy.
- Stripe and Paradigm, April 2026: Tempo Zones, design partners only. "The zone operator has visibility into all transactions within the zone." Deel is the only named user.
- Circle, 2026: Arc Privacy for enterprises. The Arc docs fetched Sep 25 still say privacy "not yet available" network-wide, while a June 17 report says Arc Privacy launched. Check which is current before the slide.
- J.P. Morgan, January 2026: JPMD moving to Canton, a permissioned privacy network.

Slide takeaway: the biggest names in payments have all said the same thing, and each of them fixed it only for enterprises, behind an operator. Everyone else still pays in public.

Pending: evidence-E-companies-vendors.md and evidence-F-companies-daos.md, a second research pass on named companies and organizations only.

Source pool below (kept for citations):

Beat 1, the leak: "Every address is a public bank statement." Ethereum.org roadmap: "Anyone can see who sent how much to whom." (https://ethereum.org/roadmap/privacy/)

Beat 2, evidence wall. Every quote checked against the fetched page on Sep 25, 2026.

| Who | Evidence | Date | Source |
|---|---|---|---|
| Visa | "Many banks see the lack of privacy as a dealbreaker for moving meaningful activity onchain." Also: "Banks can't run payroll if salaries are public." | Mar 25, 2026 | https://usa.visa.com/about-visa/newsroom/press-releases.releaseId.22231.html |
| Stripe and Paradigm, Tempo | "A company running payroll would publish every salary." Zones: "The zone operator has visibility into all transactions within the zone." Design partners only. | Apr 16, 2026 | https://tempo.xyz/blog/privacy-on-tempo/ |
| Toku, over $1B payroll processed | CEO Ken O'Friel: "Every public company CFO we talk to gets excited about stablecoins until they realize their payroll would be public." Same page: "Anyone who maps one employee wallet to one person can see that person's pay, every cycle, forever. Add up the outgoing payments from the company wallet and you have total payroll spend, headcount, and the raw material to estimate runway. None of that requires a breach. It is simply how the ledger works." And: "Privacy, not speed or cost, is what kept enterprise finance teams on the sidelines." | Jan 2026 | https://www.toku.com/resources/how-toku-runs-fully-private-stablecoin-payroll-on-aleo-and-usad |
| Coinbase, Base Ledgers | "Onchain payroll without publishing what every employee or contractor earns." Early access, enterprise. | Jun 2026 | https://www.base.org/ledgers and https://docs.base.org/ledger/overview |
| Circle, Arc | Confidentiality "their businesses require." Docs: "Privacy features are on the roadmap and not yet available on Arc." | Sep 16, 2026 | https://www.circle.com/pressroom/circle-launches-arc-mainnet-an-economic-operating-system-for-the-internet and https://docs.arc.io/arc/concepts/opt-in-privacy |
| FIS survey, 1,000 US full-time workers | "Security and privacy concerns emerged as the top barriers to adoption (42.4% each)" | Nov 11, 2025 | https://www.fisglobal.com/about-us/media-room/press-release/2025/fis-research-banks-hold-the-key-to-stablecoin-adoption |
| a16z State of Crypto | "Privacy is returning to the foreground and could be a prerequisite for wider adoption." Stablecoins $46T volume in a year. | Oct 2025 | https://a16zcrypto.com/posts/article/state-of-crypto-report-2025/ |
| ENS DAO | Every service provider's annual pay in one public table, 4.5M USDC a year, streamed per second. Approved by public vote. | 2025 | https://github.com/5ajaki/SPP2-Streams/blob/main/README.md |
| MrBeast | "MrBeast doxxed his own primary wallet address via a 2021 social media post." Alleged $23M, three-year history rebuilt from chain data. Allegations, not findings. | Oct 30, 2024 | https://beincrypto.com/mrbeast-crypto-insider-trading-allegations/ |
| Arkham on Trump | Disclosed $2,806,341 balance matched to an NFT royalty wallet, published as a live profile. | Aug 16, 2023 | https://info.arkm.com/announcements/donald-trumps-crypto-holdings-are-now-on-arkham |
| Arkham Intel Exchange | Paid bounties to deanonymize wallet owners, called a "dox-to-earn program" by critics. | Jul 2023 | https://finance.yahoo.com/news/arkham-dox-earn-platform-offers-181403790.html |
| EDPB, EU regulators | On-chain metadata including wallet addresses "may constitute personal data when they enable direct or indirect identification of a natural person" | Jul 7, 2026 | https://www.edpb.europa.eu/documents/guideline/guidelines-on-processing-of-personal-data-through-blockchain-technologies_en |
| J.P. Morgan, Kinexys head Oliver Harris | Public blockchains "were radically transparent by design." "And until recently, there were some trade-offs between compliance, privacy, and finality." WebFetch extract, matched across two fetches. | Jun 2, 2026 podcast | see evidence-B-institutions.md item on JPMorgan for the page |
| Ethereum Foundation, Privacy Cluster | Launched with 47 members. Foundation quote via Decrypt: "Privacy is normal. Privacy is for everyone." Useful with EF judges in the room. | Oct 2025 | see evidence-B-institutions.md |
| Base Ledgers, Japanese coverage | Atarashii Keizai: 「同基盤は現在早期アクセスとして提供されており、利用には申請が必要となっている。」 (early access, application required). Launch was June 17 in Japan. | Jun 2026 | https://www.neweconomy.jp/posts/584457 |

Scale, so the leak is not hypothetical. Strongest numbers first. "Full scrape" means the quote was read on the page itself.

| Number | What it is | Date | Source | Check |
|---|---|---|---|---|
| $250M | Deel crypto payouts in 2025, "grown consistently year on year" | May 20, 2026 | https://www.finextra.com/pressarticle/109900/deel-launches-stablecoin-salary-payouts-and-appoints-head-of-crypto | full scrape |
| 10,000+ | Deel contractors in 100+ countries who chose stablecoin pay. Employees can now take 10% to 25% of net salary in stablecoins | 2026 | https://www.bvnk.com/blog/deel-teams-up-with-bvnk | search extract |
| 9.6% | Crypto-industry workers paid in crypto in 2024, a 3x jump from 2023. USDC 63%, USDT 28.6% of crypto salaries | 2024 survey | https://panteracapital.com/blockchain-compensation-survey-2024/ | search extract |
| $33T | Stablecoin transaction volume in 2025, up 72%, per Artemis | Jan 8, 2026 | https://www.bloomberg.com/news/articles/2026-01-08/stablecoin-transactions-rose-to-record-33-trillion-led-by-usdc | full scrape |
| ~$390B | True stablecoin payments in 2025, more than double 2024, per McKinsey. Use as the honest footnote to $33T | 2025 | https://www.mckinsey.com/industries/financial-services/our-insights/stablecoins-in-payments-what-the-raw-transaction-numbers-miss | search extract |
| $4.5M a year | ENS DAO streams to 8 named providers by the second, proposal EP 6.13 | Jul 5, 2025 | https://agora.ensdao.org/proposals/20404686300257550242704646761273386459664655640264490428281621095220078268383 | full scrape |
| 30M OP to 501 | Optimism Retro Funding Round 3 recipients, all public | 2024 | https://gov.optimism.io/t/retropgf-rf-rounds-1-7-uncovering-the-trends-in-participation-categories-op-allocation/10208 | search extract |
| $60M+ to 3,700+ | Gitcoin grants distributed, each payout a public funder-to-builder link | Sep 2026 page | https://gitcoin.co/mechanisms/quadratic-funding | search extract |
| 17.9% | Active Ethereum accounts clustered with three public heuristics in 2020, 340,000+ entities; the exchange deposit address heuristic is "the most effective approach" | FC 2020 | https://link.springer.com/chapter/10.1007/978-3-030-51280-4_33 | full scrape |
| 5.4B | Arkham address tags | Mar 2026 | https://www.linkedin.com/posts/arkhamintelligence_blockchain-analysis-is-not-straight-forward-activity-7442942127388409856-UlwY | truncated extract |
| 35M+ | ENS registered names, so a named salary wallet is searchable by name | Sep 2026 | https://ens.domains/ | search extract |
| ~$4.1B | USDC supply on Base | Jan 2026 | https://www.talos.com/insights/state-of-the-network-351 | search extract |

| $1.5B+ and over 50% | Rise lifetime payroll volume, and "over 50% of worker withdrawals occurring in stablecoins": given the choice, most workers take stablecoins | Sep 2026 page, Q1 2026 report | https://www.riseworks.io/blog/stablecoin-payroll-for-daos-and-web3 | WebFetch extract, spot-check |
| 71.4M ARB to 56 | Arbitrum short-term incentive program grants, every recipient address public | through Jan 2024 | https://www.arbitrumhub.io/incentive-programs/short-term-incentive-program/ | WebFetch extract, spot-check |
| $750M+ to 350,000+ wallets | Superfluid cumulative value streamed, every stream rate public. Sablier: 552,000+ streams | early 2025 figures | https://www.spark.money/research/recurring-stablecoin-payment-infrastructure | WebFetch extract, third party, spot-check |
| 17.65% | Railgun withdrawals uniquely linked to deposits by behavior alone: timing, address reuse, graph proximity, amount patterns. Shows that hiding the address is not enough; amounts and timing leak too, which is why denominated payouts exist | Jun 24, 2026 arXiv | https://arxiv.org/abs/2606.25926 | WebFetch extract of abstract, spot-check |

Weaker, confirm before use: Request Finance "$1.2+ billion in crypto payments" (X profile, undated). The Rise $1.5B figure above replaces the earlier video-description version.

Suggested slide line: "Deel alone paid a quarter of a billion dollars to worker wallets last year, and one in five active Ethereum accounts was linkable to an identity with public heuristics back in 2020. The strongest link fires the moment a worker forwards salary to an exchange."

Reserve for Q&A and speaker notes:
- ZachXBT price sheet: wallet addresses and prices for 200+ influencers, Sep 1, 2025. https://www.theblock.co/news/business/2025-09-01-zachxbt-says-over-100-crypto-influencers-accepted-promo-deals-without-disclosing-paid-ads-368956
- Sushi head chef package, $800,000 plus $600,000 in SUSHI, became a public fight, Oct 2022. https://www.theblock.co/news/defi/2022-10-03-sushi-dao-votes-jared-grey-as-new-head-chef-174392
- Optimism forum thread tracing every grant wallet, including "a deposit to a fresh Coinbase wallet". https://gov.optimism.io/t/op-grants-through-season-2-where-has-the-op-gone/4025
- Japan APPI: identifiable wage data is personal information (our reading). https://www.japaneselawtranslation.go.jp/en/laws/view/4241/en
- Vitalik, Apr 2025: privacy of onchain payments is first of four roadmap areas; wallets should send from a shielded balance by default. https://vitalik.eth.limo/general/2025/04/14/privacy.html and https://ethereum-magicians.org/t/a-maximally-simple-l1-privacy-roadmap/23459
- Harm, claim risk not cause: Ledger co-founder Balland kidnapped, about 10m euro ransom demanded in crypto (https://www.theguardian.com/world/2025/may/04/french-police-investigate-spate-of-cryptocurrency-millionaire-kidnappings); more than 70 wrench attacks in 2025 per Lopp's tracker (https://www.dlnews.com/articles/regulation/crypto-wrench-attacks-to-surge-following-a-violent-2025/); Coinbase insider leak of balance data, 69,461 customers, $180M to $400M cost (https://www.theblock.co/news/markets/2025-05-21-coinbase-reveals-69461-users-affected-in-december-2024-data-heist-filing-355216).
- Judge pushback line: "The same tools that expose scammers also read your salary."

Beat 3, Coinbase built the fix for enterprises. Base Ledgers docs, quoted:
- "Base Ledgers is in early access."
- "Purpose-built for the modern enterprise."
- "The operator runs the services that process each step and decides how to authorize withdrawals."
- Deposit: asset public, amount public, sender public, recipient hidden. "Onchain, a withdrawal reveals the asset and amount but not the account behind it."
- "KYC by Coinbase Direct, sanctions screening built in, and Coinbase handles licensing."

| | Base Ledgers | Soapay |
|---|---|---|
| Who can use it | Enterprise, early access, request a demo, KYC via Coinbase Direct or own provider | Anyone with a wallet and an ENS name |
| Who runs it | An operator runs the ledger and decides how to authorize withdrawals | Nobody. Canonical ERC-5564 and ERC-6538 contracts, no operator |
| Where pay sits | Inside the operator's ledger, behind the operator's KYC | In addresses only the recipient can open |
| What stays public | Deposit: asset, amount, sender. Withdrawal: asset, amount | Sender and chunked amounts in v1. Recipient never linkable |
| Recipient needs | An account inside that ledger | One ENS name |
| Payer needs | Adopt the ledger and its Portal flow | Sender app, or any ENS-aware wallet |
| Getting money out | A withdrawal that reveals the amount again | Spend from the stealth address with no ETH from a known wallet, or a screened exit |

Takeaway line: Coinbase proved the demand and the shape, hide the recipient on the way in and unlink on the way out. Soapay delivers those two properties without the ledger, the operator, or the enterprise gate, on open standards, for a five-person team or a single contractor today.

Base Ledgers, further quotes from the docs (evidence D):
- Coinbase Developer Platform on launch day: "Private transactions are launching on @base today, powered by a new enterprise privacy architecture called Ledgers" (https://x.com/CoinbaseDev/status/2066992742094483718).
- Managed mode: "Coinbase runs the Ledger and the compliance, so you get confidentiality without standing up any infrastructure." The operator sees every balance and amount. In Managed mode that operator is Coinbase.
- Deposit: "The asset, amount, and sender settle publicly on Base, but the recipient is encrypted." Withdrawal: "reveals the asset and amount but not the account behind it."
- Private receipt only works when the payee holds an account in the same ledger. No individual or self-serve tier found. Demos are "mock only".

Where the other fixes fall short, for an individual or a small team. Every quote is from the vendor's own page.

| Approach | Who can use it | What it still exposes | The catch, in their words |
|---|---|---|---|
| Base Ledgers, Coinbase | Businesses in early access through a CDP business account | Deposit sender and amount; withdrawal destination and amount; everything to the operator | "The operator runs the services that process each step and decides how to authorize withdrawals." |
| Tempo Zones, Stripe and Paradigm | Design partners | Everything to the zone operator | "The zone operator has visibility into all transactions within the zone." |
| Arc, Circle | Enterprises, later | Everything, today | "Privacy features are on the roadmap and not yet available on Arc." |
| Canton and JPMD, J.P. Morgan | Banks and institutional clients | Permissioned | "to exclusively enable J.P. Morgan's institutional clients" |
| Toku on Aleo | Toku's enterprise clients, waitlist or demo, no self-serve. Jan 29, 2026 release: "will roll out to select Toku enterprise clients in Q1 2026, with full availability expected by mid-2026." | Off Ethereum entirely: Aleo L1, settled in USAD from Paxos Labs. Aleo's case study: "Payroll funds flow into Toku's platform." Recipients need an Aleo wallet. | A payroll vendor plus a separate chain and stablecoin. Aleo's own payroll page steers "Smaller teams paying a handful of contractors" to wallet providers instead. Spot-check: read via WebFetch. |
| Fluidkey | Individuals | Sender, amounts, and everything to Fluidkey | "only you and Fluidkey can see all transactions and assets." Server holds a viewing key and runs the only resolver. No batch payouts. 20 sponsored transactions a day. Its FAQ: "stealth addresses do not break traceability." |
| Umbra v1 | Anyone | Sender, amount, token | Team relayer by default. v2 never shipped. Batch-send contract exists in the repo. Warns on risky withdrawal addresses. |
| Railgun | Railgun wallet users, not on Base | Shield and unshield details | 0.25% in and 0.25% out. Compliance proof optional. FBI: Lazarus laundered $60M through it in 2023. |
| Privacy Pools, 0xbow | Ethereum mainnet | Deposit and withdrawal details | Screened, but mainnet only, one association set provider, 0.5% vetting fee |
| Aztec | Alpha software | Unverified | Critical proving flaw disclosed July 2026: "pause that work" |
| Tornado Cash | Anyone | Deposits and withdrawals | Sanctioned 2022, delisted 2025, "no attempt to determine their origin" |

Sources for this table: https://docs.base.org/get-started/private-transactions, https://tempo.xyz/blog/privacy-on-tempo/, https://docs.arc.io/arc/concepts/opt-in-privacy, https://www.jpmorgan.com/payments/newsroom/kinexys-usd-digital-deposit-tokens, https://www.toku.com/resources/how-toku-runs-fully-private-stablecoin-payroll-on-aleo-and-usad, https://docs.fluidkey.com/readme/frequently-asked-questions, https://docs.fluidkey.com/technical-documentation/technical-walkthrough, https://app.umbra.cash/faq, https://docs.railgun.org/wiki/assurance/private-proofs-of-innocence, https://www.fbi.gov/news/press-releases/fbi-confirms-lazarus-group-cyber-actors-responsible-for-harmonys-horizon-bridge-currency-theft, https://docs.privacypools.com/deployments, https://l2beat.com/privacy/projects/privacy-pools, https://aztec.network/blog/aztec-ignition-chain-update, https://home.treasury.gov/news/press-releases/jy0916, https://home.treasury.gov/news/press-releases/sb0057

Honest gaps to own before a judge finds them:
- The screened exit runs on Ethereum mainnet, not Base. From Base it is a CCTP hop per stealth address plus mainnet gas. Say "deliberate, not default."
- Fluidkey already ships a static name, fresh addresses and sponsored gas. Our edge: client-side derivation with no server-held viewing key by default, batch payouts with atomic announcements, denominated chunks, the cluster guard, audit mode for the hosted option, and a screened exit.
- Umbra already warns on risky withdrawal addresses and has a batch-send contract. Our guard models clusters across every address you hold, labels destinations, and blocks the doxxing send behind the exit. Our batch is a payroll product: atomic announcements, denominations, Safe output.
- Amounts stay visible in v1 beyond chunking. The shielded rail is v2.
- Kohaku, the EF wallet SDK, has no stealth-address package and is marked not production ready, so there is no upstream default we are duplicating.

Decisions taken Sep 25, 22:10, override if you disagree: the ENS DAO line is off the slide and in reserve, because Gitcoin is the stronger lead and it avoids poking the sponsor in the room. The harm cases stay in reserve, because none ties an attack to a chain read and the slide is about companies.

## Slide 4: Solution (LOCKED, Sep 25)

Soapay IS **PRIVACY INFRASTRUCTURE FOR PAYMENTS ON CHAIN** WHERE **EVERY PAYMENT LANDS ON A FRESH ADDRESS THAT ONLY YOU CAN OPEN** AND **YOU CAN SPEND IT WITHOUT IT EVER LINKING BACK TO YOU**

Render: solution-slide-final.png in this folder. Source: solution-slide.html, variant "final".
Accuracy note: the sender and the payment itself stay visible by design. The third clause means no link back to you, your name or the wallet people already know. Marcus changed it from "without a trace" on Sep 26, since "trace" can sound like a mixer to a compliance-minded judge.

Follow-on content for the Solution slide (below the sentence or on the next slide). Worded so each claim survives the prior art in evidence D:
1. The batch is the anonymity set: one transaction, N fresh addresses, announcements atomic with payment, and denominated chunks so the batch reads as identical transfers to strangers.
2. Client-side derivation by default: no server ever holds a viewing key. Gateway mode is optional, self-hostable, and audited by the recipient app.
3. First spend via 7702 delegation with gas paid in USDC through a paymaster: no ETH from a known wallet, no relayer to trust.
4. The consolidation guard: a local cluster graph with labelled destinations that warns on merges and blocks identifiable destinations behind a screened exit.
5. Five privacy invariants, each a CI test, and a ledger rebuildable from seed with every server off.
- What we deliberately do not hide: the sender, and the fact that a payment happened.
- Name line: "Soap means clean by construction. We hide from colleagues, not from the law. The only mixing is through a screened pool."

## Slide 5: Architecture (DRAFT, high level per Marcus; detail deferred until the build is final)

Headline: "Three apps on open standards. Nothing of ours holds money."

Four boxes, left to right:
- Recipient app: your keys, your ledger, your guard. Nothing leaves the browser.
- Sender app: paste names and amounts, one transaction pays everyone on fresh addresses.
- Optional gateway: for wallets that cannot derive. Self-host it or use ours. The app checks its work.
- Chain: ENS name, stealth address registry and announcer, gasless spend, screened exit.

Three lines under the boxes:
1. Every contract we touch is a public standard someone else already audited.
2. The only thing you ever share is a name.
3. Everything rebuilds from your seed with every server off.

Detail, invariants and the chain choice: see the appendix at the end of this document, to be placed once Eason's build is final.

Build checks, all verified on official pages Sep 25, 2026 (evidence D):
- ERC5564Announcer 0x55649E01B5Df198D18D95b5cc5051630cfD45564 and ERC6538Registry 0x6538E6bf4B0eBd30A8Ea093027Ac2422ce5d6538 are deployed at the same address on Sepolia, Base and Base Sepolia (also Ethereum, Arbitrum, Gnosis, Optimism, Polygon, Scroll, Holesky, Arbitrum Sepolia, Optimism Sepolia). Audited by Trail of Bits. https://github.com/ScopeLift/stealth-address-erc-contracts
- ENSv2 beta is live on Sepolia: own subname registries, Enhanced Access Control (role-based, per record), Permissioned Resolver, Universal Resolver V2 where "the resolver that covers the longest matching suffix of the name wins" and parent-level resolvers implement ENSIP-10 IExtendedResolver. https://docs.ens.domains/ensv2/overview and https://docs.ens.domains/learn/deployments
- EntryPoint v0.8 has "Native support for EIP-7702 authorizations" and ships Simple7702Account. https://github.com/eth-infinitism/account-abstraction/releases/tag/v0.8.0
- Circle Paymaster v0.8 takes USDC for gas on Base Sepolia and Ethereum Sepolia at 0x3BA9A96eE3eFf3A69E2B18886AcF52027EFF8966, no signup needed. Pimlico's ERC-20 paymaster also lists USDC on both. https://developers.circle.com/paymaster/addresses-and-events and https://docs.pimlico.io/references/paymaster/erc20-paymaster/supported-tokens
- Privacy Pools: Ethereum mainnet only. https://docs.privacypools.com/deployments

Recommendation for Eason: build the demo on Ethereum Sepolia. Everything needed is there, and the ENS prize requires ENSv2 to be central, which only exists on Sepolia. Present Base as the production target. Use ENSv2 structurally: a soapay.eth subname registry issuing recipient names, Enhanced Access Control so a gateway can edit only the stealth text record, and a Permissioned Resolver for gateway mode.

## Slide 6: Future Plan (DRAFT, reframed per Marcus Sep 25 22:50: breadth of payouts, not protocol roadmap)

Headline: "Payroll is the wedge. The rail is for every payout."

Eight use cases, tagged Now, Next, Later. Anything that pays many people from one place publishes them all today.
- Now: salaries and contractor pay. One sender, many people, every month. The batch is the anonymity set.
- Now: DAO contributors and grants. Bigger batches, multisig senders, same rail.
- Next: dividends and revenue share. The largest batches of all. Every holder paid, no holder exposed.
- Next: token and equity allocations. Vesting, team and investor allocations, cap table payouts. Each allocation stays private.
- Next: invoices and freelancers. The client pays a name from any wallet. No tooling change.
- Later: tips, donations, creators. One name in a bio.
- Later: prizes and bounties. Hackathon prizes, bug bounties, referral rewards, without a public winners' list.
- Later: agents paying agents. Pay by name with ERC-8004 identity. No public revenue feed.

Closing line: "Same three apps, same audited contracts. Only the recipient list changes."
Muted footer: "Also coming: hosted gateway with audit mode, shielded amounts, SDK for wallets and agents."

Protocol roadmap items (hosted gateway with audit mode, shielded rail for amounts, MCP server over the SDK, guard as a wallet library, more chains) move to Q&A and the appendix. Business model stays out of scope; the hosted gateway is the obvious one if asked.

## Slide 7: Demo (slide is the single word "Demo" per Marcus, Sep 26; the beats below are the run sheet for the live demo and the video)

Beat 0, before: a real public payroll batch on an explorer. Click one line. The whole person appears.
Beat 1, onboarding: Alice creates her seed, gets alice.soapay.eth on ENSv2 Sepolia, and her meta-address is registered gaslessly by a throwaway registrant. She sends her employer one string.
Beat 2, pay run: the employer pastes five names and amounts, flips denominated payouts to 500 USDC chunks, signs one transaction.
Beat 3, the explorer: one transaction, a column of identical transfers to addresses that have never existed before, announcements in the same transaction. Click one. Nothing else is there.
Beat 4, Alice's side: her app scans by view tag, the payments appear as one balance, nothing links them.
Beat 5, spend: Alice pays for something from a stealth address. The address delegates via 7702 and the paymaster takes gas in USDC. Her main wallet never appears.
Beat 6, the failure path: Alice tries to send everything to her labelled Coinbase deposit. The guard shows which clusters would merge and link to her identity, blocks the send, and offers the screened exit through Privacy Pools or an explicit override.
Beat 7, trust: switch the gateway off, delete the local ledger, rebuild everything from the seed. Then the CI run with five green invariant tests.

Video caption for beat 3, reuse the mechanism line: "A whole payroll lands as identical transfers to addresses no one has seen before."

## Talk track, twelve slides, about three and a half minutes plus demo

Narrative arc (Sep 26, 10:40): slide 3 asks the question. Proofs 1 and 2 answer it with people, proof 3 shows the cost, and proof 4 shows that the fixes which exist prove the demand but do not reach the people in the room. The Solution slide answers the question one last time: only you. If the slot is three minutes flat, keep proofs 1, 3 and 4.

- 0:00 Title. "Soapay. Privacy infrastructure for payments on chain."
- 0:10 Team. "We build for web3 companies, and they pay us on-chain: prizes, grants, contractor invoices, salaries. There is one problem every one of us is wary of, and it is the same for anyone paid on a public chain."
- 0:30 Statement. Pause. "Who sees what you earn?"
- 0:40 Proof 1, everyone with a browser. "Today the answer is: everyone. This is a live payout batch on Base I captured tonight. One Disperse batch, four recipients, between sixteen and fifty-five thousand dollars each, five minutes old, readable forever. Map one address to a person and you know their pay every cycle."
- 1:00 Proof 2, your colleagues. "Including the people you work with. Everyone in a batch is paid from the same address, so anyone in it can see everyone else. At Gitcoin, one contributor started from nothing but their own pay address and put names to fifteen colleagues' salaries. When the DAO then tried to publish salaries officially, contributors refused over privacy. That is the page on the right. They were refusing to publish what the chain had already published." Optional, from the strip: Optimism grantees traced and judged by name; MakerDAO and Lido averages published by an outsider.
- 1:20 Proof 3, so companies walk away. "Which is why serious companies will not pay on-chain at all. Toku has processed over a billion dollars of token payroll. Their CEO says every public company CFO gets excited about stablecoins until they realize their payroll would be public, and that is where the conversation ends. Compliance was never the blocker. Visa calls it a dealbreaker for banks. Stripe's own chain says a company running payroll would publish every salary."
- 1:40 Proof 4, so they built private payrolls. "So the market built private payroll. Three of them. Toku moved to Aleo, a separate chain with its own stablecoin, for enterprise clients. Stripe's Tempo built private zones, design partners only, and Deel, which pays forty thousand businesses, moved its contractors into one, keeping auditable access for itself. Coinbase shipped Base Ledgers: request a demo, early access, an operator runs it. That proves the problem is real. It also shows the two flaws every fix shares. One: not for everyone. Enterprise clients, design partners, early access by application. Two: not fully private. Your pay sits in their ledger or on their chain, and the operator sees everything. Everyone else still pays in public."
- 2:05 Solution. "So we asked the question again. Who sees what you earn? With Soapay: only you." Read the sentence. Then: "The batch is the anonymity set, derivation happens in your browser so no server holds a viewing key, first spend pays gas in USDC so your main wallet never appears, and a guard stops you from linking it back by accident. We hide from colleagues, not from the law. The only mixing is through a screened pool."
- 2:45 Architecture. "Three apps on open standards. Nothing of ours holds money. Every contract we touch is a public standard someone else already audited. The only thing you ever share is a name. Everything rebuilds from your seed with every server off."
- 3:00 Use cases. "Payroll is the wedge, but the rail does not care what the payment is called. Anything that pays many people from one place works today: dividends and revenue share, token and equity allocations, vendor payments, grants and bounties, prizes and airdrops, tips and donations. One sender, many names, one transaction."
- 3:15 Future plan. "Three things we add next. Shielded amounts: hide the number, not just the name. Any wallet: the guard and pay-by-name as an SDK wallets embed. And agents paying agents by name, with ERC-8004 identity and no public revenue feed."
- 3:30 Demo. Beats 2 through 6 live, beats 0 and 7 in the video.
- Close. "Who sees what you earn? Only you. Coinbase built this for enterprises in June. We built it for everyone else, this weekend, on open standards."

## Q&A sheet

- "Isn't this Fluidkey?" Same standards, different side of the payment. Fluidkey is a wallet for an individual: its server derives your addresses at name resolution and holds your viewing key, so it sees every payment you receive, and it never touches the batch, which is where a coworker reads your salary. Its FAQ admits consolidation links you. We are the payer's rail: the sender's browser derives every address and throws the key away, only you hold your viewing key, one transaction pays and announces everyone with amounts chunked and sorted so totals never leak, a cluster guard and a timing queue watch every spend, the exit is a screened Privacy Pools deposit, and everything rebuilds from your seed with the public SDK. The row-by-row table is in the README.
- "Isn't this Umbra?" Umbra v2 never shipped and v1 needs its relayer. We use 7702 with a USDC paymaster, no relayer, and a cluster guard rather than a warning box.
- "Isn't this money laundering?" We hide the recipient from colleagues and the public, not the sender or the payment. Amounts are visible in v1. The only mixing is Privacy Pools, whose withdrawals are gated by an association set provider. Tornado was sanctioned for "no attempt to determine their origin." That is the line we stay behind.
- "Why not Base Ledgers?" Enterprise early access by application, an operator that sees everything and decides withdrawals, and the payee must have an account inside that ledger. We need a wallet and a name.
- "Amounts are visible." Yes, chunked in v1. The June 2026 Railgun study shows amounts and timing leak even inside a pool. The shielded rail is v2.
- "The exit is not on Base." Correct. Privacy Pools is mainnet only, so the exit is a bridge hop per address plus mainnet gas. Deliberate, not default.
- "The EY survey says privacy is not a top blocker." Only 45 of 350 respondents used stablecoins at all, and it predates the GENIUS Act. Everyone who has actually run payroll on-chain, Toku, Request Finance, Rise, Deel, names exposure as the blocker.
- "Why the name?" Soap means clean by construction.

## Appendix: architecture detail, for later

Diagram, left to right:
- Recipient app (browser): spending key, viewing key, scanner, cluster graph and guard, 7702 spend. Keys never leave it.
- Sender app (browser): payroll list, resolves every name on every run, derives one fresh address per line, one transaction: multisend plus announcements, atomic.
- Optional gateway (self-hosted docker or hosted by us): CCIP-Read resolver for wallets that cannot derive. Holds a viewing key only. Every address it issues is recomputed and audited by the recipient app.
- On-chain: ENSv2 name and subname registry; ERC-6538 Registry; ERC-5564 Announcer; existing multisend; stealth EOAs that delegate to an audited account via 7702 on first spend; EntryPoint v0.8 with Circle Paymaster taking gas in USDC; Privacy Pools on Ethereum mainnet for the screened exit.

Callouts once the build is final:
1. Nothing custom holds funds. The registry and announcer are the canonical ERC deployments audited by Trail of Bits, at the same address on every chain we touch.
2. ENSv2 is structural, not cosmetic: soapay.eth runs its own subname registry that issues recipient names; the stealth meta-address lives in a text record; Enhanced Access Control lets a gateway edit only that one record and nothing else; gateway mode resolves through a Permissioned Resolver via ENSIP-10.
3. Five privacy invariants, each a CI test: no stealth address is ever returned twice; no labelled address ever funds a stealth address; every payment has an announcement in the same transaction or before it; the ledger rebuilds from seed plus chain with every gateway offline; any gateway-issued address the app cannot reproduce is flagged within one scan.

What we deliberately do not hide: the sender, and the fact that a payment happened. Amounts are chunked in v1, fully shielded in v2.

Demo chain: Ethereum Sepolia, because ENSv2 only exists there and everything else we need is there too. Production target: Base. Build checks with addresses are in the Slide 5 section above.
