# Evidence E: companies and vendors blocked by public payroll

Researched September 25, 2026. "Verified" means I string-matched the quote in the raw page text I downloaded. "Spot-check" means it came only through a summarizing fetch or a search snippet.

Read this first. Almost every strong quote comes from a company that sells a privacy fix. No named employer is on record complaining. Toku's CEO speaks for CFOs he does not name. The EY survey in item 12 cuts against "privacy is the top blocker", so keep it off the slide.

## Items

**1. Toku (stablecoin payroll vendor, CEO Ken O'Friel)**
- What: He says enterprise deals die once CFOs see that payroll would be public. Toku partnered with Aleo and Paxos Labs to run payroll on a private chain.
- Date: July 21, 2026 (Aleo USAD case study) and July 29, 2026 (Aleo Toku case study).
- Sources: https://aleo.org/post/usad-case-study/ and https://aleo.org/post/toku-case-study/
- Quote (verified): "Every public company CFO we talk to gets excited about stablecoins until they realize their payroll would be public. That's where the conversation ends."
- Second quote (verified): "Compliance was never the blocker, we solved that in 100-plus countries. The blocker was every salary sitting on a public ledger. Aleo now handles that."
- Numbers (verified, USAD page): stablecoins processed over $33 trillion in 2025. Less than 1% of businesses use crypto for payroll. Toku has processed more than $1 billion in token payroll volume.
- Slide use: Make this the lead quote. The new ending, "That's where the conversation ends", shows the deal dying. The second quote rules out compliance as the cause.
- Toku's own pages (verified): "Enterprises generally can't run payroll on glass rails." (April 30, 2026, https://www.toku.com/resources/why-enterprise-companies-have-been-slow-to-adopt-stablecoin-payroll). "Anyone who maps one employee wallet to one person can see that person's pay, every cycle, forever." (July 24, 2026, https://www.toku.com/resources/how-toku-runs-fully-private-stablecoin-payroll-on-aleo-and-usad)

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
- October 2025 (verified): CoinDesk quotes Coinbase's announcement, not Armstrong himself: "Privacy is critical for unlocking the full potential of an onchain future," (https://www.coindesk.com/business/2025/10/22/coinbase-is-building-private-transactions-for-base-ceo-brian-armstrong-says)
- Slide use: Coinbase had to build a private ledger beside its own public chain. Its product page names suppliers and payroll directly.

**5. Tempo (Stripe and Paradigm)**
- What: Tempo shipped Zones, which are private parallel chains. It built them with a small group of design partners it did not name, covering payroll, treasury and settlement.
- Date: April 16, 2026.
- Source: https://tempo.xyz/blog/privacy-on-tempo/
- Quote (verified): "A company running payroll would publish every salary."
- Also verified: "Several enterprises and financial institutions are exploring using Zones"
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

## Strongest ten for a company-struggles slide, ranked

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

## Searched, nothing usable

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
