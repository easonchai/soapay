---
name: prd-open-questions
description: Unresolved issues to settle as a team; full list in CLAUDE.md and contracts/PLAN.md
metadata:
  type: project
---
Open as of 2026-09-25. Contract-side questions are in contracts/PLAN.md "Open questions" and the product-side list is in CLAUDE.md; this file tracks only what neither covers:
- Seed format (BIP-39 vs signature-derived); see [[decision-scope-v1]].
- Registration relayer: `registerKeysOnBehalf` is a plain call that needs a sponsor relayer, not a 4337 paymaster.
- Scanner performance: one year of Base logs in <10 s needs an indexer that serves all announcements, filtered client-side.
- Confirm the two-path pay-run split; see [[decision-atomic-batch]].
- Telemetry metrics (client-side vs gateway, guard warnings acted on) conflict with privacy; they need opt-in or on-device computation.
- **PENDING (owner, 2026-09-26), revisit after the CK integration:** is the demo compelling enough? The core message is "fresh addresses, no linkability". Does the UI actually *show* that? Ideas: a side-by-side "what a coworker sees on Basescan" vs "what I see", highlighting that no two payments are linkable.
- **PENDING, privacy leak to the platform:** the Uniswap swap goes through our API proxy (`/api/uniswap`), so the platform sees stealth addresses plus the employee's IP, and over time could link one employee's addresses. Consider routing swaps without the platform (the Universal Router fallback on-chain) by default, and write down the platform's visibility in a privacy-model doc.

