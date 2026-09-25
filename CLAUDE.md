# Soapay

Stealth-address payroll on Base. Product spec: `PRD.md`. PRD review: `docs/prd-analysis.md`. Contract plan: `contracts/PLAN.md`.

## Layout

| Path | What |
| --- | --- |
| `packages/sdk` | `@soapay/sdk`: the only home for derivation, registry, announce, scan and spend logic |
| `apps/recipient` | Vite + React SPA: keys, onboarding, scanner, ledger, spend |
| `apps/sender` | Vite + React SPA, the company app: hero landing with wallet login, then Pay, Employees (per-wallet history) and Settings. Pay runs through StealthDisperse (EOAs) or an EIP-5792 batch (smart accounts) |
| `apps/gateway` | Hono on Node: `POST /relay` submits `registerKeysOnBehalf` from a dev key (M1); CCIP-Read service stub. Gateway mode is out of scope under the agreed threat model (proposed cut) |
| `packages/ui` | `@soapay/ui`: shared styles (tokens, IBM Plex), `Shell`, `Steps`, `Pill`, `Copy`, `ErrorLine`. Source-only, no build |
| `contracts` | `@soapay/contracts`: Foundry, `StealthDisperse`, plus `tools/derive.ts` for test vectors |

## Commands

- `git submodule update --init --recursive` once, for the Foundry libraries.
- `pnpm install` · `pnpm build` · `pnpm test` · `pnpm typecheck` · `pnpm dev`, all run through turbo. `pnpm test` includes `forge test`.
- Dev ports: recipient 5173, sender 5174, gateway 8787. Copy each app's `.env.example` to `.env.local` (Base Sepolia); the gateway needs `RELAYER_PRIVATE_KEY` for registration.
- Frontend M1 design and task record: `docs/frontend-m1-design.md`, `docs/frontend-m1-plan.md`.
- One package: `pnpm --filter @soapay/sdk test`, `pnpm --filter @soapay/contracts test`.
- Contract fork tests run when `BASE_RPC_URL` is set.

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

## Engineering rules

- Apps and the gateway import protocol logic only from `@soapay/sdk`. No private code paths (PRD P0).
- Spending keys never leave the client.
- `StealthDisperse` is the only custom contract, and no custom contract may hold funds or keep state.
- Every privacy invariant becomes a CI test when its code lands.
- No telemetry that could link addresses without explicit opt-in.
- `@scopelift/stealth-address-sdk` must be bundled, inlined, or run through tsx. Plain Node can't load it.

## Open issues from the PRD review

- Denominated payouts: consolidating chunks at spend time reveals the salary; rounding the remainder under- or over-pays wages.
- The consolidation guard should treat coworker-known wallets as identifiable by default.
- Small teams (fewer than ~10 recipients): amounts alone identify people. Warn or set a floor.

## Git

Work on personal branches (`yudhishthra`, …) and merge to `main` by PR.

## Shared memory

Project memory is committed in `.claude/memory/` and shared by everyone on the team. Store project facts only: decisions, constraints, external references. No personal preferences, secrets, or keys. One fact per file with frontmatter, plus a one-line pointer in the index. Update an existing file rather than adding a duplicate. When memory conflicts with this file, this file wins.

@.claude/memory/MEMORY.md
