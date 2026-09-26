# Divergence between `yudhishthra` and `main` (for CK)

Written 2026-09-26. `yudhishthra` is 96 commits ahead of the merge base. `main` has CK's frontend (#2, #3, #5). A trial merge conflicts in about 20 files. Nothing has been merged yet, so we can decide together.

## What each side has

| | `yudhishthra` | `main` (CK) |
| --- | --- | --- |
| Employee keys | BIP-39 recovery phrase (`packages/sdk/src/keys.ts`) | Signature from the employee's wallet (`SIGN_MESSAGE`, `deriveKeysFromSignature`) |
| Backend | `apps/api`: ERC-6538 relayer, ENSv2 subname issuer, World ID, announcement indexer, invites | `apps/gateway` stub (renamed to `apps/api` on our side) |
| SDK | keys, registration, names, payrun, scan, spend (7702 + Circle paymaster), guard, denominations, Safe, ENSv2, rotation, invites, swap (183 tests) | keys, derive, scan, register, recipient, batch/sendCalls, stores |
| Apps | Simple UIs with all logic in hooks (see each app's README, "How to plug in another UI") | Designed UIs: glass theme, landing with wallet login, company history with per-wallet live balances, `packages/ui` |
| Contracts | `StealthDisperse` with the packed calldata ABI (64 B/line) | `StealthDisperse` with the original struct ABI |
| Status | Live on testnet: see `docs/testnet-deployment.md` | Not deployed |

**Breaking:** the StealthDisperse ABI changed to `pay(token, (uint256 head, bytes32 keyX)[])`. CK's `batch/buildCalls.ts` encodes the old struct ABI, so it won't work with the deployed contract at `0x6B7a1cC570Af2DDd427DA694351438F0FE8039CA`. Use the SDK's `encodeStealthDisperseCalls` / `encodeBatchCalls`.

## Decisions already made (owner, 2026-09-26)

- **Keys:** the recovery phrase is the default, with an optional "derive from wallet" for plain EOAs only. Smart and passkey wallets (e.g. Coinbase Smart Wallet) are blocked there, because their signatures aren't deterministic and the keys would silently change. The two derivations produce different accounts for the same person, so pick one per account, never both.
- **Direction for the merge (proposed):** keep `yudhishthra`'s SDK, API and integrations as the base (live-tested), and bring CK's visual layer (`packages/ui`, theme, landing, company history view) onto our hooks. Drop the duplicate SDK modules, but keep any of CK's logic we lack (for example, per-wallet live balances).

## Suggested merge steps

1. Merge `main` into `yudhishthra` (or the reverse). For the SDK, `apps/api` and `CLAUDE.md`, take ours.
2. Port CK's screens onto `apps/*/src/hooks` (the logic seam), then delete the duplicate SDK modules.
3. Add "derive from wallet (EOA only)" to the SDK's `keys.ts` as a second entry point.
4. `pnpm build && pnpm typecheck && pnpm test`, then check the live demo against Base Sepolia.

## Status (2026-09-26): merged on `integrate-ck`

`main` was merged into `yudhishthra` on the `integrate-ck` branch. CK's screens and `packages/ui` now run on our SDK, API and hooks. `apps/gateway` is gone, and `POST /relay` lives in `apps/api` with the same request shape. The signature keys became an EOA-only option in `keys.ts`. His formatters, `findRegistrationBlock`, per-wallet live balances and pay-path order are in the SDK or the sender lib. `sequential` mode and his localStorage stores were dropped. Open clashes are marked `TODO(clash)`: rotation for signature-derived accounts (`apps/recipient/src/hooks/useRotation.ts`) and his paste-per-run list versus our pinned roster (`apps/sender/src/pages/PayRunPage.tsx`).
