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
- **Uniswap API ($6k):** employee side ONLY (owner decision 2026-09-25; employer treasury-funding swap deferred).
  - Convert salary *in place* inside a stealth address (7702 userOp with approve + swap, USDC paymaster), so no clusters merge.
  - The preference stays local.
  - Needs FEEDBACK.md and the feedback form.

**World ID 4.0 mechanics (verified in the docs, 2026-09-25):**
- A nullifier is scoped to (user, app/RP, action), so two actions can't prove "same human". Enroll = a uniqueness request (action `soapay-enroll`, `proofOfHuman`) plus `createSession`, with session_id saved per name. A meta-address update = `proveSession(saved session_id)`; require a session_id match and reject a reused session_nullifier.
- Every request needs a fresh backend RP signature (`signRequest`).
- Verification: POST https://developer.world.org/api/v4/verify/{rp_id} with the result forwarded as-is.
- A staging action works only with the simulator.
- App id `app_0cc7167efe114ac2e0ef7d9827098353`.
- **World ID 4.0 configured 2026-09-25 (managed RP):**
  - `rp_id` = `rp_3ede5fe1cab9af48`; signer address `0xCaf38A54bA7B0C15Eb253cb513f0B0A93AAA349D`.
  - Registered on-chain in production AND staging.
  - Action `soapay-enroll` exists in staging (`action_v4_bf971ef0421e15a478e79756fe4b43a6`) and production (`action_v4_ae297f57ed07717e7713c802da03ade3`).
  - The signing key is ONLY in the owner's local `apps/api/.env` (gitignored, mode 600). If it's lost, rotate it with the Portal MCP `rotate_world_id_signing_key`; it can't be recovered.

**Rejected:** Intercepta requires an agent payment flow, and agents are PRD M5 roadmap (a non-goal for v1); screening a fresh stealth `payTo` is meaningless. Also rejected: 1inch Aqua, Sui, and Curvegrid (weak fit).
**How to apply:** prize write-ups must show real product use, not add-ons. Specs are in docs/mvp-spec.md §2, §5 and §6.
