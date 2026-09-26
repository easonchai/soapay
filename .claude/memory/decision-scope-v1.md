---
name: decision-scope-v1
description: v1 asset scope is USDC on Base only; seed format defaults to BIP-39 pending confirmation
metadata:
  type: project
---
v1 = USDC on Base only (ETH later). Recipient keys (decided 2026-09-26, updated same day by D-44/D-45): a BIP-39 recovery phrase, saved as a **recovery kit** (download a text file, copy into a password manager, or show the words; no memorise-quiz), unlocked day to day with a passkey. **New accounts can no longer be made from a wallet signature** (D-45 supersedes D-23); accounts made that way earlier still open, can be restored from a quiet link on the Restore step (plain EOAs only; smart and passkey wallets blocked, since non-deterministic signatures would change the keys), and can move to a phrase account (D-25). CK's main branch uses wallet-signature derivation only; see docs/DIVERGENCE.md.

**Why:** USDC matches the USDC paymaster and the payroll wedge.
**How to apply:** don't build ETH receive/spend paths in M1. Confirm the seed format before shipping key derivation. The recipient app currently ships signature-derived keys; see [[decision-frontend-m1]]. See [[prd-open-questions]].
