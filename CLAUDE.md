# Soapay

Stealth-address payroll on Base. Product spec: `PRD.md`. PRD review: `docs/prd-analysis.md`. Contract plan: `contracts/PLAN.md`. MVP interfaces: `docs/mvp-spec.md`.

## Layout

| Path | What |
| --- | --- |
| `packages/sdk` | `@soapay/sdk`: the only home for derivation, registry, announce, scan and spend logic |
| `apps/recipient` | Vite + React SPA on CK's Direction A Ledger design: keys (recovery phrase saved as a recovery kit; passkey unlock; passkey-synced encrypted backup, D-63), onboarding, scanner, ledger, guarded Send, Exit, Convert, rotation |
| `apps/sender` | Vite + React SPA, the company app on the Direction A Ledger design: hero landing with wallet Login, then Pay run (denominated payouts), Review & sign, History, Recipients, Settings. Pays through StealthDisperse (EOAs) or an EIP-5792 batch (smart accounts) |
| `apps/api` | Hono on Node: registration relayer (`POST /register`, and `POST /relay` for CK's request shape), ENSv2 subname issuer, World ID verification, announcement indexer (docs/mvp-spec.md §4). Gateway *derivation* mode is out of scope (proposed cut) |
| `apps/mcp` | `@soapay/mcp`: stdio MCP server (spec §8), so agents get `<label>.soapay.eth` identities with ENSIP-26 records and can pay, scan and spend. Bundled with esbuild |
| `apps/cli` | `@soapay/cli`: headless `soapay distribute` (CSV → plan, dry run by default, `--execute` via StealthDisperse) and `soapay scan`. Bundled with esbuild |
| `examples` | `@soapay/examples`: `dividend-run.ts`, `grant-round.ts` (tsx, dry run by default); `demo/` drives the live "plug it into anything" beat (`scripts/demo-pluggable.sh`) |
| `packages/ui` | `@soapay/ui`: Direction A Ledger tokens (light, navy #1E3A5F, IBM Plex, 2px), `TopBar`, `PageHead`, `Dots`, `NavyPanel`, `Toggle`, `FreshMark`, `Pill`, `Copy`, `ErrorLine`, `Shell`/`Steps`. Source-only, no build |
| `contracts` | `@soapay/contracts`: Foundry, `StealthDisperse`, the testnet-only `MockUSDC` (+ deploy and pool scripts), plus `tools/derive.ts` for test vectors |

## Commands

- `git submodule update --init --recursive` once, for the Foundry libraries.
- `pnpm install` · `pnpm build` · `pnpm test` · `pnpm typecheck` · `pnpm dev`, all run through turbo. `pnpm test` includes `forge test`.
- Dev ports: recipient 5173, sender 5174, api 8787. Copy each app's `.env.example` to `.env.local` (Base Sepolia); the api needs `RELAYER_PRIVATE_KEY` for registration (`POST /register`, `POST /relay`) and the faucet, and `PIMLICO_API_KEY` for sponsored gas (`POST /paymaster`).
- **Testnet vs mainnet (D-52):** on Base Sepolia the pay token is Soapay's **mock USDC** `0x028D969c20b740582428f5043954c380686214Bb` (`MOCK_USDC_BASE_SEPOLIA`; override with `VITE_PAY_TOKEN` / `PAY_TOKEN`), stealth spends are **gas-sponsored** through the API's `/paymaster` proxy, wallets get a one-time **welcome drop** (`/faucet`), and the **exit is hidden** (CCTP needs Circle USDC). Base mainnet keeps Circle USDC and the Circle paymaster; never change mainnet paths for the demo. Fund a wallet with `scripts/fund-usdc.sh`.
- Frontend M1 design and task record: `docs/frontend-m1-design.md`, `docs/frontend-m1-plan.md`.
- One package: `pnpm --filter @soapay/sdk test`, `pnpm --filter @soapay/contracts test`.
- Contract fork tests run when `BASE_RPC_URL` is set.

## Agreed threat model (overrides PRD.md where they differ)

- The only adversary is a **coworker**: a co-recipient in the same payroll batch who knows their own line, sees the whole batch on-chain, and likely knows colleagues' main wallets.
- The **employer is trusted** and may know everything (name → stealth address → amount). Payroll admins and Safe signers count as "the company".
- **ENS is only a reference identifier.** It still controls where salaries go, so the sender app resolves a name once at enrollment and **pins the ERC-6538 meta-address**; alert the employer if it ever changes. Caching the meta-address is safe; caching a *stealth address* is not.
- Out of scope for v1: chain analysts and RPC/bundler linkage. **Gateway derivation mode is deferred to the roadmap** (PRD tier 2, not v1).
- **The compliant exit (Privacy Pools) is IN scope** (owner decision 2026-09-26). A coworker knows your main wallet, so without a screened exit an employee can't cash out without revealing which lines were theirs.

## Design decisions

- One custom production contract, `StealthDisperse`: pulls tokens from `msg.sender` with `transferFrom`, and in the same tx calls the **canonical** ERC-5564 Announcer for each line. Holds no funds, keeps no state.
- Stealth addresses in a batch must be **strictly ascending**: the order is independent of names and duplicates are rejected, enforced on-chain.
- Ascending order guards against bugs in the employer's own app and dedupes within a batch. On its own it is **not** a privacy guarantee.
- ERC-5564 metadata per line: `viewTag(1) | transfer selector(4) | token(20) | amount(32) | payer(20)`. The payer is appended because `Announcement.caller` is always the contract. Scanners recompute the stealth address, read real balances, and never trust the metadata amount or token.
- `payWithPermit` targets plain EOAs. Base USDC routes permits from accounts with code through ERC-1271. That fails for delegates whose `isValidSignature` isn't a plain ECDSA check (the contract then reverts `PermitFailed`), but it **does validate for Simple7702Account** (verified on a Base fork, 2026-09-25, `packages/sdk/test/fork.e2e.test.ts`), which the spend path relies on.
- Recommended, pending team confirmation: smart-account, 7702 and Safe employers use a contract-less EIP-5792 atomic batch of `[USDC.transfer, Announcer.announce] × N`. Safes use `MultiSendCallOnly`, never `MultiSend`. This also avoids the contract being a single USDC-blacklist chokepoint.
- Reuse the canonical ERC-6538 Registry and ERC-5564 Announcer, an existing audited 7702/4337 account, and a USDC paymaster. Never fork them.

## Sender-app invariants (the contract can't enforce these)

- **Multi-tx runs:** derive every line for the run, sort globally by stealth address, then cut into roughly equal txs. **Never partition by employee**, or tx totals reveal salaries.
- Cap at **350 lines per tx**. Gas is about 42k per line all-in, which gives ~398 lines under the 2^24 per-tx cap with zero margin.
- No ephemeral key is reused across lines.
- Sign permits for the exact total, never max.

## Engineering rules

- Apps and the api import protocol logic only from `@soapay/sdk`. No private code paths (PRD P0).
- Spending keys never leave the client.
- `StealthDisperse` is the only custom production contract, and no custom contract may hold funds or keep state. The one exception is testnet-only `MockUSDC` (D-52): a plain ERC-20 whose balances are its own token's ledger, so it custodies nothing; it never ships to mainnet.
- The web employee app has no Convert/swap screen (D-53); swap-in-place stays in the SDK and the MCP server.
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

**Traceability:** every product or architecture decision gets an entry in `docs/decision-log.md` (ID, PRD section, type, who decided, why, commits; superseded entries stay, marked). Every checkpoint in `.claude/memory/build-status.md` cites the decision IDs and commit hashes it covers, and flags any `agent` decision that still needs owner confirmation.

@.claude/memory/MEMORY.md
