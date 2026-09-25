---
name: decision-bounties
description: ETHGlobal Tokyo 2026 (main track) prize targets are ENSv2, World IDKit, and Uniswap API; Intercepta was rejected
metadata:
  type: project
---
Main track (not Continuity). The owner chose these on 2026-09-25:
- **ENSv2 ($6k pool):** on-chain subnames and EAC-scoped records; see [[decision-naming]].
- **World IDKit ($5k):**
  - Proof of Human re-verification gates a meta-address change (salary-redirect protection, same nullifier as enrollment).
  - One sponsored registration and subname per human.
  - Verified server-side. The prize needs an alternative path in the demo and a debrief in the README.
- **Uniswap API ($6k):**
  - Convert salary *in place* inside a stealth address (7702 userOp with approve + swap, USDC paymaster), so no clusters merge.
  - The preference stays local.
  - Needs FEEDBACK.md and the feedback form.

**Rejected:** Intercepta requires an agent payment flow, and agents are PRD M5 roadmap (a non-goal for v1); screening a fresh stealth `payTo` is meaningless. Also rejected: 1inch Aqua, Sui, and Curvegrid (weak fit).
**How to apply:** prize write-ups must show real product use, not add-ons. Specs are in docs/mvp-spec.md §2, §5 and §6.
