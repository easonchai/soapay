---
name: decision-bounties
description: ETHGlobal Tokyo 2026 (main track) prize targets are ENSv2, World IDKit, and Uniswap API; Intercepta was rejected
metadata:
  type: project
---
Main track (not Continuity). The owner chose these on 2026-09-25:
- **ENSv2 ($6k pool):** on-chain subnames and EAC-scoped records; see [[decision-naming]].
- **World IDKit ($5k), revised 2026-09-25 after the owner asked "is it really needed?":** ONE trust moment only, self-service key rotation, using a **Selfie Check session** (created optionally at enrollment, proved at rotation). There's no enrollment gate and no Orb requirement. It is essential for pseudonymous DAO contributors (no out-of-band channel) and a convenience for known employees. Fallback: manual employer approval. Spec: docs/mvp-spec.md §5.
- **Uniswap API ($6k): DROPPED 2026-09-26 (D-53)** — no longer targeted; code and FEEDBACK.md stay. Original note: employee side ONLY (owner decision 2026-09-25; employer treasury-funding swap deferred).
  - Convert salary *in place* inside a stealth address (7702 userOp with approve + swap, USDC paymaster), so no clusters merge.
  - The preference stays local.
  - Needs FEEDBACK.md and the feedback form.

**World ID 4.0 mechanics (verified in the docs, 2026-09-25):**
- A nullifier is scoped to (user, app/RP, action). Continuity comes from sessions: `createSession` at enrollment (optional, selfieCheck), `proveSession(saved session_id)` at rotation; require a session_id match and reject a reused session_nullifier. The `soapay-enroll` action is unused.
- Every request needs a fresh backend RP signature (`signRequest`).
- Verification: POST https://developer.world.org/api/v4/verify/{rp_id} with the result forwarded as-is.
- A staging action works only with the simulator.
- **Current app/RP since 2026-09-26 (D-59):** app `app_c47a43da4fea435146d14ae5e9f503ea`, RP `rp_25e1826d2548c1d9`, created fresh because the first RP silently rejected session requests. Set only through `WORLD_APP_ID` / `WORLD_RP_ID` / `WORLD_RP_SIGNING_KEY` (Railway); the code has no defaults. Credential: Proof of Human (D-54), sessions (D-59; D-58's one-time-request design is superseded because production allows one uniqueness proof per person per action).
- Old app id `app_0cc7167efe114ac2e0ef7d9827098353` (no longer used).
- **World ID 4.0 configured 2026-09-25 (managed RP, the OLD app; no longer used since D-59):**
  - `rp_id` = `rp_3ede5fe1cab9af48`; signer address `0xCaf38A54bA7B0C15Eb253cb513f0B0A93AAA349D`.
  - Registered on-chain in production AND staging.
  - Action `soapay-enroll` exists in staging (`action_v4_bf971ef0421e15a478e79756fe4b43a6`) and production (`action_v4_ae297f57ed07717e7713c802da03ade3`).
  - The signing key is ONLY in the owner's local `apps/api/.env` (gitignored, mode 600). If it's lost, rotate it with the Portal MCP `rotate_world_id_signing_key`; it can't be recovered.

**Rejected:** Intercepta requires an agent payment flow, and agents are PRD M5 roadmap (a non-goal for v1); screening a fresh stealth `payTo` is meaningless. Also rejected: 1inch Aqua, Sui, and Curvegrid (weak fit).
**How to apply:** prize write-ups must show real product use, not add-ons. Specs are in docs/mvp-spec.md §2, §5 and §6.
