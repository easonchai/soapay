# Soapay

Stealth-address payroll on Base. Product spec: `PRD.md`. Contracts: `contracts/` (Foundry).

## Agreed threat model (overrides PRD.md where they differ)

- The only adversary is a **coworker**: a co-recipient in the same payroll batch who knows their own line, sees the whole batch on-chain, and likely knows colleagues' main wallets.
- The **employer is trusted** and may know everything (name → stealth address → amount). Payroll admins and Safe signers count as "the company".
- **ENS is only a reference identifier.** It still controls where salaries go, so the sender app resolves a name once at enrollment and **pins the ERC-6538 meta-address**; alert the employer if it ever changes. Caching the meta-address is safe; caching a *stealth address* is not.
- Out of scope: chain analysts, RPC/bundler linkage, gateway mode, Privacy Pools exit. Proposed for cut from v1.

## Design decisions

- One custom contract, `StealthDisperse`: pulls tokens from `msg.sender` with `transferFrom`, and in the same tx calls the **canonical** ERC-5564 Announcer for each line. Holds no funds, keeps no state.
- Stealth addresses in a batch must be **strictly ascending**: the order is independent of names and duplicates are rejected, enforced on-chain.
- ERC-5564 metadata per line: `viewTag(1) | selector(4) | token(20) | amount(32)`.
- EOAs pay via `payWithPermit` (USDC supports EIP-2612, try/catch against front-run permit). Safes use MultiSend `approve` + `pay`.
- Reuse the canonical ERC-6538 Registry and ERC-5564 Announcer, an existing audited 7702/4337 account, and a USDC paymaster. Never fork them.
- Batch limits: roughly 400–500 lines per tx (per-tx gas cap and ~128KB tx size). Spread a person's denominated chunks randomly across split txs.

## Open issues from the PRD review

- Denominated payouts: consolidating chunks at spend time reveals the salary; rounding the remainder under- or over-pays wages.
- The consolidation guard should treat coworker-known wallets as identifiable by default.
- Small teams (fewer than ~10 recipients): amounts alone identify people. Warn or set a floor.
