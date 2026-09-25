# Soapay

Stealth-address payments on Base: one ENS name, a fresh address per payment. Spec: `PRD.md`. Review notes: `docs/prd-analysis.md`.

## Layout

| Path | What |
| --- | --- |
| `packages/sdk` | `@soapay/sdk`: the only home for derivation, registry, announce, scan, spend logic |
| `apps/recipient` | Vite + React SPA: keys, onboarding, scanner, ledger, spend |
| `apps/sender` | Vite + React SPA: pay runs as one atomic EIP-5792 batch |
| `apps/gateway` | Hono on Node: CCIP-Read resolver service (static subnames in M1, derivation in M3) |

## Commands

`pnpm install` · `pnpm build` · `pnpm test` · `pnpm typecheck` · `pnpm dev` (all via turbo). Filter one package: `pnpm --filter @soapay/sdk test`.

## Rules

- Apps and gateway import protocol logic only from `@soapay/sdk`. No private code paths (PRD P0).
- Spending keys never leave the client. Viewing keys only reach a gateway the user opted into.
- Use only the canonical ERC-5564 Announcer / ERC-6538 Registry (constants in `packages/sdk/src/constants.ts`). No custom contract may hold funds.
- Every PRD privacy invariant (PRD: Non-functional requirements) becomes a CI test when its code lands. Never cache a resolved stealth address.
- No telemetry that could link addresses without explicit opt-in.
- `@scopelift/stealth-address-sdk` must be bundled/inlined; plain Node can't load it.

## Git

Work happens on personal branches (`yudhishthra`, …) and merges to `main` by PR.

## Shared memory

Project memory is committed in `.claude/memory/` and shared by everyone on the team. Store project facts only: decisions, constraints, external references. No personal preferences, secrets, or keys. One fact per file with frontmatter, plus a one-line pointer in the index. Update an existing file instead of adding a duplicate.

@.claude/memory/MEMORY.md
