# Soapay

Stealth-address payroll on Base. Product spec: `PRD.md`. Contracts: `contracts/` (Foundry; see `contracts/PLAN.md`). Libraries are git submodules: run `git submodule update --init --recursive`, then `cd contracts && forge test`. Fork tests run when `BASE_RPC_URL` is set.

## Agreed threat model (overrides PRD.md where they differ)

- The only adversary is a **coworker**: a co-recipient in the same payroll batch who knows their own line, sees the whole batch on-chain, and likely knows colleagues' main wallets.
- The **employer is trusted** and may know everything (name → stealth address → amount). Payroll admins and Safe signers count as "the company".
- **ENS is only a reference identifier.** It still controls where salaries go, so the sender app resolves a name once at enrollment and **pins the ERC-6538 meta-address**; alert the employer if it ever changes. Caching the meta-address is safe; caching a *stealth address* is not.
- Out of scope: chain analysts, RPC/bundler linkage, gateway mode, Privacy Pools exit. Proposed for cut from v1.

## Design decisions

- One custom contract, `StealthDisperse`: pulls tokens from `msg.sender` with `transferFrom`, and in the same tx calls the **canonical** ERC-5564 Announcer for each line. Holds no funds, keeps no state.
- Stealth addresses in a batch must be **strictly ascending**: the order is independent of names and duplicates are rejected, enforced on-chain.
- Ascending order guards against bugs in the employer's own app and dedupes within a batch. On its own it is **not** a privacy guarantee.
- ERC-5564 metadata per line: `viewTag(1) | transfer selector(4) | token(20) | amount(32) | payer(20)`. The payer is appended because `Announcement.caller` is always the contract. Scanners recompute the stealth address, read real balances, and never trust the metadata amount or token.
- `payWithPermit` is for **plain EOAs only**. Base USDC routes permits from 7702-delegated accounts through ERC-1271, so they fail; the contract reverts `PermitFailed`.
- Recommended, pending team confirmation: smart-account, 7702 and Safe employers use a contract-less EIP-5792 atomic batch of `[USDC.transfer, Announcer.announce] × N`. Safes use `MultiSendCallOnly`, never `MultiSend`. This also avoids the contract being a single USDC-blacklist chokepoint.
- Reuse the canonical ERC-6538 Registry and ERC-5564 Announcer, an existing audited 7702/4337 account, and a USDC paymaster. Never fork them.

## Sender-app invariants (the contract can't enforce these)

- **Multi-tx runs:** derive every line for the run, sort globally by stealth address, then cut into roughly equal txs. **Never partition by employee**, or tx totals reveal salaries.
- Cap at **350 lines per tx**. Gas is about 42k per line all-in, which gives ~398 lines under the 2^24 per-tx cap with zero margin.
- No ephemeral key is reused across lines.
- Sign permits for the exact total, never max.

## Open issues from the PRD review

- Denominated payouts: consolidating chunks at spend time reveals the salary; rounding the remainder under- or over-pays wages.
- The consolidation guard should treat coworker-known wallets as identifiable by default.
- Small teams (fewer than ~10 recipients): amounts alone identify people. Warn or set a floor.
