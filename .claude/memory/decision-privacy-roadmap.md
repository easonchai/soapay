---
name: decision-privacy-roadmap
description: Owner decisions on privacy gaps (shielded rail, timing, swap proxy) and the pre-submission order, 2026-09-26
metadata:
  type: project
---
Owner decisions 2026-09-26, after reviewing the privacy guarantees:
- **Build the v2 shielded rail** (hide amounts). A research spike comes first: which pool or rail exists on or near Base.
- **Timing correlation:** design a fix (spends of different addresses must not cluster in time).
- **Swap proxy leak:** fix it. Make the platform-free route the default; the proxy is opt-in. Do this after the CK integration lands, together with `docs/privacy-model.md` (who sees what, plus guaranteed vs not guaranteed).
- **Accepted as-is:** consolidation by choice (not relevant for now), the shared 7702 delegate fingerprint, third-party infra visibility (RPC/bundler/paymaster), and the employer seeing post-payday spending (trusted).
- **World ID:** double down on **IDKit only** (no World ID for Agents, to avoid stacking undemoable features).
- **Pre-submission order:**
  1. CK merge → main → repo public → public demo URL.
  2. A live World ID Selfie Check run (success plus a refused path), then finish the debrief.
  3. Uniswap: API key, a live Base Sepolia swap, the feedback form, and an upstream PR fixing Uniswap's outdated skill.
