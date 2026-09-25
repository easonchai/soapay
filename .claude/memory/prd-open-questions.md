---
name: prd-open-questions
description: Unresolved PRD issues to raise with the PRD author before their milestone
metadata:
  type: project
---
Open as of 2026-09-25 (full analysis in docs/prd-analysis.md):
- Seed format (BIP-39 vs signature-derived); see [[decision-scope-v1]].
- Registration relayer: `registerKeysOnBehalf` is a plain call, needs a sponsor relayer, not a 4337 paymaster.
- Scanner performance: 1 year of Base logs in <10 s needs an indexer/snapshot serving all announcements (client-side filtering).
- 7702 delegate choice is a fingerprint; pick the most widely used implementation. Bundler/paymaster see IPs.
- Denominated payouts: remainder carry-over under/over-pays wages; chunk count leaks on consolidation; large batches may exceed the per-tx gas cap.
- Telemetry metrics (client-side vs gateway, guard warnings acted on) conflict with privacy; need opt-in or on-device.
- Privacy Pools exit: the fresh mainnet address needs gas, a new funding-link risk.
