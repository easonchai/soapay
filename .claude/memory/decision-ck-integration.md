---
name: decision-ck-integration
description: How CK's frontend (main) and yudhishthra combine: CK's UI plus our engine; the decisions for each clash
metadata:
  type: project
---
Owner decisions, 2026-09-26. Precedence: **PRD → recorded design/architecture decisions (CLAUDE.md, this memory) → CK's implementation choices.**
- **Base:** CK's screens and `@soapay/ui` (Direction A Ledger) are the UI. Our SDK, API and integrations are the engine. CK's duplicate SDK modules are replaced by ours, but his unique logic is kept (company store and per-wallet live balances, formatters, findRegistrationBlock, recipient/sender stores). Our features that CK's UI lacks become screens in his design: exit, rotation + World ID, Convert (Uniswap), labels/guard, invites, Safe export, attestation badges.
- **Keys:** a recovery phrase by DEFAULT, with CK's wallet-signature derivation as an option for plain EOAs only (smart/passkey wallets blocked).
- **Spending:** our gasless 7702 + paymaster Send, guarded, with Exit when blocked. It replaces CK's "reveal private key"; key export stays only as advanced recovery behind a warning.
- **Sender modes:** EIP-5792 batch > StealthDisperse. CK's non-atomic "sequential" mode is DROPPED (PRD invariant 3). His pay-run encoding must use the SDK's packed ABI (`encodeStealthDisperseCalls` / `encodeBatchCalls`).
- **Backend:** fold CK's `apps/gateway` `POST /relay` into `apps/api` as a compatible route (same request shape; one relayer key and nonce sequence; idempotency and receipts), then delete `apps/gateway`.
- **Names:** our ENSv2 `*.soapay.eth` issuance plus invites replace CK's "link an existing addr" step.

- **Clash 1 (owner, 2026-09-26):** rotation for signature-derived accounts means **moving to a recovery-phrase account** (new keys → exit or move funds → rotate the name via the normal route).
- **Clash 2:** the sender pay run is **roster only** (pinned, verified ENS names). Pasting only bulk-imports into the roster; raw meta-addresses and plain addresses are rejected.
- After the clashes are resolved: merge `integrate-ck` → `yudhishthra`, push, and redeploy Railway.
**How to apply:** any clash not covered here goes to the owner; don't guess.
