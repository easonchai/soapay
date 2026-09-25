---
name: decision-scope-v1
description: v1 asset scope is USDC on Base only; seed format defaults to BIP-39 pending confirmation
metadata:
  type: project
---
v1 = USDC on Base only (ETH later). Recipient keys (decided 2026-09-26): a BIP-39 recovery phrase is the DEFAULT, plus an optional "derive from wallet signature" for plain EOAs only. Smart and passkey wallets are blocked, because non-deterministic signatures would change the keys. CK's main branch uses wallet-signature derivation only; see docs/DIVERGENCE.md.

**Why:** USDC matches the USDC paymaster and the payroll wedge.
**How to apply:** don't build ETH receive/spend paths in M1. Confirm the seed format before shipping key derivation. See [[prd-open-questions]].
