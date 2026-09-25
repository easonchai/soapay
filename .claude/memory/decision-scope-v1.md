---
name: decision-scope-v1
description: v1 asset scope is USDC on Base only; seed format defaults to BIP-39 pending confirmation
metadata:
  type: project
---
v1 = USDC on Base only (ETH later). Recipient key seed: PRD only says "single seed the employee backs up"; default is a BIP-39 mnemonic with fixed derivation paths, NOT yet confirmed by the team (2026-09-25).

**Why:** USDC matches the USDC paymaster and the payroll wedge.
**How to apply:** don't build ETH receive/spend paths in M1. Confirm the seed format before shipping key derivation. See [[prd-open-questions]].
