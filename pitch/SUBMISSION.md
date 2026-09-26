# ETHGlobal Tokyo 2026 submission

Text for the project page. Each field is plain text on the form, so paste the block as is. Every claim below comes from `README.md`, `CLAUDE.md` and the pitch evidence digests in `pitch/evidence/`.

## Short description

Privacy infrastructure for payments on chain.

## Description

Soapay is privacy infrastructure for payments on chain. Every payment lands on a fresh address that only you can open, and you can spend it without a trace.

Who sees what you earn? On a public chain, everyone with a browser. A payroll batch on Base shows every recipient and every amount next to each other, readable forever. Your colleagues too: a coworker who knows their own line can trace everyone else's, and at Gitcoin DAO a contributor put names to fifteen colleagues' exact salaries starting from nothing but their own pay address. So companies walk away. Visa calls the lack of privacy a dealbreaker for banks, and Toku says every CFO conversation ends the moment they realise payroll would be public. The fixes that exist (Base Ledgers, Tempo Zones, Toku on Aleo) are private ledgers for enterprises. They are not for everyone, since you apply for access, and not fully private, since your money sits in their ledger or on their chain and the operator sees everything. Everyone else still pays in public.

What Soapay does: a recipient shares one name, such as alice.soapay.eth. Every payment to that name lands on a fresh stealth address that only the recipient can open and spend from. A coworker reading the same batch sees a list of never-before-seen addresses and cannot tell which line is theirs. The recipient scans the chain, finds their payments, and spends them without ever touching the wallet everyone already knows.

How it works. Onboard once: the recipient app derives spending and viewing keys from one seed, registers the stealth meta-address in the canonical ERC-6538 registry through a throwaway registrant, and issues an ENSv2 subname whose stealth text record holds the meta-address. The name has no addr record, so nobody can pay a static address by mistake. Pay in one transaction: the sender app takes names and amounts, resolves each name once and pins its meta-address, derives a fresh ERC-5564 stealth address for every line, sorts the lines so the order says nothing about who is who, and pays and announces them atomically. Plain EOA employers go through StealthDisperse, our one contract, which holds no funds, keeps no state and has no owner. Smart accounts, 7702 wallets and Safes send an EIP-5792 batch with no contract at all. Large runs are cut into transactions of at most 350 lines and never split by employee, because per-transaction totals would reveal salaries. Find and spend: the recipient's scanner filters announcer events by view tag and reads real balances. On first spend a stealth address delegates to an audited ERC-4337 account through EIP-7702 and a USDC paymaster pays the gas, so the address never needs ETH and the main wallet never appears. A consolidation guard warns before any spend that would link addresses together.

Integrations: ENSv2 on Sepolia with per-resource access control, so an employee can rotate only their own stealth record and the issuer can only issue names. World ID Selfie Check sessions attest key rotations, so a stolen key alone cannot redirect pay. Uniswap lets a recipient convert salary to ETH or WETH inside the stealth address itself, with quotes that never reveal the address and calldata checks that refuse to pay anyone else. An MCP server gives AI agents the same identities, with ENSIP-26 records and spending guardrails, so agents can be paid and can pay by name.

Trust model: the employer is trusted and keeps its own records, so compliance stays where it already lives. The only adversary is a coworker. Nothing we wrote holds money, and every contract we touch is a public standard someone else already audited. Built for payroll, ready for any payout: dividends, grants, bounties, vendor payments, airdrops, tips. Built on Base with USDC, demoed on Base Sepolia, with names on ENSv2 Sepolia.

## Before submitting

- If the Privacy Pools exit is in the demo, add one sentence to the "What Soapay does" paragraph: "For cashing out, a screened exit through Privacy Pools keeps the withdrawal from linking back to the name."
- The first two sentences of the description are what judges see in previews. Keep them at the top if you trim.
